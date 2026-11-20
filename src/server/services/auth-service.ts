import 'server-only';
import { writeAudit } from '../audit';
import { firstInWindow } from '../audit-throttle';
import { prisma } from '../db';
import { log } from '../log';
import type { RequestMeta } from '../request-meta';
import {
  checkIpRate,
  LOCK_MS,
  LOCK_THRESHOLD,
  lockUser,
  markAttemptSuccess,
  mayVerify,
  reserveAttempt,
  type IpRateResult,
} from '../auth/login-guard';
import { dummyVerify, hashPassword, isSameAsCurrent, passwordPolicyErrors, verifyPassword } from '../auth/password';
import { createSession, hashToken } from '../auth/session';

export type PasswordLoginResult =
  | { ok: true; rawToken: string; expires: Date; mustChangePassword: boolean }
  | { ok: false; reason: 'invalid' | 'rate_limited' };

/**
 * 한도 초과는 공격이 이어지는 동안 계속 들어오므로 IP·분 단위 첫 1회만 감사 로그에 남기고 나머지는 앱 로그로.
 * (감사 로그는 append-only 라 쌓이면 정리 비용이 크다.)
 */
async function auditRateLimited(action: string, meta: RequestMeta, rate: IpRateResult, actorId: string | null = null) {
  // 연결 풀 고갈(busy)은 공격 신호가 아닐 수 있고 감사 기록이 DB 를 더 쓰므로 앱 로그만 남긴다.
  if (!rate.ok && rate.reason === 'busy') {
    log.warn(`${action}.busy`, { ip: meta.ip });
    return;
  }
  if (firstInWindow(`${action}:${meta.ip}`)) {
    await writeAudit(prisma, { actorId, action, after: { window: '1m', note: 'first in window' }, meta });
  } else {
    log.warn(action, { ip: meta.ip });
  }
}

/**
 * 계정 잠금 감사. 동시 폭주에서는 5번째 실패와 초과 예약(n>5)이 거의 동시에 잠글 수 있으므로
 * 잠금 창(15분)마다 첫 1회만 남긴다.
 */
async function lockAndAudit(userId: string, now: Date, meta: RequestMeta, after: Record<string, unknown>, actorId: string | null = null) {
  await lockUser(userId, now);
  if (firstInWindow(`auth.lock:${userId}`, LOCK_MS, now.getTime())) {
    await writeAudit(prisma, { actorId, action: 'auth.lock', entity: 'User', entityId: userId, after, meta });
  }
}

/** 실패 감사에 남길 아이디. 등록된 아이디가 아니면(비밀번호를 아이디 칸에 잘못 넣은 경우 등) 원문을 남기지 않는다. */
function usernameForAudit(input: string, registered: boolean) {
  return registered ? { username: input } : { usernameKnown: false, usernameLength: input.length };
}

/**
 * 아이디·비밀번호 로그인. 계정 없음·비활성·잠금·비밀번호 틀림은 모두 같은 'invalid' 이고
 * 비밀번호 검증 시간도 같게 맞춘다.
 */
export async function passwordLogin(input: {
  username: string;
  password: string;
  meta: RequestMeta;
  currentRawToken?: string | null;
  now?: Date;
}): Promise<PasswordLoginResult> {
  const now = input.now ?? new Date();
  const { username, password, meta } = input;

  const rate = await checkIpRate(meta.ip, now);
  if (!rate.ok) {
    await auditRateLimited('auth.login.rate_limited', meta, rate);
    return { ok: false, reason: 'rate_limited' };
  }

  const user = await prisma.user.findUnique({ where: { username } });
  if (!user || !user.active || !user.passwordHash) {
    await dummyVerify(password);
    await writeAudit(prisma, {
      action: 'auth.login.failure',
      entity: 'User',
      entityId: user?.id ?? null,
      after: usernameForAudit(username, !!user),
      meta,
    });
    return { ok: false, reason: 'invalid' };
  }

  // 검증 전에 시도를 예약한다(잠금 확인과 실패 기록 사이 경쟁 제거).
  const reserved = await reserveAttempt(user.id, now);
  if (!mayVerify(reserved)) {
    await dummyVerify(password);
    // 동시 폭주로 5회를 넘겨 예약된 시도: 검증하지 않고 잠근다.
    if (reserved !== null) await lockAndAudit(user.id, now, meta, { username });
    await writeAudit(prisma, { action: 'auth.login.locked', entity: 'User', entityId: user.id, after: { username }, meta });
    return { ok: false, reason: 'invalid' };
  }

  if (!(await verifyPassword(user.passwordHash, password))) {
    await writeAudit(prisma, { action: 'auth.login.failure', entity: 'User', entityId: user.id, after: { username }, meta });
    if (reserved >= LOCK_THRESHOLD) await lockAndAudit(user.id, now, meta, { username });
    return { ok: false, reason: 'invalid' };
  }

  return prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { failedLogins: 0, lockedUntil: null, lastLoginAt: now },
    });
    // 세션 고정 방지: 이 브라우저가 들고 있던 이전 세션은 지운다.
    if (input.currentRawToken) {
      await tx.session.deleteMany({ where: { sessionToken: hashToken(input.currentRawToken) } });
    }
    const { rawToken, expires } = await createSession(tx, {
      userId: user.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
      now,
    });
    await markAttemptSuccess(tx, rate.attemptId);
    await writeAudit(tx, {
      actorId: user.id,
      action: 'auth.login.success',
      entity: 'User',
      entityId: user.id,
      after: { provider: 'password' },
      meta,
    });
    return { ok: true as const, rawToken, expires, mustChangePassword: user.mustChangePassword };
  });
}

export type ChangePasswordResult =
  | { ok: true }
  | { ok: false; reason: 'invalid_current' | 'rate_limited' | 'no_password' }
  | { ok: false; reason: 'policy'; field: 'newPassword'; errors: string[] };

/** 본인 비밀번호 변경. 성공하면 강제 변경을 풀고 현재 세션을 뺀 나머지 세션을 지운다. */
export async function changeOwnPassword(input: {
  userId: string;
  sessionId: string;
  currentPassword: string;
  newPassword: string;
  meta: RequestMeta;
  now?: Date;
}): Promise<ChangePasswordResult> {
  const now = input.now ?? new Date();
  const { meta } = input;

  const rate = await checkIpRate(meta.ip, now);
  if (!rate.ok) {
    await auditRateLimited('auth.password.rate_limited', meta, rate, input.userId);
    return { ok: false, reason: 'rate_limited' };
  }

  const user = await prisma.user.findUnique({ where: { id: input.userId } });
  if (!user?.passwordHash) return { ok: false, reason: 'no_password' };

  // 현재 비밀번호 확인도 로그인과 같은 예약·잠금 규칙을 따른다.
  const reserved = await reserveAttempt(user.id, now);
  const verified = mayVerify(reserved) && (await verifyPassword(user.passwordHash, input.currentPassword));
  if (!verified) {
    if (!mayVerify(reserved)) await dummyVerify(input.currentPassword);
    await writeAudit(prisma, { actorId: user.id, action: 'auth.password.change_failure', entity: 'User', entityId: user.id, meta });
    if (reserved !== null && reserved >= LOCK_THRESHOLD) await lockAndAudit(user.id, now, meta, {}, user.id);
    return { ok: false, reason: 'invalid_current' };
  }

  const errors = passwordPolicyErrors(input.newPassword, user.username);
  if (await isSameAsCurrent(user.passwordHash, input.newPassword)) errors.push('이전 비밀번호와 달라야 합니다.');
  if (errors.length) {
    // 현재 비밀번호는 맞았으므로 예약한 실패 횟수를 되돌린다.
    await prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0 } });
    return { ok: false, reason: 'policy', field: 'newPassword', errors };
  }

  const passwordHash = await hashPassword(input.newPassword);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { passwordHash, mustChangePassword: false, failedLogins: 0, lockedUntil: null },
    });
    await tx.session.deleteMany({ where: { userId: user.id, id: { not: input.sessionId } } });
    await writeAudit(tx, {
      actorId: user.id,
      action: 'auth.password.change',
      entity: 'User',
      entityId: user.id,
      before: { mustChangePassword: user.mustChangePassword },
      after: { mustChangePassword: false },
      meta,
    });
  });
  return { ok: true };
}

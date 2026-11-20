import 'server-only';
import { writeAudit } from '../audit';
import { prisma } from '../db';
import type { RequestMeta } from '../request-meta';
import { checkIpRate, isLocked, markAttemptSuccess, recordFailure } from '../auth/login-guard';
import { dummyVerify, hashPassword, isSameAsCurrent, passwordPolicyErrors, verifyPassword } from '../auth/password';
import { createSession, hashToken } from '../auth/session';

export type PasswordLoginResult =
  | { ok: true; rawToken: string; expires: Date; mustChangePassword: boolean }
  | { ok: false; reason: 'invalid' | 'rate_limited' };

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

  const attemptId = await checkIpRate(meta.ip, now);
  if (attemptId === null) {
    await writeAudit(prisma, { action: 'auth.login.rate_limited', after: { username }, meta });
    return { ok: false, reason: 'rate_limited' };
  }

  const user = await prisma.user.findUnique({ where: { username } });
  if (!user || !user.active || !user.passwordHash || isLocked(user, now)) {
    await dummyVerify(password);
    const locked = !!user && isLocked(user, now);
    await writeAudit(prisma, {
      action: locked ? 'auth.login.locked' : 'auth.login.failure',
      entity: 'User',
      entityId: user?.id ?? null,
      after: { username },
      meta,
    });
    return { ok: false, reason: 'invalid' };
  }

  if (!(await verifyPassword(user.passwordHash, password))) {
    const lockedNow = await recordFailure(user.id, now);
    await writeAudit(prisma, { action: 'auth.login.failure', entity: 'User', entityId: user.id, after: { username }, meta });
    if (lockedNow) {
      await writeAudit(prisma, { action: 'auth.lock', entity: 'User', entityId: user.id, after: { username }, meta });
    }
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
    await markAttemptSuccess(tx, attemptId);
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

  if ((await checkIpRate(meta.ip, now)) === null) {
    await writeAudit(prisma, { actorId: input.userId, action: 'auth.password.rate_limited', meta });
    return { ok: false, reason: 'rate_limited' };
  }

  const user = await prisma.user.findUnique({ where: { id: input.userId } });
  if (!user?.passwordHash) return { ok: false, reason: 'no_password' };

  if (isLocked(user, now) || !(await verifyPassword(user.passwordHash, input.currentPassword))) {
    const lockedNow = isLocked(user, now) ? false : await recordFailure(user.id, now);
    await writeAudit(prisma, { actorId: user.id, action: 'auth.password.change_failure', entity: 'User', entityId: user.id, meta });
    if (lockedNow) await writeAudit(prisma, { actorId: user.id, action: 'auth.lock', entity: 'User', entityId: user.id, meta });
    return { ok: false, reason: 'invalid_current' };
  }

  const errors = passwordPolicyErrors(input.newPassword, user.username);
  if (await isSameAsCurrent(user.passwordHash, input.newPassword)) errors.push('이전 비밀번호와 달라야 합니다.');
  if (errors.length) return { ok: false, reason: 'policy', field: 'newPassword', errors };

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

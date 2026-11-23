import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/server/db';
import { hashPassword, verifyPassword } from '@/server/auth/password';
import { checkIpRate, IP_LIMIT, lockUser, reserveAttempt } from '@/server/auth/login-guard';
import { resetAuditThrottle } from '@/server/audit-throttle';
import { loadSession } from '@/server/auth/session';
import { changeOwnPassword, passwordLogin } from '@/server/services/auth-service';
import { disconnectAll, resetDb, stringifyRow } from '../helpers/db';

let ipSeq = 0;
const freshIp = () => `10.0.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}`;
const meta = (ip = freshIp()) => ({ ip, userAgent: 'vitest' });

async function makeAdmin(password = 'admin', extra: { mustChangePassword?: boolean; active?: boolean } = {}) {
  return prisma.user.create({
    data: {
      username: 'admin',
      name: '관리자',
      role: 'ADMIN',
      passwordHash: await hashPassword(password),
      mustChangePassword: extra.mustChangePassword ?? true,
      active: extra.active ?? true,
    },
  });
}

beforeEach(async () => {
  await resetDb();
  resetAuditThrottle();
});
afterAll(async () => {
  await prisma.$disconnect();
  await disconnectAll();
});

describe('checkIpRate', () => {
  it('60초에 10회까지, 11번째 거부, 창이 지나면 다시 허용', async () => {
    const t0 = new Date('2026-01-01T00:00:00Z');
    for (let i = 0; i < IP_LIMIT; i++) expect((await checkIpRate('1.1.1.1', new Date(t0.getTime() + i))).ok).toBe(true);
    expect(await checkIpRate('1.1.1.1', new Date(t0.getTime() + 1000))).toEqual({ ok: false, reason: 'limited' });
    expect((await checkIpRate('2.2.2.2', new Date(t0.getTime() + 1000))).ok).toBe(true);
    expect((await checkIpRate('1.1.1.1', new Date(t0.getTime() + 61_000))).ok).toBe(true);
  });

  it('병렬 요청에서도 10회를 넘지 않는다', async () => {
    const now = new Date();
    const results = await Promise.all(Array.from({ length: 25 }, () => checkIpRate('3.3.3.3', now)));
    expect(results.filter((r) => r.ok)).toHaveLength(IP_LIMIT);
    expect(results.filter((r) => !r.ok).every((r) => !r.ok && r.reason === 'limited')).toBe(true);
  });
});

describe('DB 시간대', () => {
  it('통합 DB 세션 TimeZone 이 UTC 가 아니다(운영 TZ=Asia/Seoul 과 같은 조건에서 시각 파라미터를 검증)', async () => {
    const [row] = await prisma.$queryRaw<Array<{ tz: string }>>`SELECT current_setting('TimeZone') AS tz`;
    expect(row.tz).not.toMatch(/^(UTC|Etc\/UTC|GMT)$/);
  });
});

describe('reserveAttempt·lockUser', () => {
  it('검증 전에 실패 횟수를 원자적으로 올리고, 잠긴 동안은 null', async () => {
    const u = await makeAdmin();
    const now = new Date('2026-01-01T00:00:00Z');
    for (let i = 1; i <= 5; i++) expect(await reserveAttempt(u.id, now)).toBe(i);
    const lockedUntil = (await lockUser(u.id, now))!;
    expect(lockedUntil.getTime()).toBe(now.getTime() + 15 * 60 * 1000);
    // 이미 잠겨 있으면 다시 잠그지 않고 null(잠금 시각도 그대로)
    expect(await lockUser(u.id, new Date(now.getTime() + 1000))).toBeNull();
    const after = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(after.failedLogins).toBe(0);
    // 시간대와 무관하게 절대 시각이 그대로 저장된다(TST-7)
    expect(after.lockedUntil?.getTime()).toBe(lockedUntil.getTime());
    expect(await reserveAttempt(u.id, new Date(now.getTime() + 60_000))).toBeNull();
    expect(await reserveAttempt(u.id, new Date(lockedUntil.getTime() + 1))).toBe(1);
  });

  it('병렬 예약도 정확히 센다', async () => {
    const u = await makeAdmin();
    const results = await Promise.all(Array.from({ length: 4 }, () => reserveAttempt(u.id)));
    expect(results.sort()).toEqual([1, 2, 3, 4]);
  });
});

describe('passwordLogin', () => {
  it('성공: 세션 생성·실패 횟수 초기화·감사·강제 변경 표시', async () => {
    const u = await makeAdmin();
    await prisma.user.update({ where: { id: u.id }, data: { failedLogins: 3 } });
    const r = await passwordLogin({ username: 'admin', password: 'admin', meta: meta() });
    expect(r).toMatchObject({ ok: true, mustChangePassword: true });
    if (!r.ok) throw new Error();
    expect((await loadSession(r.rawToken))?.user.id).toBe(u.id);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(after.failedLogins).toBe(0);
    expect(after.lastLoginAt).not.toBeNull();
    expect(await prisma.auditLog.count({ where: { action: 'auth.login.success', actorId: u.id } })).toBe(1);
  });

  it('이전 세션 쿠키가 있으면 그 세션을 지운다(세션 고정 방지)', async () => {
    await makeAdmin();
    const first = await passwordLogin({ username: 'admin', password: 'admin', meta: meta() });
    if (!first.ok) throw new Error();
    const second = await passwordLogin({ username: 'admin', password: 'admin', meta: meta(), currentRawToken: first.rawToken });
    if (!second.ok) throw new Error();
    expect(await loadSession(first.rawToken)).toBeNull();
    expect(await loadSession(second.rawToken)).not.toBeNull();
  });

  it('없는 계정·틀린 비밀번호·비활성은 모두 invalid', async () => {
    await makeAdmin();
    expect(await passwordLogin({ username: 'nobody', password: 'admin', meta: meta() })).toEqual({ ok: false, reason: 'invalid' });
    expect(await passwordLogin({ username: 'admin', password: 'wrong', meta: meta() })).toEqual({ ok: false, reason: 'invalid' });
    await prisma.user.updateMany({ data: { active: false } });
    expect(await passwordLogin({ username: 'admin', password: 'admin', meta: meta() })).toEqual({ ok: false, reason: 'invalid' });
    expect(await prisma.auditLog.count({ where: { action: 'auth.login.failure' } })).toBe(3);
  });

  it('5회 실패 후 잠금 중에는 올바른 비밀번호도 invalid, 15분 뒤 해제', async () => {
    const u = await makeAdmin();
    const t0 = new Date();
    for (let i = 0; i < 5; i++) await passwordLogin({ username: 'admin', password: 'wrong', meta: meta(), now: t0 });
    expect(await prisma.auditLog.count({ where: { action: 'auth.lock', entityId: u.id } })).toBe(1);
    expect(await passwordLogin({ username: 'admin', password: 'admin', meta: meta(), now: t0 })).toEqual({
      ok: false,
      reason: 'invalid',
    });
    expect(await prisma.auditLog.count({ where: { action: 'auth.login.locked' } })).toBe(1);
    const later = new Date(t0.getTime() + 15 * 60 * 1000 + 1);
    expect((await passwordLogin({ username: 'admin', password: 'admin', meta: meta(), now: later })).ok).toBe(true);
  });

  it('관리자가 잠금을 풀었다가 다시 잠기면 auth.lock 을 다시 남긴다(H4)', async () => {
    const u = await makeAdmin();
    const t0 = new Date();
    for (let i = 0; i < 5; i++) await passwordLogin({ username: 'admin', password: 'wrong', meta: meta(), now: t0 });
    expect(await prisma.auditLog.count({ where: { action: 'auth.lock', entityId: u.id } })).toBe(1);
    // 잠금 해제(관리자 unlock 과 같은 효과) 직후 — 15분이 지나지 않은 시점에 다시 5회 실패
    await prisma.user.update({ where: { id: u.id }, data: { failedLogins: 0, lockedUntil: null } });
    const t1 = new Date(t0.getTime() + 60_000);
    for (let i = 0; i < 5; i++) await passwordLogin({ username: 'admin', password: 'wrong', meta: meta(), now: t1 });
    expect(await prisma.auditLog.count({ where: { action: 'auth.lock', entityId: u.id } })).toBe(2);
  });

  it('IP 한도 초과는 rate_limited', async () => {
    await makeAdmin();
    const ip = freshIp();
    for (let i = 0; i < IP_LIMIT; i++) await passwordLogin({ username: 'nobody', password: 'x', meta: meta(ip) });
    expect(await passwordLogin({ username: 'admin', password: 'admin', meta: meta(ip) })).toEqual({
      ok: false,
      reason: 'rate_limited',
    });
    // 계속 두드려도 감사 로그에는 IP·분 단위 첫 1회만(SEC-2)
    for (let i = 0; i < 5; i++) await passwordLogin({ username: 'admin', password: 'admin', meta: meta(ip) });
    expect(await prisma.auditLog.count({ where: { action: 'auth.login.rate_limited' } })).toBe(1);
  });

  it('동시에 오답을 몰아 보내도 잠금 창마다 실제 검증은 5회뿐(SEC-8)', async () => {
    const u = await makeAdmin();
    const results = await Promise.all(
      Array.from({ length: 9 }, (_, i) => passwordLogin({ username: 'admin', password: `wrong-${i}`, meta: meta() })),
    );
    expect(results.every((r) => !r.ok)).toBe(true);
    expect(await prisma.auditLog.count({ where: { action: 'auth.login.failure', entityId: u.id } })).toBe(5);
    expect(await prisma.auditLog.count({ where: { action: 'auth.login.locked', entityId: u.id } })).toBe(4);
    // 5번째 실패와 초과 예약이 함께 잠가도 잠금 감사는 1회(G8)
    expect(await prisma.auditLog.count({ where: { action: 'auth.lock', entityId: u.id } })).toBe(1);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(after.lockedUntil!.getTime()).toBeGreaterThan(Date.now() + 14 * 60 * 1000);
  });

  it('실패 감사에는 등록된 아이디만 원문, 아니면 길이만(SEC-6)', async () => {
    await makeAdmin();
    await passwordLogin({ username: 'my-secret-password', password: 'x', meta: meta() });
    await passwordLogin({ username: 'admin', password: 'wrong', meta: meta() });
    const logs = await prisma.auditLog.findMany({ where: { action: 'auth.login.failure' }, orderBy: { id: 'asc' } });
    expect(logs[0].after).toEqual({ usernameKnown: false, usernameLength: 18 });
    expect(stringifyRow(logs[0])).not.toContain('my-secret-password');
    expect(logs[1].after).toEqual({ username: 'admin' });
  });
});

describe('changeOwnPassword', () => {
  async function loggedIn() {
    const u = await makeAdmin();
    const r = await passwordLogin({ username: 'admin', password: 'admin', meta: meta() });
    if (!r.ok) throw new Error();
    const s = await loadSession(r.rawToken);
    return { u, sessionId: s!.id, rawToken: r.rawToken };
  }

  it('정책 위반은 거부', async () => {
    const { u, sessionId } = await loggedIn();
    for (const newPassword of ['short-pw', 'my-admin-password-1', 'admin']) {
      const r = await changeOwnPassword({ userId: u.id, sessionId, currentPassword: 'admin', newPassword, meta: meta() });
      expect(r).toMatchObject({ ok: false, reason: 'policy' });
    }
  });

  it('현재 비밀번호가 틀리면 거부하고 실패를 센다', async () => {
    const { u, sessionId } = await loggedIn();
    const r = await changeOwnPassword({ userId: u.id, sessionId, currentPassword: 'x', newPassword: 'correct-horse-9', meta: meta() });
    expect(r).toEqual({ ok: false, reason: 'invalid_current' });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).failedLogins).toBe(1);
  });

  it('현재 비밀번호 5회 오답이면 잠기고, 잠긴 동안은 맞는 비밀번호도 거부', async () => {
    const { u, sessionId } = await loggedIn();
    for (let i = 0; i < 5; i++) {
      const r = await changeOwnPassword({ userId: u.id, sessionId, currentPassword: `x${i}`, newPassword: 'correct-horse-9', meta: meta() });
      expect(r).toEqual({ ok: false, reason: 'invalid_current' });
    }
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).lockedUntil).not.toBeNull();
    expect(await prisma.auditLog.count({ where: { action: 'auth.lock', entityId: u.id } })).toBe(1);
    const r = await changeOwnPassword({ userId: u.id, sessionId, currentPassword: 'admin', newPassword: 'correct-horse-9', meta: meta() });
    expect(r).toEqual({ ok: false, reason: 'invalid_current' });
  });

  it('IP 한도 초과면 rate_limited, 감사는 1회', async () => {
    const { u, sessionId } = await loggedIn();
    const ip = freshIp();
    for (let i = 0; i < IP_LIMIT; i++) await checkIpRate(ip);
    for (let i = 0; i < 3; i++) {
      const r = await changeOwnPassword({ userId: u.id, sessionId, currentPassword: 'admin', newPassword: 'correct-horse-9', meta: meta(ip) });
      expect(r).toEqual({ ok: false, reason: 'rate_limited' });
    }
    expect(await prisma.auditLog.count({ where: { action: 'auth.password.rate_limited' } })).toBe(1);
  });

  it('정책 위반이면 현재 비밀번호는 맞았으므로 실패 횟수를 되돌린다', async () => {
    const { u, sessionId } = await loggedIn();
    await changeOwnPassword({ userId: u.id, sessionId, currentPassword: 'admin', newPassword: 'short', meta: meta() });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).failedLogins).toBe(0);
  });

  it('성공하면 강제 변경 해제, 다른 세션 삭제, 현재 세션 유지', async () => {
    const { u, sessionId, rawToken } = await loggedIn();
    const other = await passwordLogin({ username: 'admin', password: 'admin', meta: meta() });
    if (!other.ok) throw new Error();
    const r = await changeOwnPassword({ userId: u.id, sessionId, currentPassword: 'admin', newPassword: 'correct-horse-9', meta: meta() });
    expect(r).toEqual({ ok: true });
    const after = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(after.mustChangePassword).toBe(false);
    expect(await verifyPassword(after.passwordHash!, 'correct-horse-9')).toBe(true);
    expect(await loadSession(rawToken)).not.toBeNull();
    expect(await loadSession(other.rawToken)).toBeNull();
    expect(await prisma.auditLog.count({ where: { action: 'auth.password.change' } })).toBe(1);

    // 같은 비밀번호로 다시 바꾸기는 거부
    const again = await changeOwnPassword({
      userId: u.id,
      sessionId,
      currentPassword: 'correct-horse-9',
      newPassword: 'correct-horse-9',
      meta: meta(),
    });
    expect(again).toMatchObject({ ok: false, reason: 'policy' });
  });
});

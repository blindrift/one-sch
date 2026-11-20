import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/server/db';
import { hashPassword, verifyPassword } from '@/server/auth/password';
import { checkIpRate, IP_LIMIT, recordFailure } from '@/server/auth/login-guard';
import { loadSession } from '@/server/auth/session';
import { changeOwnPassword, passwordLogin } from '@/server/services/auth-service';
import { ownerDb, resetDb } from '../helpers/db';

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

beforeEach(resetDb);
afterAll(async () => {
  await prisma.$disconnect();
  await ownerDb.$disconnect();
});

describe('checkIpRate', () => {
  it('60초에 10회까지, 11번째 거부, 창이 지나면 다시 허용', async () => {
    const t0 = new Date('2026-01-01T00:00:00Z');
    for (let i = 0; i < IP_LIMIT; i++) expect(await checkIpRate('1.1.1.1', new Date(t0.getTime() + i))).not.toBeNull();
    expect(await checkIpRate('1.1.1.1', new Date(t0.getTime() + 1000))).toBeNull();
    expect(await checkIpRate('2.2.2.2', new Date(t0.getTime() + 1000))).not.toBeNull();
    expect(await checkIpRate('1.1.1.1', new Date(t0.getTime() + 61_000))).not.toBeNull();
  });

  it('병렬 요청에서도 10회를 넘지 않는다', async () => {
    const now = new Date();
    const results = await Promise.all(Array.from({ length: 25 }, () => checkIpRate('3.3.3.3', now)));
    expect(results.filter((r) => r !== null)).toHaveLength(IP_LIMIT);
  });
});

describe('recordFailure', () => {
  it('5번째 실패에서 15분 잠그고 횟수를 0 으로', async () => {
    const u = await makeAdmin();
    const now = new Date('2026-01-01T00:00:00Z');
    for (let i = 1; i <= 4; i++) expect(await recordFailure(u.id, now)).toBe(false);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).failedLogins).toBe(4);
    expect(await recordFailure(u.id, now)).toBe(true);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(after.failedLogins).toBe(0);
    expect(after.lockedUntil?.getTime()).toBe(now.getTime() + 15 * 60 * 1000);
  });

  it('병렬 실패도 정확히 센다', async () => {
    const u = await makeAdmin();
    await Promise.all(Array.from({ length: 4 }, () => recordFailure(u.id)));
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).failedLogins).toBe(4);
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

  it('IP 한도 초과는 rate_limited', async () => {
    await makeAdmin();
    const ip = freshIp();
    for (let i = 0; i < IP_LIMIT; i++) await passwordLogin({ username: 'nobody', password: 'x', meta: meta(ip) });
    expect(await passwordLogin({ username: 'admin', password: 'admin', meta: meta(ip) })).toEqual({
      ok: false,
      reason: 'rate_limited',
    });
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

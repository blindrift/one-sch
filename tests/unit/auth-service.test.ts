import { beforeEach, describe, expect, it, vi } from 'vitest';

// passwordLogin 의 한도·잠금 감사 분기만 본다(DB 흐름 전체는 통합 테스트).
const guard = vi.hoisted(() => ({
  checkIpRate: vi.fn(),
  reserveAttempt: vi.fn(),
  lockUser: vi.fn(async () => new Date()),
  markAttemptSuccess: vi.fn(),
}));
const writeAudit = vi.hoisted(() => vi.fn(async () => {}));
const db = vi.hoisted(() => ({ user: { findUnique: vi.fn() } }));

vi.mock('@/server/auth/login-guard', async (orig) => ({ ...(await orig<object>()), ...guard }));
vi.mock('@/server/audit', () => ({ writeAudit }));
vi.mock('@/server/db', () => ({ prisma: db }));
vi.mock('@/server/auth/password', async (orig) => ({ ...(await orig<object>()), verifyPassword: async () => false, dummyVerify: async () => false }));

const { passwordLogin } = await import('@/server/services/auth-service');
const { resetAuditThrottle } = await import('@/server/audit-throttle');

const meta = { ip: '203.0.113.9', userAgent: null };
const actions = () => writeAudit.mock.calls.map((c) => (c as unknown as [unknown, { action: string }])[1].action);

beforeEach(() => {
  vi.clearAllMocks();
  resetAuditThrottle();
  db.user.findUnique.mockResolvedValue({ id: 'u1', active: true, passwordHash: 'h', username: 'admin' });
});

describe('passwordLogin 감사 분기', () => {
  it('연결 풀 고갈(busy)은 감사를 쓰지 않고 rate_limited', async () => {
    guard.checkIpRate.mockResolvedValue({ ok: false, reason: 'busy' });
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    expect(await passwordLogin({ username: 'admin', password: 'x', meta })).toEqual({ ok: false, reason: 'rate_limited' });
    spy.mockRestore();
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it('한도 초과(limited)는 분당 첫 1회만 감사', async () => {
    guard.checkIpRate.mockResolvedValue({ ok: false, reason: 'limited' });
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    for (let i = 0; i < 3; i++) await passwordLogin({ username: 'admin', password: 'x', meta });
    spy.mockRestore();
    expect(actions()).toEqual(['auth.login.rate_limited']);
  });

  it('초과 예약(n>5)도 잠그고 auth.lock 을 남기되, 5번째 실패와 겹치면 잠금 감사는 1회', async () => {
    guard.checkIpRate.mockResolvedValue({ ok: true, attemptId: 1n });
    guard.reserveAttempt.mockResolvedValueOnce(6);
    await passwordLogin({ username: 'admin', password: 'x', meta });
    expect(guard.lockUser).toHaveBeenCalledTimes(1);
    expect(actions()).toEqual(['auth.lock', 'auth.login.locked']);

    guard.reserveAttempt.mockResolvedValueOnce(5);
    await passwordLogin({ username: 'admin', password: 'wrong', meta });
    expect(guard.lockUser).toHaveBeenCalledTimes(2);
    expect(actions().filter((a) => a === 'auth.lock')).toHaveLength(1);
  });

  it('잠금 중(null)이면 잠금을 다시 걸지 않고 locked 만', async () => {
    guard.checkIpRate.mockResolvedValue({ ok: true, attemptId: 1n });
    guard.reserveAttempt.mockResolvedValueOnce(null);
    await passwordLogin({ username: 'admin', password: 'x', meta });
    expect(guard.lockUser).not.toHaveBeenCalled();
    expect(actions()).toEqual(['auth.login.locked']);
  });
});

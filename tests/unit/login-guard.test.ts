import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ $transaction: vi.fn() }));
vi.mock('@/server/db', () => ({ prisma: db }));

const { checkIpRate, mayVerify, LOCK_THRESHOLD } = await import('@/server/auth/login-guard');

const known = (code: string) => new Prisma.PrismaClientKnownRequestError('x', { code, clientVersion: '6.19.3' });

describe('checkIpRate', () => {
  it('트랜잭션 대기 초과(P2028)·연결 풀 초과(P2024)는 null(RATE_LIMITED), 대기 한도를 지정한다', async () => {
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    for (const code of ['P2028', 'P2024']) {
      db.$transaction.mockRejectedValueOnce(known(code));
      expect(await checkIpRate('1.2.3.4')).toBeNull();
    }
    spy.mockRestore();
    expect(db.$transaction.mock.calls[0][1]).toEqual({ maxWait: 5000, timeout: 10000 });
  });

  it('다른 오류는 그대로 던진다', async () => {
    db.$transaction.mockRejectedValueOnce(known('P2002'));
    await expect(checkIpRate('1.2.3.4')).rejects.toMatchObject({ code: 'P2002' });
    db.$transaction.mockRejectedValueOnce(new Error('boom'));
    await expect(checkIpRate('1.2.3.4')).rejects.toThrow('boom');
  });
});

describe('mayVerify', () => {
  it('잠김(null)·한도 초과 예약은 검증하지 않는다', () => {
    expect(mayVerify(null)).toBe(false);
    expect(mayVerify(1)).toBe(true);
    expect(mayVerify(LOCK_THRESHOLD)).toBe(true);
    expect(mayVerify(LOCK_THRESHOLD + 1)).toBe(false);
  });
});

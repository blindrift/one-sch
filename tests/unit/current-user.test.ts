import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const cookie = vi.hoisted(() => ({ value: undefined as string | undefined }));
const loadSession = vi.hoisted(() => vi.fn());

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (name: string) => (name === 'authjs.session-token' && cookie.value ? { value: cookie.value } : undefined) }),
}));
vi.mock('@/server/auth/session', () => ({ loadSession }));

const { getSessionUser } = await import('@/server/auth/current-user');

const baseUser = {
  id: 'u1',
  name: 'n',
  email: null,
  username: 'admin',
  role: 'ADMIN',
  mustChangePassword: true,
  passwordHash: 'h',
};

beforeEach(() => {
  vi.stubEnv('AUTH_URL', 'http://localhost:3000');
  loadSession.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('getSessionUser', () => {
  it('쿠키가 없으면 null(loadSession 에 undefined)', async () => {
    cookie.value = undefined;
    loadSession.mockResolvedValue(null);
    expect(await getSessionUser()).toBeNull();
    expect(loadSession).toHaveBeenCalledWith(undefined);
  });

  it('세션 사용자를 내부 필드 없이 돌려주고 hasPassword 를 계산한다', async () => {
    cookie.value = 'raw';
    loadSession.mockResolvedValue({ id: 's1', user: baseUser });
    const u = await getSessionUser();
    expect(loadSession).toHaveBeenCalledWith('raw');
    expect(u).toEqual({
      id: 'u1',
      name: 'n',
      email: null,
      username: 'admin',
      role: 'ADMIN',
      mustChangePassword: true,
      hasPassword: true,
      sessionId: 's1',
    });
    expect(u).not.toHaveProperty('passwordHash');
    loadSession.mockResolvedValue({ id: 's2', user: { ...baseUser, passwordHash: null, email: 'g@example.com' } });
    expect((await getSessionUser())?.hasPassword).toBe(false);
  });
});

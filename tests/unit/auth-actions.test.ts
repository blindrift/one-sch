import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const jar = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
const service = vi.hoisted(() => ({ passwordLogin: vi.fn(), changeOwnPassword: vi.fn() }));

vi.mock('next/headers', () => ({ cookies: async () => jar, headers: async () => new Headers({ 'x-real-ip': '203.0.113.5' }) }));
vi.mock('@/server/services/auth-service', () => service);
vi.mock('@/server/auth/config', () => ({ signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock('@/server/auth/current-user', () => ({ getSessionUser: async () => null }));
vi.mock('@/server/db', () => ({ prisma: {} }));

const { loginWithPassword } = await import('@/server/actions/auth');

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

async function digestOf(p: Promise<unknown>) {
  try {
    return { result: await p };
  } catch (e) {
    return { digest: (e as { digest?: string }).digest };
  }
}


beforeEach(() => {
  vi.stubEnv('LOCAL_LOGIN_ENABLED', 'true');
  vi.stubEnv('AUTH_URL', 'http://localhost:3000');
  jar.get.mockReset();
  jar.set.mockReset();
  service.passwordLogin.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('loginWithPassword', () => {
  it('성공: 아이디 소문자·IP·이전 쿠키를 서비스에 넘기고, 세션 쿠키를 설정한 뒤 callbackUrl 로 이동', async () => {
    const expires = new Date(Date.now() + 8 * 3600 * 1000);
    jar.get.mockReturnValue({ value: 'old-token' });
    service.passwordLogin.mockResolvedValue({ ok: true, rawToken: 'new-token', expires, mustChangePassword: false });
    const r = await digestOf(loginWithPassword(null, form({ username: ' Admin ', password: 'pw', callbackUrl: '/admin/users' })));
    expect(r.digest).toMatch(/^NEXT_REDIRECT;[a-z]+;\/admin\/users;/);
    expect(service.passwordLogin).toHaveBeenCalledWith({
      username: 'admin',
      password: 'pw',
      meta: { ip: '203.0.113.5', userAgent: null },
      currentRawToken: 'old-token',
    });
    expect(jar.set).toHaveBeenCalledWith('authjs.session-token', 'new-token', {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: false,
      expires,
    });
  });

  it('https 면 __Secure- 쿠키에 Secure', async () => {
    vi.stubEnv('AUTH_URL', 'https://sch.example.com');
    service.passwordLogin.mockResolvedValue({ ok: true, rawToken: 't', expires: new Date(), mustChangePassword: false });
    await digestOf(loginWithPassword(null, form({ username: 'admin', password: 'pw' })));
    expect(jar.set.mock.calls[0][0]).toBe('__Secure-authjs.session-token');
    expect(jar.set.mock.calls[0][2]).toMatchObject({ secure: true, httpOnly: true });
  });

  it('비밀번호 변경이 필요하면 callbackUrl 대신 /change-password', async () => {
    service.passwordLogin.mockResolvedValue({ ok: true, rawToken: 't', expires: new Date(), mustChangePassword: true });
    const r = await digestOf(loginWithPassword(null, form({ username: 'admin', password: 'pw', callbackUrl: '/timeline' })));
    expect(r.digest).toMatch(/;\/change-password;/);
  });

  it('외부 callbackUrl 은 /timeline 으로', async () => {
    service.passwordLogin.mockResolvedValue({ ok: true, rawToken: 't', expires: new Date(), mustChangePassword: false });
    const r = await digestOf(loginWithPassword(null, form({ username: 'admin', password: 'pw', callbackUrl: '//evil.example' })));
    expect(r.digest).toMatch(/;\/timeline;/);
  });

  it('실패·한도 초과는 쿠키를 건드리지 않고 같은 문구/RATE_LIMITED', async () => {
    service.passwordLogin.mockResolvedValue({ ok: false, reason: 'invalid' });
    expect(await loginWithPassword(null, form({ username: 'admin', password: 'x' }))).toEqual({
      ok: false,
      code: 'UNAUTHENTICATED',
      message: '아이디 또는 비밀번호가 올바르지 않습니다.',
    });
    service.passwordLogin.mockResolvedValue({ ok: false, reason: 'rate_limited' });
    expect(await loginWithPassword(null, form({ username: 'admin', password: 'x' }))).toMatchObject({ ok: false, code: 'RATE_LIMITED' });
    expect(jar.set).not.toHaveBeenCalled();
  });

  it('로컬 로그인이 꺼져 있으면 서비스를 부르지 않는다', async () => {
    vi.stubEnv('LOCAL_LOGIN_ENABLED', 'false');
    expect(await loginWithPassword(null, form({ username: 'admin', password: 'admin' }))).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(service.passwordLogin).not.toHaveBeenCalled();
  });

  it('129자 비밀번호·빈 아이디는 서비스를 부르지 않고 같은 문구', async () => {
    for (const fields of [{ username: 'admin', password: 'x'.repeat(129) }, { username: '', password: 'x' }]) {
      expect(await loginWithPassword(null, form(fields))).toMatchObject({ ok: false, code: 'UNAUTHENTICATED' });
    }
    expect(service.passwordLogin).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

// NextAuth 에 넘기는 설정을 가로채 연결이 맞는지 본다(구글 실제 로그인은 수동 확인 대상).
type Captured = {
  session: { strategy: string; maxAge: number; generateSessionToken: () => string };
  cookies: { sessionToken: { name: string; options: Record<string, unknown> } };
  providers: Array<{ profile: (p: Record<string, unknown>) => Record<string, unknown>; allowDangerousEmailAccountLinking: boolean; checks: string[] }>;
  pages: Record<string, string>;
  callbacks: {
    signIn: (a: { account: unknown; profile: unknown }) => Promise<boolean>;
    session: (a: { session: { expires: string }; user: Record<string, unknown> }) => unknown;
  };
  events: { signOut: (m: unknown) => Promise<void>; signIn: (m: unknown) => Promise<void> };
};
const cap = vi.hoisted(() => ({ config: null as unknown as Captured }));
const db = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), update: vi.fn() },
  account: { findUnique: vi.fn() },
  $transaction: vi.fn(),
}));
const writeAudit = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('next-auth', () => ({
  default: (config: Captured) => {
    cap.config = config;
    return { handlers: {}, signIn: vi.fn(), signOut: vi.fn(), auth: vi.fn() };
  },
}));
vi.mock('next-auth/providers/google', () => ({ default: (opts: object) => ({ id: 'google', ...opts }) }));
vi.mock('@/server/db', () => ({ prisma: db }));
vi.mock('@/server/audit', () => ({ writeAudit }));
vi.mock('@/server/request-meta', () => ({ getRequestMeta: async () => ({ ip: '203.0.113.1', userAgent: 'ua' }) }));

process.env.AUTH_URL = 'https://sch.example.com';
await import('@/server/auth/config');
const c = () => cap.config;

beforeEach(() => {
  db.user.findUnique.mockReset();
  db.account.findUnique.mockReset();
  writeAudit.mockClear();
});

describe('Auth.js 설정', () => {
  it('database 세션 8시간, 256비트 토큰, Auth.js 와 같은 쿠키(https 면 __Secure-)', () => {
    expect(c().session.strategy).toBe('database');
    expect(c().session.maxAge).toBe(8 * 3600);
    expect(c().session.generateSessionToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(c().cookies.sessionToken).toEqual({
      name: '__Secure-authjs.session-token',
      options: { httpOnly: true, sameSite: 'lax', path: '/', secure: true },
    });
    expect(c().pages).toEqual({ signIn: '/login', error: '/login' });
  });

  it('구글 provider: pkce·state, 사전 등록 사용자 연결 허용, 프로필 이메일 소문자', () => {
    const [google] = c().providers;
    expect(google.checks).toEqual(['pkce', 'state']);
    expect(google.allowDangerousEmailAccountLinking).toBe(true);
    expect(google.profile({ sub: 's1', email: ' A@Example.COM ', name: 'n', picture: 'p' })).toEqual({
      id: 's1',
      email: 'a@example.com',
      name: 'n',
      image: 'p',
    });
  });

  it('signIn 콜백이 등록 사용자 가드에 연결돼 있다', async () => {
    db.user.findUnique.mockResolvedValue({ id: 'u1', active: true });
    db.account.findUnique.mockResolvedValue(null);
    const profile = { email: 'a@example.com', email_verified: true };
    expect(await c().callbacks.signIn({ account: { provider: 'google', providerAccountId: 's1' }, profile })).toBe(true);
    db.user.findUnique.mockResolvedValue(null);
    expect(await c().callbacks.signIn({ account: { provider: 'google', providerAccountId: 's1' }, profile })).toBe(false);
    expect(writeAudit).toHaveBeenCalledWith(db, expect.objectContaining({ action: 'auth.login.denied' }));
  });

  it('session 콜백은 id·name·email·role 만 내보낸다', () => {
    const out = c().callbacks.session({
      session: { expires: 'e' },
      user: { id: 'u1', name: 'n', email: 'a@example.com', role: 'ADMIN', passwordHash: 'h', emailVerified: null },
    });
    expect(out).toEqual({ expires: 'e', user: { id: 'u1', name: 'n', email: 'a@example.com', role: 'ADMIN' } });
  });

  it('events.signOut 은 세션 주인으로 auth.logout 감사', async () => {
    await c().events.signOut({ session: { userId: 'u1', sessionToken: 't', expires: new Date() } });
    expect(writeAudit).toHaveBeenCalledWith(db, expect.objectContaining({ actorId: 'u1', action: 'auth.logout' }));
    writeAudit.mockClear();
    await c().events.signOut({ session: null });
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it('events.signIn 감사가 실패해도 예외를 밖으로 내지 않고 error 로그', async () => {
    db.$transaction.mockRejectedValueOnce(new Error('db down'));
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await expect(c().events.signIn({ user: { id: 'u1' }, account: { provider: 'google' } })).resolves.toBeUndefined();
    const lines = spy.mock.calls.map((x) => String(x[0]));
    spy.mockRestore();
    expect(lines.some((l) => l.includes('auth.login.success.audit_failed'))).toBe(true);
  });
});

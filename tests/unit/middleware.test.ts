import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { config, middleware } from '@/middleware';

afterEach(() => {
  vi.unstubAllEnvs();
});

function req(path: string, init: { method?: string; cookie?: string } = {}) {
  const headers = new Headers();
  if (init.cookie) headers.set('cookie', init.cookie);
  return new NextRequest(new URL(path, 'http://localhost:3000'), { method: init.method ?? 'GET', headers });
}

describe('middleware', () => {
  it('쿠키 없이 보호 경로 → 307 /login?callbackUrl=<경로+쿼리>', () => {
    vi.stubEnv('AUTH_URL', 'http://localhost:3000');
    const res = middleware(req('/timeline?x=1&y=%2F'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('http://localhost:3000/login?callbackUrl=%2Ftimeline%3Fx%3D1%26y%3D%252F');
    // 리디렉션 응답에도 보안 헤더
    expect(res.headers.get('content-security-policy')).toContain("'strict-dynamic'");
    expect(res.headers.get('x-frame-options')).toBe('DENY');
  });

  it('공개 경로는 정확한 경로·하위 경로만(접두어 흉내는 보호)', () => {
    for (const p of ['/login', '/login?callbackUrl=%2Fx', '/about', '/privacy', '/logo.png', '/api/auth/session', '/api/health', '/robots.txt']) {
      expect(middleware(req(p)).status, p).toBe(200);
    }
    for (const p of ['/loginx', '/api/authx', '/api/healthz', '/admin/users']) {
      expect(middleware(req(p)).status, p).toBe(307);
    }
  });

  it('요청 헤더로 넘긴 nonce 와 응답 CSP 의 nonce 가 같고 요청마다 다르다', () => {
    const a = middleware(req('/login'));
    const b = middleware(req('/login'));
    const nonceOf = (r: Response) => /'nonce-([^']+)'/.exec(r.headers.get('content-security-policy')!)![1];
    expect(a.headers.get('x-middleware-request-x-nonce')).toBe(nonceOf(a));
    expect(nonceOf(a)).not.toBe(nonceOf(b));
  });

  it('GET 페이지 요청만 쿠키 만료를 연장한다(POST·/api/ 제외)', () => {
    vi.stubEnv('AUTH_URL', 'http://localhost:3000');
    const cookie = 'authjs.session-token=abc';
    const get = middleware(req('/timeline', { cookie }));
    const setCookie = get.headers.get('set-cookie') ?? '';
    expect(setCookie).toMatch(/^authjs\.session-token=abc;/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=lax/i);
    const expires = Date.parse(/Expires=([^;]+)/i.exec(setCookie)![1]);
    expect(expires - Date.now()).toBeGreaterThan(7.9 * 3600 * 1000);
    expect(expires - Date.now()).toBeLessThanOrEqual(8 * 3600 * 1000 + 1000);

    expect(middleware(req('/timeline', { cookie, method: 'POST' })).headers.get('set-cookie')).toBeNull();
    expect(middleware(req('/api/auth/callback/google', { cookie })).headers.get('set-cookie')).toBeNull();
  });

  it('https 면 __Secure- 쿠키와 HSTS·upgrade-insecure-requests', () => {
    vi.stubEnv('AUTH_URL', 'https://sch.example.com');
    const res = middleware(req('/timeline', { cookie: '__Secure-authjs.session-token=abc' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('strict-transport-security')).toBe('max-age=31536000; includeSubDomains');
    expect(res.headers.get('content-security-policy')).toContain('upgrade-insecure-requests');
    expect(res.headers.get('set-cookie')).toMatch(/^__Secure-authjs\.session-token=abc;.*Secure/i);
    // http 용 쿠키 이름으로는 로그인 상태가 아니다
    expect(middleware(req('/timeline', { cookie: 'authjs.session-token=abc' })).status).toBe(307);
  });

  it('matcher 는 정적 자산과 prefetch 를 제외한다', () => {
    const [m] = config.matcher;
    expect(m.source).toBe('/((?!_next/static|_next/image|favicon.ico).*)');
    expect(m.missing).toEqual([
      { type: 'header', key: 'next-router-prefetch' },
      { type: 'header', key: 'purpose', value: 'prefetch' },
    ]);
  });
});

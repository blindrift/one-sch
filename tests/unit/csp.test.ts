import { describe, expect, it } from 'vitest';
import { buildCsp, createNonce, securityHeaders } from '@/lib/csp';

describe('buildCsp', () => {
  it('운영에는 unsafe-eval 이 없고 nonce·strict-dynamic 이 있다', () => {
    const csp = buildCsp({ nonce: 'abc', dev: false, https: true });
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).toContain("script-src 'self' 'nonce-abc' 'strict-dynamic'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self' https://accounts.google.com");
  });

  it('dev 에만 unsafe-eval', () => {
    expect(buildCsp({ nonce: 'n', dev: true, https: false })).toContain("'unsafe-eval'");
  });

  it('https 일 때만 upgrade-insecure-requests', () => {
    expect(buildCsp({ nonce: 'n', dev: false, https: true })).toContain('upgrade-insecure-requests');
    expect(buildCsp({ nonce: 'n', dev: false, https: false })).not.toContain('upgrade-insecure-requests');
  });
});

describe('createNonce', () => {
  it('요청마다 다르고 base64', () => {
    const a = createNonce();
    const b = createNonce();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9+/=]{20,}$/);
  });
});

describe('securityHeaders', () => {
  it('https 일 때만 HSTS', () => {
    const names = (https: boolean) => securityHeaders({ https }).map(([k]) => k);
    expect(names(true)).toContain('Strict-Transport-Security');
    expect(names(false)).not.toContain('Strict-Transport-Security');
    expect(names(false)).toEqual(
      expect.arrayContaining(['X-Frame-Options', 'X-Content-Type-Options', 'Referrer-Policy', 'Permissions-Policy']),
    );
  });
});

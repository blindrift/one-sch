// middleware(Edge)에서 쓴다. node 전용 모듈을 import 하지 않는다.

export function createNonce(): string {
  return btoa(crypto.randomUUID());
}

export function buildCsp({ nonce, dev, https }: { nonce: string; dev: boolean; https: boolean }): string {
  const directives = [
    "default-src 'self'",
    // dev 서버(React Refresh)만 eval 이 필요하다.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    // Next·SVAR 가 style 속성을 쓰므로 unsafe-inline 유지(스크립트 실행과 무관).
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https://lh3.googleusercontent.com",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    // 구글 로그인 POST 뒤 accounts.google.com 으로 302 되는 경우 form-action 이 적용된다.
    "form-action 'self' https://accounts.google.com",
  ];
  if (https) directives.push('upgrade-insecure-requests');
  return directives.join('; ');
}

export function securityHeaders({ https }: { https: boolean }): Array<[string, string]> {
  const headers: Array<[string, string]> = [
    ['X-Frame-Options', 'DENY'],
    ['X-Content-Type-Options', 'nosniff'],
    ['Referrer-Policy', 'strict-origin-when-cross-origin'],
    ['Permissions-Policy', 'camera=(), microphone=(), geolocation=()'],
  ];
  if (https) headers.push(['Strict-Transport-Security', 'max-age=31536000; includeSubDomains']);
  return headers;
}

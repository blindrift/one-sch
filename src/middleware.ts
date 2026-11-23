import { NextResponse, type NextRequest } from 'next/server';
import { buildCsp, createNonce, securityHeaders } from '@/lib/csp';
import { SESSION_IDLE_SECONDS, isHttps, sessionCookie } from '@/server/auth/cookies';

// DB 를 보지 않는다. 세션 유효성·역할·비밀번호 강제 변경은 각 page·action 의 requirePage/requireRole 이 판단한다.
// 여기서는 CSP nonce·보안 헤더, 쿠키가 없을 때의 로그인 화면 이동(UX), 쿠키 만료 연장만 한다.

// /robots.txt 처럼 public/ 의 정적 파일도 로그인 없이 열어 둔다. public/ 에 파일을 추가하면 여기에도 추가한다
// (아니면 비로그인 요청이 /login 으로 리디렉션된다).
const PUBLIC_PREFIXES = ['/login', '/about', '/privacy', '/api/auth', '/api/health', '/robots.txt', '/logo.png'];

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function middleware(req: NextRequest) {
  const https = isHttps();
  const nonce = createNonce();
  const csp = buildCsp({ nonce, dev: process.env.NODE_ENV !== 'production', https });
  const cookie = sessionCookie();
  const token = req.cookies.get(cookie.name)?.value;
  const { pathname, search } = req.nextUrl;

  let res: NextResponse;
  if (!token && !isPublic(pathname)) {
    const url = new URL('/login', req.url);
    url.search = '';
    url.searchParams.set('callbackUrl', `${pathname}${search}`);
    res = NextResponse.redirect(url);
  } else {
    const requestHeaders = new Headers(req.headers);
    requestHeaders.set('x-nonce', nonce);
    requestHeaders.set('Content-Security-Policy', csp);
    // 화면 설정 쿠키(사이드바 접힘)는 요청 헤더로 넘긴다. 아래에서 세션 쿠키를 다시 설정하면 서버 컴포넌트의 cookies() 에
    // 다른 쿠키가 보이지 않는다(Next 가 응답 쿠키로 요청 쿠키를 덮음). 값은 정해진 두 가지만 넘긴다.
    requestHeaders.set('x-og-sidebar', req.cookies.get('og-sidebar')?.value === 'collapsed' ? 'collapsed' : 'open');
    res = NextResponse.next({ request: { headers: requestHeaders } });
    // 쿠키 만료를 DB 유휴 만료와 맞춘다. POST(Server Action·Auth.js)와 /api/(Auth.js 콜백 등)는
    // 그 응답이 쿠키를 바꿀 수 있어 건드리지 않는다.
    if (token && req.method === 'GET' && !pathname.startsWith('/api/')) {
      res.cookies.set(cookie.name, token, {
        ...cookie.options,
        expires: new Date(Date.now() + SESSION_IDLE_SECONDS * 1000),
      });
    }
  }

  res.headers.set('Content-Security-Policy', csp);
  for (const [k, v] of securityHeaders({ https })) res.headers.set(k, v);
  return res;
}

export const config = {
  matcher: [
    {
      source: '/((?!_next/static|_next/image|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};

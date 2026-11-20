// middleware(Edge)와 서버 코드가 함께 쓴다. Prisma·node 전용 모듈을 import 하지 않는다.

export const SESSION_IDLE_SECONDS = 8 * 60 * 60;
export const SESSION_ABSOLUTE_SECONDS = 7 * 24 * 60 * 60;
export const SESSION_TOUCH_SECONDS = 5 * 60;

export function isHttps(): boolean {
  return (process.env.AUTH_URL ?? '').startsWith('https://');
}

/** Auth.js 와 같은 쿠키 이름·옵션. https 면 __Secure- 접두사와 Secure 속성을 쓴다. */
export function sessionCookie() {
  const secure = isHttps();
  return {
    name: secure ? '__Secure-authjs.session-token' : 'authjs.session-token',
    options: { httpOnly: true, sameSite: 'lax' as const, path: '/', secure },
  };
}

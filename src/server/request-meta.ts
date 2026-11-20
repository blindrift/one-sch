import 'server-only';
import { headers } from 'next/headers';

export type RequestMeta = { ip: string; userAgent: string | null };

const MAX_UA = 512;
const IP_LIKE = /^[0-9a-fA-F:.]{2,45}$/;

/**
 * app 포트는 127.0.0.1 에만 열려 있어 요청은 모두 리버스 프록시를 거친다.
 * 프록시가 X-Forwarded-For 끝에 붙인 값(가장 오른쪽)이 프록시가 본 클라이언트 주소다.
 * 클라이언트가 보낸 앞쪽 값은 위조할 수 있으므로 쓰지 않는다.
 */
export function parseClientIp(xff: string | null | undefined): string {
  if (!xff) return 'unknown';
  const parts = xff.split(',').map((p) => p.trim()).filter(Boolean);
  const last = parts.at(-1);
  return last && IP_LIKE.test(last) ? last : 'unknown';
}

export function truncateUserAgent(ua: string | null | undefined): string | null {
  if (!ua) return null;
  return ua.length > MAX_UA ? ua.slice(0, MAX_UA) : ua;
}

export async function getRequestMeta(): Promise<RequestMeta> {
  const h = await headers();
  return {
    ip: parseClientIp(h.get('x-forwarded-for')),
    userAgent: truncateUserAgent(h.get('user-agent')),
  };
}

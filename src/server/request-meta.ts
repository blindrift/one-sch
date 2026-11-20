import 'server-only';
import { isIP } from 'node:net';
import { headers } from 'next/headers';
import { log } from './log';

export type RequestMeta = { ip: string; userAgent: string | null };

const MAX_UA = 512;
const DEFAULT_CLIENT_IP_HEADER = 'x-real-ip';

/**
 * 클라이언트 IP 를 담는 헤더 이름. 리버스 프록시(DSM)가 이 헤더를 자기가 본 주소($remote_addr)로
 * **덮어쓰도록** 설정해야 한다(사용자 지정 헤더 `X-Real-IP: $remote_addr`). 클라이언트가 보낸 값을
 * 덧붙이는 X-Forwarded-For 는 쓰지 않는다.
 */
export function clientIpHeaderName(): string {
  return (process.env.CLIENT_IP_HEADER?.trim() || DEFAULT_CLIENT_IP_HEADER).toLowerCase();
}

/** 단일 IP(v4/v6)만 받는다. 목록·포트·이상한 값은 'unknown'. */
export function parseClientIp(value: string | null | undefined): string {
  const v = value?.trim();
  return v && v.length <= 45 && isIP(v) !== 0 ? v : 'unknown';
}

export function truncateUserAgent(ua: string | null | undefined): string | null {
  if (!ua) return null;
  return ua.length > MAX_UA ? ua.slice(0, MAX_UA) : ua;
}

let warnedMissingIp = false;

export async function getRequestMeta(): Promise<RequestMeta> {
  const h = await headers();
  const header = clientIpHeaderName();
  const ip = parseClientIp(h.get(header));
  if (ip === 'unknown' && !warnedMissingIp) {
    // 'unknown' 은 모든 요청이 한 IP 로 묶여 IP 제한이 전역 제한이 된다. 프록시 설정을 확인하라는 신호.
    warnedMissingIp = true;
    log.warn('request_meta.client_ip_missing', { header });
  }
  return { ip, userAgent: truncateUserAgent(h.get('user-agent')) };
}

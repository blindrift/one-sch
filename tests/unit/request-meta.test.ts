import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock('next/headers', () => ({ headers: async () => h.headers }));

const { clientIpHeaderName, getRequestMeta, parseClientIp, truncateUserAgent } = await import('@/server/request-meta');

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('parseClientIp', () => {
  it('단일 IPv4·IPv6 만 받는다', () => {
    expect(parseClientIp('203.0.113.7')).toBe('203.0.113.7');
    expect(parseClientIp(' 2001:db8::1 ')).toBe('2001:db8::1');
  });

  it('목록·포트·잘못된 값·없음은 unknown', () => {
    for (const bad of [null, undefined, '', ' ', '1.1.1.1, 2.2.2.2', '1.2.3.4:5678', '999.1.1.1', '<script>', 'a'.repeat(100)]) {
      expect(parseClientIp(bad)).toBe('unknown');
    }
  });
});

describe('clientIpHeaderName', () => {
  it('기본은 x-real-ip, CLIENT_IP_HEADER 로 바꿀 수 있고 소문자로', () => {
    vi.stubEnv('CLIENT_IP_HEADER', undefined);
    expect(clientIpHeaderName()).toBe('x-real-ip');
    vi.stubEnv('CLIENT_IP_HEADER', 'X-Client-IP');
    expect(clientIpHeaderName()).toBe('x-client-ip');
  });
});

describe('getRequestMeta', () => {
  beforeEach(() => {
    vi.stubEnv('CLIENT_IP_HEADER', undefined);
  });

  it('설정한 헤더만 쓰고 X-Forwarded-For 는 무시한다', async () => {
    h.headers = new Headers({ 'x-real-ip': '198.51.100.4', 'x-forwarded-for': '6.6.6.6', 'user-agent': 'ua' });
    expect(await getRequestMeta()).toEqual({ ip: '198.51.100.4', userAgent: 'ua' });
    h.headers = new Headers({ 'x-forwarded-for': '6.6.6.6' });
    expect((await getRequestMeta()).ip).toBe('unknown');
  });

  it('헤더가 없으면 unknown 이고 경고는 프로세스당 한 번', async () => {
    // 앞 테스트에서 이미 경고했을 수 있으므로 모듈을 새로 불러온다.
    vi.resetModules();
    const fresh = await import('@/server/request-meta');
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    h.headers = new Headers();
    expect((await fresh.getRequestMeta()).ip).toBe('unknown');
    await fresh.getRequestMeta();
    const warns = spy.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('request_meta.client_ip_missing'));
    spy.mockRestore();
    expect(warns).toHaveLength(1);
    expect(JSON.parse(warns[0])).toMatchObject({ level: 'warn', header: 'x-real-ip' });
  });
});

describe('truncateUserAgent', () => {
  it('512자로 자른다', () => {
    expect(truncateUserAgent('x'.repeat(600))).toHaveLength(512);
    expect(truncateUserAgent('Mozilla/5.0')).toBe('Mozilla/5.0');
    expect(truncateUserAgent(null)).toBeNull();
  });
});

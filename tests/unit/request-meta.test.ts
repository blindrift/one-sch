import { describe, expect, it } from 'vitest';
import { parseClientIp, truncateUserAgent } from '@/server/request-meta';

describe('parseClientIp', () => {
  it('X-Forwarded-For 의 가장 오른쪽 값을 쓴다', () => {
    expect(parseClientIp('1.1.1.1, 10.0.0.2, 203.0.113.7')).toBe('203.0.113.7');
    expect(parseClientIp('203.0.113.7')).toBe('203.0.113.7');
  });

  it('클라이언트가 앞에 넣은 위조 값은 무시한다', () => {
    expect(parseClientIp('6.6.6.6,198.51.100.4')).toBe('198.51.100.4');
  });

  it('IPv6 를 허용한다', () => {
    expect(parseClientIp('2001:db8::1')).toBe('2001:db8::1');
  });

  it('없거나 이상한 값은 unknown', () => {
    expect(parseClientIp(null)).toBe('unknown');
    expect(parseClientIp('')).toBe('unknown');
    expect(parseClientIp(' , ')).toBe('unknown');
    expect(parseClientIp('1.1.1.1, <script>')).toBe('unknown');
    expect(parseClientIp('a'.repeat(100))).toBe('unknown');
  });
});

describe('truncateUserAgent', () => {
  it('512자로 자른다', () => {
    expect(truncateUserAgent('x'.repeat(600))).toHaveLength(512);
    expect(truncateUserAgent('Mozilla/5.0')).toBe('Mozilla/5.0');
    expect(truncateUserAgent(null)).toBeNull();
  });
});

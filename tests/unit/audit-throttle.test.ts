import { beforeEach, describe, expect, it } from 'vitest';
import { firstInWindow, resetAuditThrottle } from '@/server/audit-throttle';

beforeEach(resetAuditThrottle);

describe('firstInWindow', () => {
  it('창 안에서는 첫 1회만 true, 창이 지나면 다시 true', () => {
    const t = 1_000_000;
    expect(firstInWindow('k', 60_000, t)).toBe(true);
    expect(firstInWindow('k', 60_000, t + 59_999)).toBe(false);
    expect(firstInWindow('other', 60_000, t + 1)).toBe(true);
    expect(firstInWindow('k', 60_000, t + 60_000)).toBe(true);
  });

  it('키가 많아져도 메모리가 상한을 넘지 않는다(가장 오래된 키부터 잊음)', () => {
    for (let i = 0; i < 6000; i++) firstInWindow(`ip-${i}`, 60_000, 1);
    // 가장 오래된 키는 잊혀 다시 처음으로 본다
    expect(firstInWindow('ip-0', 60_000, 2)).toBe(true);
    // 최근 키는 기억한다
    expect(firstInWindow('ip-5999', 60_000, 2)).toBe(false);
  });
});

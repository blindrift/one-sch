import { describe, expect, it } from 'vitest';
import { dayHighlight } from '@/components/gantt/scales';
import { ymdToLocalDate } from '@/lib/dates';

describe('dayHighlight: 일 줌 칸 강조', () => {
  const today = '2026-11-23'; // 월요일
  it('토·일은 og-weekend, 평일은 빈 값', () => {
    expect(dayHighlight(ymdToLocalDate('2026-11-21'), 'day', today)).toBe('og-weekend'); // 토
    expect(dayHighlight(ymdToLocalDate('2026-11-22'), 'day', today)).toBe('og-weekend'); // 일
    expect(dayHighlight(ymdToLocalDate('2026-11-20'), 'day', today)).toBe(''); // 금
  });
  it('오늘은 og-today, 주말인 오늘은 둘 다', () => {
    expect(dayHighlight(ymdToLocalDate(today), 'day', today)).toBe('og-today');
    expect(dayHighlight(ymdToLocalDate('2026-11-22'), 'day', '2026-11-22')).toBe('og-weekend og-today');
  });
  it('주·월 단위 칸(주·월 줌, 일 줌의 월 머리글)에는 붙이지 않는다', () => {
    expect(dayHighlight(ymdToLocalDate('2026-11-22'), 'week', today)).toBe('');
    expect(dayHighlight(ymdToLocalDate(today), 'month', today)).toBe('');
  });
});

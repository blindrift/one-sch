import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addDaysYmd,
  daysInclusive,
  isValidYmd,
  parseYmd,
  svarEndFromYmd,
  todayInSeoul,
  toYmd,
  ymdFromLocalDate,
  ymdFromSvarEnd,
  ymdToLocalDate,
} from '@/lib/dates';

afterEach(() => vi.unstubAllEnvs());

describe('isValidYmd·parseYmd', () => {
  it.each(['2026-02-30', '2026-13-01', '2026-1-01', '1999-12-31', '2101-01-01', '2026-02-29', '', '2026/01/01', 20260101])(
    '%s 는 거부',
    (v) => {
      expect(isValidYmd(v)).toBe(false);
    },
  );
  it.each(['2000-01-01', '2100-12-31', '2028-02-29', '2026-11-23'])('%s 는 허용', (v) => {
    expect(isValidYmd(v)).toBe(true);
    expect(toYmd(parseYmd(v))).toBe(v);
  });
  it('parseYmd 는 잘못된 값에 예외', () => {
    expect(() => parseYmd('2026-02-30')).toThrow(RangeError);
  });
  it('addDaysYmd·daysInclusive', () => {
    expect(addDaysYmd('2026-02-27', 2)).toBe('2026-03-01');
    expect(addDaysYmd('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDaysYmd('2026-01-01', -1)).toBe('2025-12-31');
    expect(daysInclusive('2026-11-23', '2026-11-23')).toBe(1);
    expect(daysInclusive('2026-11-23', '2026-11-30')).toBe(8);
  });
});

describe('todayInSeoul', () => {
  it('UTC 14:59 는 당일, 15:00 은 다음 날', () => {
    expect(todayInSeoul(new Date('2026-11-23T14:59:59Z'))).toBe('2026-11-23');
    expect(todayInSeoul(new Date('2026-11-23T15:00:00Z'))).toBe('2026-11-24');
  });
  it('프로세스 TZ 와 무관', () => {
    const at = new Date('2026-12-31T15:30:00Z');
    vi.stubEnv('TZ', 'America/Los_Angeles');
    expect(todayInSeoul(at)).toBe('2027-01-01');
    vi.stubEnv('TZ', 'UTC');
    expect(todayInSeoul(at)).toBe('2027-01-01');
  });
});

describe('SVAR 변환(로컬 자정, 배타 종료)', () => {
  // 2026-03-08·11-01 = 미국 DST 시작·끝, 2026-03-29·10-25 = 영국 DST 시작·끝
  const CASES = ['2026-11-23', '2026-01-31', '2026-12-31', '2028-02-29', '2026-03-07', '2026-03-08', '2026-11-01', '2026-03-29', '2026-10-25'];
  /** TZ 별 getTimezoneOffset 기대값(1월, 7월). stubEnv 가 실제로 반영됐는지 확인해 테스트가 헛돌지 않게 한다. */
  const OFFSETS: Record<string, [number, number]> = {
    'Asia/Seoul': [-540, -540],
    'America/Los_Angeles': [480, 420],
    UTC: [0, 0],
    'Europe/London': [0, -60],
  };

  for (const [tz, [winter, summer]] of Object.entries(OFFSETS)) {
    it(`${tz}: 시작·종료 왕복이 원래 날짜`, () => {
      vi.stubEnv('TZ', tz);
      expect(new Date(2026, 0, 15).getTimezoneOffset()).toBe(winter);
      expect(new Date(2026, 6, 15).getTimezoneOffset()).toBe(summer);
      for (const ymd of CASES) {
        const start = ymdToLocalDate(ymd);
        expect(start.getHours()).toBe(0);
        expect(ymdFromLocalDate(start)).toBe(ymd);
        const end = svarEndFromYmd(ymd);
        expect(ymdFromSvarEnd(end)).toBe(ymd);
        // 배타 종료는 다음 날
        expect(ymdFromLocalDate(end)).toBe(addDaysYmd(ymd, 1));
      }
    });

    it(`${tz}: 자정에서 몇 시간 어긋난 값(DST·ms 덧셈)도 가까운 날로 맞춘다`, () => {
      vi.stubEnv('TZ', tz);
      expect(new Date(2026, 0, 15).getTimezoneOffset()).toBe(winter);
      for (const ymd of ['2026-03-08', '2026-03-29', '2026-10-25']) {
        const d = ymdToLocalDate(ymd);
        expect(ymdFromLocalDate(new Date(d.getTime() - 60 * 60 * 1000))).toBe(ymd);
        expect(ymdFromLocalDate(new Date(d.getTime() + 60 * 60 * 1000))).toBe(ymd);
        expect(ymdFromSvarEnd(new Date(svarEndFromYmd(ymd).getTime() - 60 * 60 * 1000))).toBe(ymd);
      }
    });
  }

  it('마일스톤(시작=종료)도 왕복', () => {
    vi.stubEnv('TZ', 'America/Los_Angeles');
    // TZ 변경이 실제로 반영되는지(테스트가 헛돌지 않게)
    expect(new Date(2026, 0, 1).getTimezoneOffset()).toBe(480);
    expect(ymdFromSvarEnd(svarEndFromYmd('2028-02-29'))).toBe('2028-02-29');
  });
});

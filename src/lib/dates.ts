// 날짜만 다루는 값(@db.Date)의 공용 처리. 서버·DTO 는 언제나 `YYYY-MM-DD` 문자열(포함 종료일)이다.
// - 서버 쪽 변환은 UTC 기준 함수만 쓴다(로컬 getter 금지) → 서버 TZ 와 무관.
// - 간트(SVAR)는 로컬 자정 Date 와 배타 종료일을 쓰므로 그 변환은 아래 svar* 함수에서만 한다.

export const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
export const MIN_YEAR = 2000;
export const MAX_YEAR = 2100;
const DAY_MS = 24 * 60 * 60 * 1000;

/** `YYYY-MM-DD` 형식이고 실제로 있는 날짜이며 2000–2100년이면 true */
export function isValidYmd(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const m = YMD_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < MIN_YEAR || y > MAX_YEAR) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** `YYYY-MM-DD` → 그 날 UTC 자정 Date(Prisma @db.Date 입력용). 잘못된 값이면 예외. */
export function parseYmd(ymd: string): Date {
  if (!isValidYmd(ymd)) throw new RangeError(`잘못된 날짜: ${ymd}`);
  return new Date(`${ymd}T00:00:00Z`);
}

/** Prisma @db.Date(UTC 자정 Date) → `YYYY-MM-DD` */
export function toYmd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** ymd 에 n 일을 더한다(UTC 계산, 서버·클라이언트 공용) */
export function addDaysYmd(ymd: string, days: number): string {
  return toYmd(new Date(parseYmdLoose(ymd) + days * DAY_MS));
}

/** a~b 포함 일수(a=b 면 1). b<a 면 0 이하 */
export function daysInclusive(a: string, b: string): number {
  return Math.round((parseYmdLoose(b) - parseYmdLoose(a)) / DAY_MS) + 1;
}

/** 범위 검사 없이 ymd → UTC ms(이미 검증된 값 계산용) */
function parseYmdLoose(ymd: string): number {
  const m = YMD_RE.exec(ymd);
  if (!m) throw new RangeError(`잘못된 날짜: ${ymd}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

const SEOUL = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Asia/Seoul 기준 오늘(`YYYY-MM-DD`). 서버가 계산해 화면에 내려준다(브라우저 시간대와 무관). */
export function todayInSeoul(now: Date = new Date()): string {
  const parts = Object.fromEntries(SEOUL.formatToParts(now).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// --- 간트(SVAR) 변환: 브라우저 로컬 자정 기준 ---

/** ymd → 그 날 로컬 자정 Date */
export function ymdToLocalDate(ymd: string): Date {
  const m = YMD_RE.exec(ymd);
  if (!m) throw new RangeError(`잘못된 날짜: ${ymd}`);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/**
 * 로컬 Date → 가장 가까운 로컬 자정의 ymd. 드래그 결과가 자정에서 몇 시간 어긋나도(DST 등) 같은 날로 맞춘다.
 */
export function ymdFromLocalDate(date: Date): string {
  const shifted = new Date(date.getFullYear(), date.getMonth(), date.getDate() + (date.getHours() >= 12 ? 1 : 0));
  const y = shifted.getFullYear();
  const mo = String(shifted.getMonth() + 1).padStart(2, '0');
  const d = String(shifted.getDate()).padStart(2, '0');
  return `${y}-${mo}-${d}`;
}

/** 포함 종료일 ymd → SVAR 배타 종료(다음 날 로컬 자정) */
export function svarEndFromYmd(ymd: string): Date {
  const d = ymdToLocalDate(ymd);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
}

/** SVAR 배타 종료 → 포함 종료일 ymd(가까운 로컬 자정으로 맞춘 뒤 하루 뺀다) */
export function ymdFromSvarEnd(end: Date): string {
  const ymd = ymdFromLocalDate(end);
  const d = ymdToLocalDate(ymd);
  return ymdFromLocalDate(new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1));
}

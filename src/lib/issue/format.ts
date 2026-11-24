// 이슈·댓글 시각 표시(서버·브라우저가 같은 문자열을 만들도록 시간대를 Asia/Seoul 로 고정한다 — 하이드레이션 불일치 방지).
const DATE_TIME = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** ISO 시각 → `2026. 11. 24. 14:05` 형식(Asia/Seoul) */
export function formatDateTime(iso: string): string {
  return DATE_TIME.format(new Date(iso));
}

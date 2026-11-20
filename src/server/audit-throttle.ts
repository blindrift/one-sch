import 'server-only';

// 같은 사건이 반복될 때 감사 로그(append-only, 정리 비용 큼)에는 창마다 첫 1회만 남기기 위한 판정.
// app 은 한 프로세스로 돌므로 메모리로 충분하다. 재시작하면 초기화된다(그때 한 번 더 기록될 뿐).
const MAX_KEYS = 5000;
const seen = new Map<string, number>();

/** key 가 이번 창(windowMs)에서 처음이면 true. */
export function firstInWindow(key: string, windowMs = 60_000, now = Date.now()): boolean {
  const last = seen.get(key);
  if (last !== undefined && now - last < windowMs) return false;
  // 삽입 순서를 갱신해 오래된 키부터 지운다.
  seen.delete(key);
  seen.set(key, now);
  if (seen.size > MAX_KEYS) seen.delete(seen.keys().next().value!);
  return true;
}

/** 테스트 전용 */
export function resetAuditThrottle() {
  seen.clear();
}

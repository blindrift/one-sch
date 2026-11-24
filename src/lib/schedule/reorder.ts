// 형제 작업 순서 바꾸기(D17)의 순수 계산. 서버(reorderTask)와 테스트가 쓴다.

export type ReorderAnchor = { beforeId: string; afterId?: undefined } | { afterId: string; beforeId?: undefined };

/**
 * 형제 id 목록(현재 순서)에서 movingId 를 기준 형제 바로 앞(beforeId)이나 뒤(afterId)로 옮긴 새 순서.
 * movingId·기준이 목록에 없거나 기준이 자기 자신이면 null.
 */
export function reorderIds(ids: readonly string[], movingId: string, anchor: ReorderAnchor): string[] | null {
  const anchorId = anchor.beforeId ?? anchor.afterId;
  if (!anchorId || anchorId === movingId || !ids.includes(movingId) || !ids.includes(anchorId)) return null;
  const rest = ids.filter((id) => id !== movingId);
  const at = rest.indexOf(anchorId) + (anchor.afterId ? 1 : 0);
  return [...rest.slice(0, at), movingId, ...rest.slice(at)];
}

/**
 * 새 순서에 줄 sortOrder 값. 형제들이 쓰던 값을 정렬해 그대로 다시 나눠 준다(다른 형제 묶음·max+1 규칙과 섞이지 않게).
 * 값이 겹쳐 있으면(옛 데이터) 가장 작은 값부터 1씩 늘린다.
 */
export function sortOrdersFor(oldValues: readonly number[]): number[] {
  const sorted = [...oldValues].sort((a, b) => a - b);
  const strictly = sorted.every((v, i) => i === 0 || v > sorted[i - 1]);
  return strictly ? sorted : sorted.map((_, i) => (sorted[0] ?? 0) + i);
}

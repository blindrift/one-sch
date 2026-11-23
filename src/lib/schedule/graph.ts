// 작업 계층·의존 그래프의 순수 계산. 서버(권위 있는 검사)와 클라이언트(UX 사전 검사)가 같은 함수를 쓴다.

export type Edge = { from: string; to: string };

/** from → to 간선을 더하면 순환이 생기는지(to 에서 from 으로 가는 길이 이미 있는지). 자기 자신이면 true. */
export function createsCycle(edges: readonly Edge[], from: string, to: string): boolean {
  if (from === to) return true;
  const next = new Map<string, string[]>();
  for (const e of edges) {
    const list = next.get(e.from);
    if (list) list.push(e.to);
    else next.set(e.from, [e.to]);
  }
  const stack = [to];
  const seen = new Set<string>();
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === from) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    const out = next.get(cur);
    if (out) for (const n of out) if (!seen.has(n)) stack.push(n);
  }
  return false;
}

/** parentOf: id → 상위 id(null 이면 최상위). 자기 자신·조상 사슬을 따라가며 순환이 있으면 멈춘다. */
export type ParentMap = ReadonlyMap<string, string | null>;

/** ancestorId 가 id 의 (엄격한) 조상인지 */
export function isAncestor(parentOf: ParentMap, ancestorId: string, id: string): boolean {
  const seen = new Set<string>([id]);
  let cur = parentOf.get(id) ?? null;
  while (cur) {
    if (cur === ancestorId) return true;
    if (seen.has(cur)) return false;
    seen.add(cur);
    cur = parentOf.get(cur) ?? null;
  }
  return false;
}

/** 조상 id 목록(가까운 순) */
export function ancestorsOf(parentOf: ParentMap, id: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>([id]);
  let cur = parentOf.get(id) ?? null;
  while (cur && !seen.has(cur)) {
    out.push(cur);
    seen.add(cur);
    cur = parentOf.get(cur) ?? null;
  }
  return out;
}

/** 깊이(최상위 = 1) */
export function depthOf(parentOf: ParentMap, id: string): number {
  return ancestorsOf(parentOf, id).length + 1;
}

/** 하위 트리의 높이(잎 = 1). children: id → 하위 id 목록 */
export function subtreeHeight(children: ReadonlyMap<string, readonly string[]>, id: string): number {
  let height = 0;
  let level = [id];
  const seen = new Set<string>();
  while (level.length) {
    height += 1;
    const nextLevel: string[] = [];
    for (const n of level) {
      if (seen.has(n)) continue;
      seen.add(n);
      nextLevel.push(...(children.get(n) ?? []));
    }
    level = nextLevel;
  }
  return height;
}

/** movingId 와 그 후손(S)의 의존 상대 중 S 밖에 있는 작업 id */
export function subtreeDependencyPartners(parentOf: ParentMap, edges: readonly Edge[], movingId: string): Set<string> {
  const inSubtree = (id: string) => id === movingId || isAncestor(parentOf, movingId, id);
  const out = new Set<string>();
  for (const e of edges) {
    const a = inSubtree(e.from);
    const b = inSubtree(e.to);
    if (a && !b) out.add(e.to);
    else if (b && !a) out.add(e.from);
  }
  return out;
}

/**
 * movingId(와 하위 트리)를 newParentId 밑으로 옮기면 상위·하위 사이 의존이 생기는지(D14 를 계층 변경에도 적용).
 * S = 옮기는 작업 + 후손, P = 새 상위 + 그 조상. 한 끝이 S, 다른 끝이 P 인 의존이 하나라도 있으면 true.
 * partners 는 subtreeDependencyPartners 결과(후보 여럿을 볼 때 한 번만 계산해 넘긴다).
 */
export function moveCreatesHierarchyDependency(
  parentOf: ParentMap,
  edges: readonly Edge[],
  movingId: string,
  newParentId: string,
  partners: ReadonlySet<string> = subtreeDependencyPartners(parentOf, edges, movingId),
): boolean {
  if (partners.size === 0) return false;
  return partners.has(newParentId) || ancestorsOf(parentOf, newParentId).some((a) => partners.has(a));
}

// 상위 작업 요약(설계 6.1): 하위의 최소 시작~최대 종료, 진행률은 기간 가중 평균(마일스톤은 1일).
import { daysInclusive } from '../dates';

export type RollupInput = { startDate: string; endDate: string; progress: number; isMilestone: boolean };
export type RollupValue = { startDate: string; endDate: string; progress: number };

/** 하위 작업 목록으로 상위의 기간·진행률을 계산한다. 하위가 없으면 null. */
export function summarize(children: readonly RollupInput[]): RollupValue | null {
  if (!children.length) return null;
  let start = children[0].startDate;
  let end = children[0].endDate;
  let weighted = 0;
  let weight = 0;
  for (const c of children) {
    if (c.startDate < start) start = c.startDate;
    if (c.endDate > end) end = c.endDate;
    const w = c.isMilestone ? 1 : Math.max(1, daysInclusive(c.startDate, c.endDate));
    weighted += c.progress * w;
    weight += w;
  }
  return { startDate: start, endDate: end, progress: Math.round(weighted / weight) };
}

export type TreeNode = RollupInput & { id: string; parentId: string | null };

/** 트리 전체를 아래에서 위로 다시 계산한다(검증·표시용). 하위가 있는 노드만 값이 바뀐다. */
export function rollupTree<T extends TreeNode>(nodes: readonly T[]): Map<string, RollupValue> {
  const byId = new Map(nodes.map((n) => [n.id, { ...n }]));
  const children = new Map<string, string[]>();
  for (const n of nodes) {
    if (n.parentId && byId.has(n.parentId)) {
      const list = children.get(n.parentId);
      if (list) list.push(n.id);
      else children.set(n.parentId, [n.id]);
    }
  }
  const out = new Map<string, RollupValue>();
  const visiting = new Set<string>();
  const visit = (id: string): RollupInput => {
    const node = byId.get(id)!;
    const kids = children.get(id);
    if (!kids || visiting.has(id)) return node;
    visiting.add(id);
    const value = summarize(kids.map(visit))!;
    visiting.delete(id);
    Object.assign(node, value);
    out.set(id, value);
    return node;
  };
  for (const n of nodes) visit(n.id);
  return out;
}

/** 지연(설계 6.2): 종료일 < 오늘(Asia/Seoul) 이고 완료가 아님. 요약(하위가 있는) 행은 제외. */
export function isLate(task: { endDate: string; status: string; hasChildren: boolean }, today: string): boolean {
  return !task.hasChildren && task.status !== 'DONE' && task.endDate < today;
}

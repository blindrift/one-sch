// 작업 목록 탭의 행 계산(서버·테스트 공용 순수 함수). 프로젝트 하나의 작업(수백 건)을 모두 읽어 메모리에서
// 계층 순서·상위 경로·필터·정렬·페이지를 계산한다(간트와 같은 데이터, 같은 순서).
import { PAGE_SIZE, NO_ASSIGNEE, type TaskListQuery } from './list-query';
import type { TaskDto, UserOption } from './schedule/dto';
import { isLate } from './schedule/rollup';
import { TASK_STATUSES } from './schedule/status';

export type TaskListRow = TaskDto & {
  /** 계층 깊이(최상위 0) */
  depth: number;
  /** 조상 제목(최상위부터 바로 위까지) */
  path: string[];
  assigneeName: string | null;
  late: boolean;
};

export type TaskListPage = { rows: TaskListRow[]; total: number; page: number; pageCount: number; /** 강조할 작업이 이 페이지에 있으면 그 id */ focusId: string | null };

type TreeItem = { id: string; parentId: string | null; sortOrder: number };
const bySortOrder = (a: TreeItem, b: TreeItem) => a.sortOrder - b.sortOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** 간트와 같은 순서: 같은 상위의 형제는 sortOrder 순, 상위 다음에 그 하위(깊이 우선). 상위가 목록에 없으면 최상위로 본다 */
export function treeOrder<T extends TreeItem>(tasks: readonly T[]): T[] {
  const ids = new Set(tasks.map((t) => t.id));
  const children = new Map<string | null, T[]>();
  for (const t of tasks) {
    const key = t.parentId && ids.has(t.parentId) ? t.parentId : null;
    const list = children.get(key);
    if (list) list.push(t);
    else children.set(key, [t]);
  }
  for (const list of children.values()) list.sort(bySortOrder);
  const out: T[] = [];
  const seen = new Set<string>();
  const visit = (parent: string | null) => {
    for (const t of children.get(parent) ?? []) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      out.push(t);
      visit(t.id);
    }
  };
  visit(null);
  return out;
}

const STATUS_RANK = new Map(TASK_STATUSES.map((s, i) => [s, i]));
const collator = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' });

function compareBy(sort: TaskListQuery['sort']): ((a: TaskListRow, b: TaskListRow) => number) | null {
  switch (sort) {
    case 'title':
      return (a, b) => collator.compare(a.title, b.title);
    case 'start':
      return (a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0);
    case 'end':
      return (a, b) => (a.endDate < b.endDate ? -1 : a.endDate > b.endDate ? 1 : 0);
    case 'progress':
      return (a, b) => a.progress - b.progress;
    case 'status':
      return (a, b) => STATUS_RANK.get(a.status)! - STATUS_RANK.get(b.status)!;
    case 'order':
      return null;
  }
}

export function buildTaskList(tasks: readonly TaskDto[], users: readonly UserOption[], today: string, query: TaskListQuery): TaskListPage {
  const names = new Map(users.map((u) => [u.id, u.name]));
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const ordered = treeOrder(tasks);
  const rank = new Map(ordered.map((t, i) => [t.id, i]));

  let rows: TaskListRow[] = ordered.map((t) => {
    const path: string[] = [];
    const seen = new Set<string>();
    for (let p = t.parentId ? byId.get(t.parentId) : undefined; p && !seen.has(p.id); p = p.parentId ? byId.get(p.parentId) : undefined) {
      seen.add(p.id);
      path.unshift(p.title);
    }
    return {
      ...t,
      depth: path.length,
      path,
      assigneeName: t.assigneeId ? (names.get(t.assigneeId) ?? null) : null,
      late: isLate(t, today),
    };
  });

  if (query.status) rows = rows.filter((r) => r.status === query.status);
  if (query.assignee) rows = rows.filter((r) => (query.assignee === NO_ASSIGNEE ? r.assigneeId === null : r.assigneeId === query.assignee));
  if (query.q) {
    const needle = query.q.toLocaleLowerCase('ko');
    rows = rows.filter((r) => r.title.toLocaleLowerCase('ko').includes(needle));
  }
  const cmp = compareBy(query.sort);
  if (cmp) {
    const sign = query.dir === 'desc' ? -1 : 1;
    // 같은 값이면 간트 순서(안정 정렬, 페이지 경계가 흔들리지 않게)
    rows = [...rows].sort((a, b) => sign * cmp(a, b) || rank.get(a.id)! - rank.get(b.id)!);
  } else if (query.dir === 'desc') {
    rows = [...rows].reverse();
  }

  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // 강조할 작업이 걸러진 결과에 있으면 그 작업이 있는 페이지를 보인다(page 값보다 우선)
  const focusIndex = query.task ? rows.findIndex((r) => r.id === query.task) : -1;
  const page = focusIndex >= 0 ? Math.floor(focusIndex / PAGE_SIZE) + 1 : Math.min(query.page, pageCount);
  return { rows: rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), total, page, pageCount, focusId: focusIndex >= 0 ? query.task : null };
}

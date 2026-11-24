// 보드 탭의 열 계산(클라이언트·서버 공용 순수 함수). 열 = 상태, 열 안은 종료일(이슈는 마감일) 순(D20).
import type { IssueStatus } from './issue/status';
import { ISSUE_STATUSES } from './issue/status';
import type { TaskDto } from './schedule/dto';
import { TASK_STATUSES, type TaskStatus } from './schedule/status';

export type BoardColumns<S extends string, C> = Record<S, C[]>;

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** 작업 카드 순서: 종료일 → 간트 순서(sortOrder) → id */
export function compareTaskCards(a: TaskDto, b: TaskDto): number {
  return (a.endDate < b.endDate ? -1 : a.endDate > b.endDate ? 1 : 0) || a.sortOrder - b.sortOrder || byId(a, b);
}

export type IssueCardLike = { id: string; status: IssueStatus; dueDate: string | null; projectKey: string; number: number };

/** 이슈 카드 순서: 마감일(없으면 뒤) → 번호 → id */
export function compareIssueCards(a: IssueCardLike, b: IssueCardLike): number {
  if (a.dueDate !== b.dueDate) {
    if (a.dueDate === null) return 1;
    if (b.dueDate === null) return -1;
    return a.dueDate < b.dueDate ? -1 : 1;
  }
  return (a.projectKey < b.projectKey ? -1 : a.projectKey > b.projectKey ? 1 : 0) || a.number - b.number || byId(a, b);
}

/** 보드에 올릴 작업: 기본은 하위가 없는 작업과 마일스톤, includeParents 면 상위(요약) 작업도(D20) */
export function boardTasks(tasks: readonly TaskDto[], includeParents: boolean): TaskDto[] {
  return includeParents ? [...tasks] : tasks.filter((t) => !t.hasChildren || t.isMilestone);
}

function group<S extends string, C extends { status: S }>(statuses: readonly S[], cards: readonly C[], compare: (a: C, b: C) => number) {
  const cols = Object.fromEntries(statuses.map((s) => [s, [] as C[]])) as BoardColumns<S, C>;
  for (const c of cards) cols[c.status]?.push(c);
  for (const s of statuses) cols[s].sort(compare);
  return cols;
}

export function taskColumns(tasks: readonly TaskDto[], includeParents: boolean): BoardColumns<TaskStatus, TaskDto> {
  return group(TASK_STATUSES, boardTasks(tasks, includeParents), compareTaskCards);
}

export function issueColumns<C extends IssueCardLike>(issues: readonly C[]): BoardColumns<IssueStatus, C> {
  return group(ISSUE_STATUSES, issues, compareIssueCards);
}

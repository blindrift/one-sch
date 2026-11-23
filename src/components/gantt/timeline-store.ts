// 타임라인 화면의 클라이언트 쪽 데이터 사본. 서버가 내려준 값(TimelineData)에서 시작해, 액션 결과로만 고친다.
// SVAR 는 tasks prop 이 바뀌면 전체를 다시 읽으므로, 화면은 구조가 바뀔 때(추가·삭제·필터·폼 편집)만 이 사본에서 행을
// 다시 만들고, 드래그 결과는 exec 로 그 자리만 고친다. 그래서 이 객체는 React state 가 아닌 변경 가능한 저장소다.
import type { DependencyDto, ProjectDto, TaskDeleteResult, TaskDto, TaskWriteResult, TimelineData, UserOption } from '@/lib/schedule/dto';
import type { TaskStatus } from '@/lib/schedule/status';
import { filterTasks, projectRowId, projectToRow, toGanttLinks, toGanttRows, type GanttLink, type GanttRow } from './adapter';

/** 화면 필터(URL query 에 보관). 값이 null 이면 거르지 않는다. assigneeId 'none' = 담당자 없음 */
export type TimelineFilter = { projectKey: string | null; assigneeId: string | null; status: TaskStatus | null };
export const EMPTY_FILTER: TimelineFilter = { projectKey: null, assigneeId: null, status: null };
export const UNASSIGNED = 'none';

export type TimelineViewData = { rows: GanttRow[]; links: GanttLink[]; visibleTaskIds: Set<string> };

export class TimelineStore {
  readonly projects: ProjectDto[];
  readonly users: UserOption[];
  readonly today: string;
  readonly tasks = new Map<string, TaskDto>();
  deps: DependencyDto[];
  /** 접힌 행 id(다시 그려도 유지) */
  readonly closed: Set<string>;
  private parentIds: Set<string> | null = null;

  constructor(data: TimelineData, closed: Iterable<string> = []) {
    this.projects = data.projects;
    this.users = data.users;
    this.today = data.today;
    for (const t of data.tasks) this.tasks.set(t.id, t);
    this.deps = [...data.dependencies];
    this.closed = new Set(closed);
  }

  project(id: string): ProjectDto | undefined {
    return this.projects.find((p) => p.id === id);
  }

  isReadonlyProject(projectId: string): boolean {
    return this.project(projectId)?.archived ?? true;
  }

  /** 하위 작업이 있는지(서버의 hasChildren 대신 현재 사본에서 계산) */
  hasChildren(id: string): boolean {
    if (!this.parentIds) {
      this.parentIds = new Set();
      for (const t of this.tasks.values()) if (t.parentId) this.parentIds.add(t.parentId);
    }
    return this.parentIds.has(id);
  }

  task(id: string): TaskDto | undefined {
    const t = this.tasks.get(id);
    return t && { ...t, hasChildren: this.hasChildren(id) };
  }

  /** 현재 작업 목록(hasChildren 을 다시 계산해 붙인다) */
  taskList(): TaskDto[] {
    return [...this.tasks.values()].map((t) => ({ ...t, hasChildren: this.hasChildren(t.id) }));
  }

  /** 하위 작업 id(자기 제외, 깊이 우선) */
  descendantsOf(id: string): string[] {
    const children = new Map<string, string[]>();
    for (const t of this.tasks.values()) {
      if (!t.parentId) continue;
      const l = children.get(t.parentId);
      if (l) l.push(t.id);
      else children.set(t.parentId, [t.id]);
    }
    const out: string[] = [];
    const stack = [...(children.get(id) ?? [])];
    while (stack.length) {
      const cur = stack.pop()!;
      out.push(cur);
      stack.push(...(children.get(cur) ?? []));
    }
    return out;
  }

  applyWrite(result: TaskWriteResult): void {
    for (const t of [result.task, ...result.ancestors]) this.tasks.set(t.id, t);
    this.parentIds = null;
  }

  applyDelete(result: TaskDeleteResult): void {
    const gone = new Set(result.deletedIds);
    for (const id of gone) this.tasks.delete(id);
    this.deps = this.deps.filter((d) => !gone.has(d.fromTaskId) && !gone.has(d.toTaskId));
    for (const t of result.ancestors) this.tasks.set(t.id, t);
    this.parentIds = null;
  }

  addDependency(dep: DependencyDto): void {
    if (!this.deps.some((d) => d.id === dep.id)) this.deps = [...this.deps, dep];
  }

  removeDependency(id: string): void {
    this.deps = this.deps.filter((d) => d.id !== id);
  }

  /** 프로젝트 요약 행(최상위 작업에서 다시 계산) — 드래그 저장 뒤 그 자리만 고칠 때 쓴다 */
  projectRow(projectId: string): GanttRow | null {
    const p = this.project(projectId);
    if (!p) return null;
    const top = this.taskList().filter((t) => t.projectId === projectId && !t.parentId);
    return projectToRow(p, top, !this.closed.has(projectRowId(projectId)));
  }

  /** 필터를 적용한 간트 행·링크 */
  view(filter: TimelineFilter): TimelineViewData {
    const projects = filter.projectKey ? this.projects.filter((p) => p.key === filter.projectKey) : this.projects;
    const projectIds = new Set(projects.map((p) => p.id));
    const tasks = this.taskList().filter((t) => projectIds.has(t.projectId));
    const match =
      filter.assigneeId || filter.status
        ? (t: TaskDto) =>
            (!filter.assigneeId || (filter.assigneeId === UNASSIGNED ? t.assigneeId === null : t.assigneeId === filter.assigneeId)) &&
            (!filter.status || t.status === filter.status)
        : null;
    const visible = filterTasks(tasks, match);
    // 작업 조건으로 거를 때는 맞는 작업이 없는 프로젝트를 숨긴다.
    const shownProjects = match ? projects.filter((p) => visible.some((t) => t.projectId === p.id)) : projects;
    const visibleTaskIds = new Set(visible.map((t) => t.id));
    return {
      rows: toGanttRows({ projects: shownProjects, tasks: visible, users: this.users, today: this.today, closed: this.closed }),
      links: toGanttLinks(this.deps, visibleTaskIds),
      visibleTaskIds,
    };
  }
}

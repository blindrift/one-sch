// 서버 DTO(`YYYY-MM-DD`, 포함 종료일) ↔ SVAR 간트 데이터(로컬 자정 Date, 배타 종료일) 변환을 한 곳에 모은다.
// 순수 함수만 둔다(단위 테스트 대상). 브라우저 시간대가 Seoul 이 아니어도 로컬 자정 왕복이라 날짜가 어긋나지 않는다.
import { svarEndFromYmd, ymdFromLocalDate, ymdFromSvarEnd, ymdToLocalDate } from '@/lib/dates';
import type { DependencyDto, ProjectDto, TaskDto, UserOption } from '@/lib/schedule/dto';
import { createsCycle, isAncestor } from '@/lib/schedule/graph';
import { isLate, summarize } from '@/lib/schedule/rollup';

const PROJECT_PREFIX = 'p:';
export const projectRowId = (projectId: string) => `${PROJECT_PREFIX}${projectId}`;
export const isProjectRow = (id: string) => id.startsWith(PROJECT_PREFIX);

/** SVAR 에 넘기는 행. SVAR 표준 필드 + 화면용 사용자 필드 */
export type GanttRow = {
  id: string;
  text: string;
  start?: Date;
  end?: Date;
  progress: number;
  type: 'task' | 'summary' | 'milestone';
  parent?: string;
  open?: boolean;
  unscheduled?: boolean;
  // --- 사용자 필드(열 템플릿·막대 템플릿용) ---
  kind: 'project' | 'task';
  projectId: string;
  color: string;
  late: boolean;
  /** 서버 값으로만 바뀌는 행(프로젝트·하위가 있는 작업) */
  summary: boolean;
  readonly: boolean;
  assigneeName: string;
  startYmd: string | null;
  endYmd: string | null;
};

export type GanttLink = { id: string; source: string; target: string; type: 'e2s' };

export type AdapterInput = {
  projects: readonly ProjectDto[];
  tasks: readonly TaskDto[];
  users: readonly UserOption[];
  today: string;
  /** 접힌 행 id(프로젝트 행은 projectRowId) */
  closed?: ReadonlySet<string>;
};

/** 작업 하나를 SVAR 행으로 */
export function taskToRow(t: TaskDto, project: ProjectDto, userNames: ReadonlyMap<string, string>, today: string, open = true): GanttRow {
  const start = ymdToLocalDate(t.startDate);
  return {
    id: t.id,
    text: t.title,
    start,
    end: t.isMilestone ? start : svarEndFromYmd(t.endDate),
    progress: t.progress,
    type: t.isMilestone ? 'milestone' : t.hasChildren ? 'summary' : 'task',
    parent: t.parentId ?? projectRowId(t.projectId),
    open,
    kind: 'task',
    projectId: t.projectId,
    color: project.color,
    late: isLate(t, today),
    summary: t.hasChildren,
    readonly: project.archived,
    assigneeName: t.assigneeId ? (userNames.get(t.assigneeId) ?? '') : '',
    startYmd: t.startDate,
    endYmd: t.endDate,
  };
}

/** 프로젝트 행: 작업이 있으면 최상위 작업의 요약, 없으면 프로젝트 기간(D16), 그것도 없으면 막대 없음 */
export function projectToRow(p: ProjectDto, topLevel: readonly TaskDto[], open = true): GanttRow {
  const value = summarize(topLevel);
  const startYmd = value?.startDate ?? (p.startDate && p.endDate ? p.startDate : null);
  const endYmd = value?.endDate ?? (p.startDate && p.endDate ? p.endDate : null);
  const base = {
    id: projectRowId(p.id),
    text: `[${p.key}] ${p.name}`,
    progress: value?.progress ?? 0,
    kind: 'project' as const,
    projectId: p.id,
    color: p.color,
    late: false,
    summary: true,
    readonly: true,
    assigneeName: '',
    startYmd,
    endYmd,
  };
  if (!startYmd || !endYmd) return { ...base, type: 'task', unscheduled: true };
  return {
    ...base,
    // 하위가 없는 summary 는 SVAR 가 경고하므로 작업이 없을 때는 일반 막대로 그린다(편집은 막는다).
    type: topLevel.length ? 'summary' : 'task',
    open: topLevel.length ? open : undefined,
    start: ymdToLocalDate(startYmd),
    end: svarEndFromYmd(endYmd),
  };
}

/** 프로젝트 순서대로, 각 프로젝트 안에서는 sortOrder 순으로(부모가 자식보다 먼저 오게) 행을 만든다. */
export function toGanttRows({ projects, tasks, users, today, closed }: AdapterInput): GanttRow[] {
  const userNames = new Map(users.map((u) => [u.id, u.name]));
  const byProject = new Map<string, TaskDto[]>();
  for (const t of tasks) {
    const list = byProject.get(t.projectId);
    if (list) list.push(t);
    else byProject.set(t.projectId, [t]);
  }
  const rows: GanttRow[] = [];
  for (const p of projects) {
    const list = [...(byProject.get(p.id) ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
    const ids = new Set(list.map((t) => t.id));
    // 상위가 목록에 없으면(필터로 빠짐) 프로젝트 바로 밑에 둔다.
    const normalized = list.map((t) => (t.parentId && !ids.has(t.parentId) ? { ...t, parentId: null } : t));
    rows.push(projectToRow(p, normalized.filter((t) => !t.parentId), !closed?.has(projectRowId(p.id))));
    const children = new Map<string | null, TaskDto[]>();
    for (const t of normalized) {
      const l = children.get(t.parentId);
      if (l) l.push(t);
      else children.set(t.parentId, [t]);
    }
    const walk = (parentId: string | null) => {
      for (const t of children.get(parentId) ?? []) {
        rows.push(taskToRow(t, p, userNames, today, !closed?.has(t.id)));
        walk(t.id);
      }
    };
    walk(null);
  }
  return rows;
}

/** 양 끝 작업이 모두 보이는 의존만 링크로 */
export function toGanttLinks(deps: readonly DependencyDto[], visibleTaskIds: ReadonlySet<string>): GanttLink[] {
  return deps
    .filter((d) => visibleTaskIds.has(d.fromTaskId) && visibleTaskIds.has(d.toTaskId))
    .map((d) => ({ id: d.id, source: d.fromTaskId, target: d.toTaskId, type: 'e2s' as const }));
}

/** SVAR 가 알려 준 막대 값(드래그 결과) → 바뀐 필드만 담은 저장 요청 */
export function dragPatch(
  before: Pick<TaskDto, 'startDate' | 'endDate' | 'progress' | 'isMilestone'>,
  after: { start?: Date | null; end?: Date | null; progress?: number | null },
): Partial<Pick<TaskDto, 'startDate' | 'endDate' | 'progress'>> {
  const patch: Partial<Pick<TaskDto, 'startDate' | 'endDate' | 'progress'>> = {};
  if (after.start) {
    const s = ymdFromLocalDate(after.start);
    if (s !== before.startDate) patch.startDate = s;
    if (before.isMilestone && s !== before.endDate) patch.endDate = s;
  }
  if (!before.isMilestone && after.end) {
    const e = ymdFromSvarEnd(after.end);
    if (e !== before.endDate) patch.endDate = e;
  }
  if (after.progress !== undefined && after.progress !== null) {
    const pr = Math.min(100, Math.max(0, Math.round(after.progress)));
    if (pr !== before.progress) patch.progress = pr;
  }
  return patch;
}

/** 서버 값 → SVAR update-task 의 task 인자(막대 값만) */
export function rowValues(t: TaskDto) {
  const start = ymdToLocalDate(t.startDate);
  return {
    start,
    end: t.isMilestone ? start : svarEndFromYmd(t.endDate),
    progress: t.progress,
    text: t.title,
    startYmd: t.startDate,
    endYmd: t.endDate,
  };
}

export type LinkRejection = 'type' | 'project-row' | 'self' | 'readonly' | 'hierarchy' | 'duplicate' | 'cycle';

export const LINK_REJECTION_MESSAGES: Record<LinkRejection, string> = {
  type: '완료→시작(FS) 의존만 만들 수 있습니다.',
  'project-row': '프로젝트 행에는 의존을 둘 수 없습니다.',
  self: '자기 자신에 의존할 수 없습니다.',
  readonly: '보관된 프로젝트의 작업은 바꿀 수 없습니다.',
  hierarchy: '상위·하위 작업 사이에는 의존을 둘 수 없습니다.',
  duplicate: '이미 있는 의존 관계입니다.',
  cycle: '순환 의존이 생겨 추가할 수 없습니다.',
};

/** 링크 추가 사전 검사(UX 용). 서버가 잠금 안에서 다시 검사한다. */
export function validateLink(
  link: { source: string; target: string; type: string },
  ctx: {
    tasks: ReadonlyMap<string, Pick<TaskDto, 'parentId' | 'projectId'>>;
    readonlyProjects: ReadonlySet<string>;
    deps: readonly DependencyDto[];
  },
): LinkRejection | null {
  if (link.type !== 'e2s') return 'type';
  if (isProjectRow(link.source) || isProjectRow(link.target)) return 'project-row';
  if (link.source === link.target) return 'self';
  const a = ctx.tasks.get(link.source);
  const b = ctx.tasks.get(link.target);
  if (!a || !b) return 'project-row';
  if (ctx.readonlyProjects.has(a.projectId) || ctx.readonlyProjects.has(b.projectId)) return 'readonly';
  const parentOf = new Map([...ctx.tasks].map(([id, t]) => [id, t.parentId]));
  if (isAncestor(parentOf, link.source, link.target) || isAncestor(parentOf, link.target, link.source)) return 'hierarchy';
  if (ctx.deps.some((d) => d.fromTaskId === link.source && d.toTaskId === link.target)) return 'duplicate';
  const edges = ctx.deps.map((d) => ({ from: d.fromTaskId, to: d.toTaskId }));
  if (createsCycle(edges, link.source, link.target)) return 'cycle';
  return null;
}

/** 필터: 조건에 맞는 작업과 그 조상(트리 유지)만 남긴다. 조건이 없으면 그대로. */
export function filterTasks(tasks: readonly TaskDto[], match: ((t: TaskDto) => boolean) | null): TaskDto[] {
  if (!match) return [...tasks];
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const keep = new Set<string>();
  for (const t of tasks) {
    if (!match(t)) continue;
    let cur: TaskDto | undefined = t;
    while (cur && !keep.has(cur.id)) {
      keep.add(cur.id);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
  }
  return tasks.filter((t) => keep.has(t.id));
}

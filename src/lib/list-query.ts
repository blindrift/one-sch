// 목록 화면(작업 목록 탭·이슈 목록)의 URL query 해석. 정렬·방향은 허용 목록, 필터는 형식 검사, 검색어는 길이 제한.
// 형식이 맞지 않는 값은 버리고 기본값을 쓴다(오류를 내지 않는다). 서버(page)·클라이언트(링크 생성) 공용.
import { ISSUE_PRIORITIES, ISSUE_STATUSES, ISSUE_TYPES, type IssuePriority, type IssueStatus, type IssueType } from './issue/status';
import { TASK_STATUSES, type TaskStatus } from './schedule/status';
import { PROJECT_KEY_RE, SEARCH_MAX } from './validation/limits';

export const PAGE_SIZE = 50;
/** 페이지 번호 상한(터무니없는 OFFSET 방지). 50건 × 2,000쪽 = 10만 건 */
export const MAX_PAGE = 2000;
/** 담당자 필터의 "담당자 없음" 값(타임라인의 UNASSIGNED 와 같은 값) */
export const NO_ASSIGNEE = 'none';

export type SearchParams = Record<string, string | string[] | undefined>;
export type SortDir = 'asc' | 'desc';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const oneOf = <T extends string>(list: readonly T[], v: string | undefined): T | null =>
  v !== undefined && (list as readonly string[]).includes(v) ? (v as T) : null;

function parseDir(v: string | undefined, fallback: SortDir): SortDir {
  return v === 'asc' || v === 'desc' ? v : fallback;
}

function parsePage(v: string | undefined): number {
  if (!v || !/^[1-9][0-9]{0,5}$/.test(v)) return 1;
  return Math.min(Number(v), MAX_PAGE);
}

function parseAssignee(v: string | undefined): string | null {
  return v && (v === NO_ASSIGNEE || UUID_RE.test(v)) ? v.toLowerCase() : null;
}

/** 검색어: 앞뒤 공백을 지우고 연속 공백을 하나로, 최대 SEARCH_MAX 자. 제어 문자가 있으면 버린다 */
function parseQ(v: string | undefined): string {
  if (!v) return '';
  if (/[\u0000-\u001f\u007f]/.test(v)) return '';
  return v.trim().replace(/\s+/g, ' ').slice(0, SEARCH_MAX);
}

// ---- 작업 목록 ----

export const TASK_SORTS = ['order', 'title', 'start', 'end', 'progress', 'status'] as const;
export type TaskSort = (typeof TASK_SORTS)[number];
export const TASK_SORT_LABELS: Record<TaskSort, string> = {
  order: '순서',
  title: '제목',
  start: '시작일',
  end: '종료일',
  progress: '진행률',
  status: '상태',
};

export type TaskListQuery = {
  sort: TaskSort;
  dir: SortDir;
  status: TaskStatus | null;
  /** 사용자 id(소문자) 또는 NO_ASSIGNEE */
  assignee: string | null;
  q: string;
  page: number;
  /** 강조할 작업 id(이슈 상세의 연결 작업 링크). 있으면 그 작업이 있는 페이지를 보이고 행을 강조한다. 링크·필터에는 싣지 않는다 */
  task: string | null;
};

export const DEFAULT_TASK_QUERY: TaskListQuery = { sort: 'order', dir: 'asc', status: null, assignee: null, q: '', page: 1, task: null };

export function parseTaskListQuery(sp: SearchParams): TaskListQuery {
  return {
    sort: oneOf(TASK_SORTS, first(sp.sort)) ?? 'order',
    dir: parseDir(first(sp.dir), 'asc'),
    status: oneOf(TASK_STATUSES, first(sp.status)),
    assignee: parseAssignee(first(sp.assignee)),
    q: parseQ(first(sp.q)),
    page: parsePage(first(sp.page)),
    task: (() => {
      const t = first(sp.task);
      return t && UUID_RE.test(t) ? t.toLowerCase() : null;
    })(),
  };
}

/** 행 순서를 끌어 바꿀 수 있는 상태인지(D17): 정렬 "순서" 오름차순이고 필터·검색이 없다 */
export function isOrderMode(q: TaskListQuery): boolean {
  return q.sort === 'order' && q.dir === 'asc' && !q.status && !q.assignee && !q.q;
}

// ---- 이슈 목록 ----

export const ISSUE_SORTS = ['updated', 'number', 'title', 'status', 'priority', 'due'] as const;
export type IssueSort = (typeof ISSUE_SORTS)[number];
export const ISSUE_SORT_LABELS: Record<IssueSort, string> = {
  updated: '최근 수정',
  number: '번호',
  title: '제목',
  status: '상태',
  priority: '우선순위',
  due: '마감일',
};

export type IssueListQuery = {
  sort: IssueSort;
  dir: SortDir;
  /** 프로젝트 키(`/issues` 전용, 프로젝트 탭에서는 무시) */
  project: string | null;
  type: IssueType | null;
  status: IssueStatus | null;
  priority: IssuePriority | null;
  assignee: string | null;
  q: string;
  page: number;
};

export const DEFAULT_ISSUE_QUERY: IssueListQuery = {
  sort: 'updated',
  dir: 'desc',
  project: null,
  type: null,
  status: null,
  priority: null,
  assignee: null,
  q: '',
  page: 1,
};

export function parseIssueListQuery(sp: SearchParams): IssueListQuery {
  const project = first(sp.project);
  return {
    sort: oneOf(ISSUE_SORTS, first(sp.sort)) ?? 'updated',
    dir: parseDir(first(sp.dir), 'desc'),
    project: project && PROJECT_KEY_RE.test(project) ? project : null,
    type: oneOf(ISSUE_TYPES, first(sp.type)),
    status: oneOf(ISSUE_STATUSES, first(sp.status)),
    priority: oneOf(ISSUE_PRIORITIES, first(sp.priority)),
    assignee: parseAssignee(first(sp.assignee)),
    q: parseQ(first(sp.q)),
    page: parsePage(first(sp.page)),
  };
}

/**
 * query 객체 → `?a=b` 문자열(기본값과 같은 값·빈 값은 뺀다, 키 순서 고정). extra 는 그대로 덧붙인다(예: issue=ERP-3).
 * 값이 없으면 빈 문자열.
 */
export function toQueryString<T extends Record<string, string | number | null>>(
  query: T,
  defaults: T,
  extra: Record<string, string | null | undefined> = {},
): string {
  const params = new URLSearchParams();
  for (const key of Object.keys(query).sort()) {
    const v = query[key];
    if (v === null || v === '' || v === defaults[key]) continue;
    params.set(key, String(v));
  }
  for (const [k, v] of Object.entries(extra)) if (v) params.set(k, v);
  const s = params.toString();
  return s ? `?${s}` : '';
}

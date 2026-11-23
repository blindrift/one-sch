import { UNASSIGNED, type TimelineFilter } from '@/components/gantt/timeline-store';
import { TASK_STATUSES, type TaskStatus } from '@/lib/schedule/status';
import { PROJECT_KEY_RE } from '@/lib/validation/limits';

/** 타임라인 URL query(필터·줌·보관 포함). 값이 여러 개면 첫 값만 쓴다. */
export type TimelineSearchParams = Partial<Record<'project' | 'assignee' | 'status' | 'zoom' | 'archived', string | string[]>>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** 형식이 맞지 않는 값은 버린다(거르지 않음). */
export function parseTimelineQuery(sp: TimelineSearchParams): TimelineFilter {
  const project = first(sp.project);
  const assignee = first(sp.assignee);
  const status = first(sp.status);
  return {
    projectKey: project && PROJECT_KEY_RE.test(project) ? project : null,
    assigneeId: assignee && (assignee === UNASSIGNED || UUID_RE.test(assignee)) ? assignee : null,
    status: status && (TASK_STATUSES as readonly string[]).includes(status) ? (status as TaskStatus) : null,
  };
}

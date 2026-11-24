import {
  ISSUE_PRIORITY_COLORS,
  ISSUE_PRIORITY_LABELS,
  ISSUE_STATUS_COLORS,
  ISSUE_STATUS_LABELS,
  ISSUE_TYPE_LABELS,
  type IssuePriority,
  type IssueStatus,
  type IssueType,
} from '@/lib/issue/status';

const PILL = 'inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full px-2 text-xs font-medium whitespace-nowrap';

export function IssueStatusBadge({ status }: { status: IssueStatus }) {
  const color = ISSUE_STATUS_COLORS[status];
  return (
    <span className={PILL} style={{ color, background: `color-mix(in srgb, ${color} 12%, transparent)` }} data-status={status}>
      <span className="size-1.5 rounded-full" style={{ background: color }} aria-hidden />
      {ISSUE_STATUS_LABELS[status]}
    </span>
  );
}

export function IssuePriorityBadge({ priority }: { priority: IssuePriority }) {
  const color = ISSUE_PRIORITY_COLORS[priority];
  return (
    <span className={PILL} style={{ color }} data-priority={priority}>
      <span aria-hidden>{priority === 'URGENT' ? '▲▲' : priority === 'HIGH' ? '▲' : priority === 'LOW' ? '▽' : '–'}</span>
      {ISSUE_PRIORITY_LABELS[priority]}
    </span>
  );
}

export function IssueTypeBadge({ type }: { type: IssueType }) {
  return <span className={`${PILL} border border-line bg-surface-muted text-muted-foreground`}>{ISSUE_TYPE_LABELS[type]}</span>;
}

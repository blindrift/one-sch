import { cn } from 'cn';
import { PROJECT_STATUS_LABELS, type ProjectStatus } from '@/lib/schedule/status';

const COLORS: Record<ProjectStatus, string> = {
  PLANNED: 'var(--status-todo)',
  ACTIVE: 'var(--status-progress)',
  ON_HOLD: 'var(--chart-4)',
  DONE: 'var(--status-done)',
};

/** 프로젝트 상태 배지: 상태 색 점 + 옅은 바탕(색은 디자인 토큰) */
export function ProjectStatusBadge({ status, className }: { status: ProjectStatus; className?: string }) {
  const color = COLORS[status];
  return (
    <span
      className={cn('inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full px-2 text-xs font-medium whitespace-nowrap', className)}
      style={{ color, background: `color-mix(in srgb, ${color} 12%, transparent)` }}
    >
      <span className="size-1.5 rounded-full" style={{ background: color }} aria-hidden />
      {PROJECT_STATUS_LABELS[status]}
    </span>
  );
}

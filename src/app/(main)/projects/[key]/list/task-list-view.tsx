'use client';

import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ariaSort, SortHeaderLink, type SortLink } from '@/components/list/pager';
import { Button } from '@/components/ui/button';
import type { TaskSort } from '@/lib/list-query';
import type { ProjectDto, TimelineData } from '@/lib/schedule/dto';
import { TASK_STATUS_COLORS, TASK_STATUS_LABELS } from '@/lib/schedule/status';
import type { TaskListRow } from '@/lib/task-list';
import { TaskFormDialog, type DependencyItem } from '../../../timeline/task-form-dialog';

type DialogState = { open: false } | { open: true; taskId: string | null };

const COLUMNS: { sort: TaskSort; label: string; className?: string }[] = [
  { sort: 'title', label: '제목' },
  { sort: 'status', label: '상태', className: 'w-28' },
  { sort: 'start', label: '시작일', className: 'w-28' },
  { sort: 'end', label: '종료일', className: 'w-28' },
  { sort: 'progress', label: '진행률', className: 'w-24 text-right' },
];

/**
 * 목록 탭 표(서버가 거르고 정렬한 한 페이지). MEMBER 는 행을 눌러 작업 대화상자로 고친다(보관 프로젝트 제외).
 * 저장·삭제 뒤에는 서버 값을 다시 읽는다(router.refresh).
 */
export function TaskListView({
  project,
  rows,
  data,
  canEdit,
  sortLinks,
  orderLink,
}: {
  project: ProjectDto;
  rows: TaskListRow[];
  data: TimelineData;
  canEdit: boolean;
  sortLinks: Record<TaskSort, SortLink>;
  orderLink: SortLink;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogState>({ open: false });
  const refresh = () => router.refresh();

  const editing = dialog.open && dialog.taskId ? (data.tasks.find((t) => t.id === dialog.taskId) ?? null) : null;
  const title = (id: string) => data.tasks.find((t) => t.id === id)?.title ?? '(보이지 않는 작업)';
  const editingDeps: DependencyItem[] = editing
    ? data.dependencies.flatMap((d): DependencyItem[] => {
        if (d.toTaskId === editing.id) return [{ id: d.id, direction: 'pred', title: title(d.fromTaskId) }];
        if (d.fromTaskId === editing.id) return [{ id: d.id, direction: 'succ', title: title(d.toTaskId) }];
        return [];
      })
    : [];
  const descendantCount = (id: string) => {
    let n = 0;
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const t of data.tasks) {
        if (t.parentId !== cur) continue;
        n += 1;
        stack.push(t.id);
      }
    }
    return n;
  };
  const users = new Map(data.users.map((u) => [u.id, u.name]));
  const writable: ProjectDto[] = canEdit ? [project] : [];

  return (
    <div className="flex flex-col gap-3 p-4">
      {canEdit ? (
        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            className="h-8 gap-1.5 rounded-md bg-brand px-3 text-xs font-semibold text-white shadow-sm hover:bg-brand-hover"
            onClick={() => setDialog({ open: true, taskId: null })}
          >
            <Plus className="size-3.5" />
            작업 추가
          </Button>
        </div>
      ) : null}
      <div className="overflow-x-auto rounded-xl border border-line bg-background shadow-[var(--shadow-sm)]">
        <table className="w-full text-sm" data-testid="task-list">
          <thead className="bg-surface-muted text-left text-xs text-muted-foreground">
            <tr className="border-b border-line">
              <th scope="col" className="w-16 py-2 pl-4 font-medium" aria-sort={ariaSort(orderLink)}>
                <SortHeaderLink label="순서" link={orderLink} />
              </th>
              {COLUMNS.map((c) => (
                <th key={c.sort} scope="col" className={`py-2 pr-3 font-medium ${c.className ?? ''}`} aria-sort={ariaSort(sortLinks[c.sort])}>
                  <SortHeaderLink label={c.label} link={sortLinks[c.sort]} />
                </th>
              ))}
              <th scope="col" className="w-28 py-2 pr-4 font-medium">
                담당자
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length + 2} className="py-12 text-center text-muted-foreground">
                  작업이 없습니다.
                </td>
              </tr>
            ) : null}
            {rows.map((r) => (
              <tr
                key={r.id}
                data-testid={`task-row-${r.id}`}
                className={`border-b border-line last:border-0 ${canEdit ? 'cursor-pointer hover:bg-surface-muted/60' : ''}`}
                onClick={canEdit ? () => setDialog({ open: true, taskId: r.id }) : undefined}
              >
                <td className="py-2 pl-4" />
                <td className="py-2 pr-3">
                  <div className="flex min-w-0 flex-col" style={{ paddingLeft: `${Math.min(r.depth, 5) * 14}px` }}>
                    {canEdit ? (
                      <button
                        type="button"
                        className="w-fit text-left font-medium hover:underline"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDialog({ open: true, taskId: r.id });
                        }}
                      >
                        {r.isMilestone ? '◆ ' : ''}
                        {r.title}
                      </button>
                    ) : (
                      <span className="font-medium">
                        {r.isMilestone ? '◆ ' : ''}
                        {r.title}
                      </span>
                    )}
                    {r.path.length ? <span className="truncate text-[11px] text-text-subtle">{r.path.join(' › ')}</span> : null}
                  </div>
                </td>
                <td className="py-2 pr-3">
                  <span className="inline-flex items-center gap-1.5 text-xs">
                    <span className="size-2 rounded-full" style={{ background: TASK_STATUS_COLORS[r.status] }} aria-hidden />
                    {TASK_STATUS_LABELS[r.status]}
                  </span>
                </td>
                <td className="py-2 pr-3 text-xs tabular-nums">{r.startDate}</td>
                <td className="py-2 pr-3 text-xs tabular-nums">
                  {r.endDate}
                  {r.late ? (
                    <span className="ml-1.5 rounded bg-red-50 px-1 py-0.5 text-[11px] font-medium text-red-700" data-testid="task-late">
                      지연
                    </span>
                  ) : null}
                </td>
                <td className="py-2 pr-3 text-right text-xs tabular-nums">{r.progress}%</td>
                <td className="py-2 pr-4 text-xs">{r.assigneeId ? (users.get(r.assigneeId) ?? r.assigneeName ?? '—') : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canEdit ? (
        <TaskFormDialog
          open={dialog.open}
          onOpenChange={(open) => (open ? null : setDialog({ open: false }))}
          task={editing}
          projects={writable}
          tasks={dialog.open ? data.tasks : []}
          allDependencies={data.dependencies}
          users={data.users}
          defaultProjectId={project.id}
          descendantCount={editing ? descendantCount(editing.id) : 0}
          dependencies={editingDeps}
          today={data.today}
          onSaved={refresh}
          onDeleted={refresh}
          onStale={refresh}
        />
      ) : null}
    </div>
  );
}

'use client';

import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { CircleAlert, GripVertical, Plus, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, useTransition, type ReactNode } from 'react';
import { ariaSort, SortHeaderLink, type SortLink } from '@/components/list/pager';
import { Button } from '@/components/ui/button';
import type { TaskSort } from '@/lib/list-query';
import type { ProjectDto, TimelineData } from '@/lib/schedule/dto';
import { TASK_STATUS_COLORS, TASK_STATUS_LABELS } from '@/lib/schedule/status';
import type { TaskListRow } from '@/lib/task-list';
import { isAncestor } from '@/lib/schedule/graph';
import { siblingAnchor } from '@/lib/schedule/reorder';
import { reorderTask } from '@/server/actions/task';
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
 * orderMode(정렬 "순서"·필터·검색 없음)이면 손잡이를 끌어(마우스·키보드) 같은 상위 아래 형제끼리 순서를 바꾼다(D17).
 */
export function TaskListView({
  project,
  rows,
  data,
  canEdit,
  sortLinks,
  orderLink,
  orderMode,
  focusId,
}: {
  project: ProjectDto;
  rows: TaskListRow[];
  data: TimelineData;
  canEdit: boolean;
  sortLinks: Record<TaskSort, SortLink>;
  orderLink: SortLink;
  orderMode: boolean;
  /** 강조할 작업(이슈의 연결 작업 링크로 들어온 경우) */
  focusId: string | null;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogState>({ open: false });
  const [message, setMessage] = useState<string | null>(null);
  const [reordering, startReorder] = useTransition();
  const refresh = () => router.refresh();
  const canReorder = canEdit && orderMode;
  /** 저장 중에는 끌 수 없다(옛 version·순서로 다시 옮기지 않게). 손잡이는 남겨 둔다 */
  const dragLocked = !canReorder || reordering;
  const titleOf = (id: string) => rows.find((r) => r.id === id)?.title ?? '';
  const dndId = useId();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragEnd(e: DragEndEvent) {
    const overId = e.over ? String(e.over.id) : null;
    const activeId = String(e.active.id);
    if (!overId || overId === activeId) return;
    const from = rows.findIndex((r) => r.id === activeId);
    const to = rows.findIndex((r) => r.id === overId);
    const moving = rows[from];
    // 놓은 행이 형제의 하위면 그 형제를 기준으로 삼는다(다른 상위 아래·자기 하위면 거부)
    const parentOf = new Map(data.tasks.map((t) => [t.id, t.parentId]));
    if (moving && isAncestor(parentOf, moving.id, overId)) {
      setMessage('자기 하위 작업 위치로는 옮길 수 없습니다.');
      return;
    }
    const anchorId = moving && to >= 0 ? siblingAnchor(parentOf, moving.id, overId) : null;
    if (!moving || !anchorId) {
      setMessage('같은 상위 작업 아래의 작업끼리만 순서를 바꿀 수 있습니다.');
      return;
    }
    startReorder(async () => {
      const r = await reorderTask({ id: moving.id, version: moving.version, ...(from < to ? { afterId: anchorId } : { beforeId: anchorId }) });
      setMessage(r.ok ? null : r.message);
      refresh();
    });
  }

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
      {message ? (
        <div role="alert" data-testid="list-message" className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">
          <CircleAlert className="size-4 shrink-0" aria-hidden />
          <span className="flex-1">{message}</span>
          <button type="button" aria-label="닫기" className="inline-flex size-6 items-center justify-center rounded-md opacity-70 hover:bg-black/5 hover:opacity-100" onClick={() => setMessage(null)}>
            <X className="size-3.5" />
          </button>
        </div>
      ) : null}
      {canEdit && !orderMode ? (
        <p className="text-xs text-text-subtle">정렬이 “순서”이고 필터·검색이 없을 때 손잡이를 끌어 같은 상위 작업 아래의 순서를 바꿀 수 있습니다.</p>
      ) : null}
      <div className="overflow-x-auto rounded-xl border border-line bg-background shadow-[var(--shadow-sm)]" aria-busy={reordering}>
        <DndContext
          id={dndId}
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
          accessibility={{
            announcements: {
              onDragStart: ({ active }) => `${titleOf(String(active.id))} 행을 들었습니다.`,
              onDragOver: ({ over }) => (over ? `${titleOf(String(over.id))} 위치` : '표 밖'),
              onDragEnd: ({ over }) => (over ? `${titleOf(String(over.id))} 위치에 놓았습니다.` : '옮기지 않았습니다.'),
              onDragCancel: () => '옮기기를 취소했습니다.',
            },
            screenReaderInstructions: { draggable: '순서를 바꾸려면 Space 를 누르고 위·아래 화살표로 옮긴 뒤 Space 로 놓습니다. Esc 는 취소입니다.' },
          }}
        >
          <SortableContext items={rows.map((r) => r.id)} strategy={verticalListSortingStrategy} disabled={dragLocked}>
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
                  <SortableRow
                    key={r.id}
                    id={r.id}
                    title={r.title}
                    canReorder={canReorder}
                    locked={reordering}
                    focused={r.id === focusId}
                    className={`border-b border-line last:border-0 ${canEdit ? 'cursor-pointer hover:bg-surface-muted/60' : ''}`}
                    onClick={canEdit ? () => setDialog({ open: true, taskId: r.id }) : undefined}
                  >
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
                  </SortableRow>
                ))}
              </tbody>
            </table>
          </SortableContext>
        </DndContext>
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

/** 표의 한 행. canReorder 면 첫 칸에 끌기 손잡이(마우스·키보드)를 둔다 */
function SortableRow({
  id,
  title,
  canReorder,
  locked,
  focused,
  className,
  onClick,
  children,
}: {
  id: string;
  title: string;
  canReorder: boolean;
  /** 저장 중: 손잡이는 보이되 끌 수 없다 */
  locked: boolean;
  focused: boolean;
  className: string;
  onClick?: () => void;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id, disabled: !canReorder || locked });
  const rowRef = useRef<HTMLTableRowElement | null>(null);
  useEffect(() => {
    if (focused) rowRef.current?.scrollIntoView({ block: 'center' });
  }, [focused]);
  return (
    <tr
      ref={(el) => {
        setNodeRef(el);
        rowRef.current = el;
      }}
      data-testid={`task-row-${id}`}
      aria-current={focused ? 'true' : undefined}
      data-dragging={isDragging || undefined}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`${className} ${focused ? 'bg-brand-soft/70' : ''} ${isDragging ? 'relative z-10 bg-background shadow-md' : ''}`}
      onClick={onClick}
    >
      <td className="py-2 pl-3">
        {canReorder ? (
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            aria-label={`순서 옮기기: ${title}`}
            className="inline-flex size-7 cursor-grab touch-none items-center justify-center rounded-md text-text-subtle hover:bg-surface-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:outline-none active:cursor-grabbing"
            onClick={(e) => e.stopPropagation()}
          >
            <GripVertical className="size-4" aria-hidden />
          </button>
        ) : null}
      </td>
      {children}
    </tr>
  );
}

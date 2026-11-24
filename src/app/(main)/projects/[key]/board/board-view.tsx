'use client';

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type KeyboardCoordinateGetter,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { CircleAlert, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { IssuePriorityBadge } from '@/components/issues/issue-badges';
import { issueColumns, taskColumns, type BoardColumns } from '@/lib/board';
import type { IssueListItem } from '@/lib/issue/dto';
import { ISSUE_STATUSES, ISSUE_STATUS_COLORS, ISSUE_STATUS_LABELS, type IssueStatus } from '@/lib/issue/status';
import type { ProjectDto, TaskDto, TimelineData } from '@/lib/schedule/dto';
import { isLate } from '@/lib/schedule/rollup';
import { TASK_STATUSES, TASK_STATUS_COLORS, TASK_STATUS_LABELS, type TaskStatus } from '@/lib/schedule/status';
import { ISSUE_BOARD_LIMIT } from '@/lib/validation/limits';
import { updateIssue } from '@/server/actions/issue';
import { updateTask } from '@/server/actions/task';
import { TaskFormDialog, type DependencyItem } from '../../../timeline/task-form-dialog';

/**
 * 키보드로 끌 때 ←/→ 는 옆 열로 한 칸씩 옮긴다(dnd-kit 기본은 25px 씩). 좌표는 끄는 카드 사각형의 왼쪽 위.
 * 시작은 Space, 놓기는 Space·Enter, 취소는 Esc(Enter 는 카드 열기에 쓴다).
 */
const columnKeyboard: KeyboardCoordinateGetter = (event, { context, currentCoordinates }) => {
  const dir = event.code === 'ArrowRight' ? 1 : event.code === 'ArrowLeft' ? -1 : 0;
  if (!dir) return undefined;
  event.preventDefault();
  const cols = [...context.droppableRects.entries()].sort((a, b) => a[1].left - b[1].left);
  const width = context.collisionRect?.width ?? 0;
  const centerX = currentCoordinates.x + width / 2;
  let idx = cols.findIndex(([id]) => id === context.over?.id);
  if (idx < 0) idx = cols.findIndex(([, r]) => centerX >= r.left && centerX <= r.right);
  const next = cols[idx + dir];
  if (!next) return currentCoordinates;
  const r = next[1];
  return { x: r.left + Math.max(0, (r.width - width) / 2), y: Math.max(currentCoordinates.y, r.top + 8) };
};
const KEYBOARD_CODES = { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter'] };

type Message = { kind: 'error'; text: string };

/**
 * 서버 값이 새로 오면(router.refresh·이동) 낙관 상태를 버리고 다시 시작한다.
 * 저장 중(busy)에 온 서버 값은 저장 커밋 전에 읽은 값일 수 있어 적용하지 않고 건너뛴 표시만 남긴다.
 * 저장이 모두 끝나면(busy 해제) 건너뛴 값을 쓰지 않고 resync(서버에서 다시 읽기)를 한 번 부른다.
 */
function useServerState<T>(value: T, busy: boolean, resync: () => void): [T, (next: T | ((prev: T) => T)) => void] {
  const [source, setSource] = useState(value);
  const [state, setState] = useState(value);
  const [skipped, setSkipped] = useState(false);
  if (source !== value) {
    setSource(value);
    if (busy) setSkipped(true);
    else {
      setState(value);
      setSkipped(false);
    }
  }
  useEffect(() => {
    if (busy || !skipped) return;
    setSkipped(false);
    resync();
  }, [busy, skipped, resync]);
  return [state, setState];
}

export function TaskBoard({ project, data, canEdit, includeParents }: { project: ProjectDto; data: TimelineData; canEdit: boolean; includeParents: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(0);
  const resync = useCallback(() => router.refresh(), [router]);
  const [tasks, setTasks] = useServerState(data.tasks, pending > 0, resync);
  const [message, setMessage] = useState<Message | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const saving = useRef(new Set<string>());
  const cols = taskColumns(tasks, includeParents);
  const names = new Map(data.users.map((u) => [u.id, u.name]));
  const refresh = () => router.refresh();

  async function move(id: string, to: TaskStatus) {
    const before = tasks.find((t) => t.id === id);
    if (!before || before.status === to || saving.current.has(id)) return;
    saving.current.add(id);
    setPending((n) => n + 1);
    setTasks((list) => list.map((t) => (t.id === id ? { ...t, status: to } : t)));
    try {
      const r = await updateTask({ id, version: before.version, status: to });
      if (r.ok) {
        const fresh = new Map([r.data.task, ...r.data.ancestors].map((t) => [t.id, t]));
        setTasks((list) => list.map((t) => fresh.get(t.id) ?? t));
        setMessage(null);
        return;
      }
      setTasks((list) => list.map((t) => (t.id === id ? before : t)));
      setMessage({ kind: 'error', text: r.message });
      if (r.code === 'CONFLICT' || r.code === 'NOT_FOUND') refresh();
    } catch {
      setTasks((list) => list.map((t) => (t.id === id ? before : t)));
      setMessage({ kind: 'error', text: '저장하지 못했습니다. 네트워크를 확인해 주세요.' });
    } finally {
      saving.current.delete(id);
      setPending((n) => n - 1);
    }
  }

  const editing = editingId ? (tasks.find((t) => t.id === editingId) ?? null) : null;
  const title = (id: string) => tasks.find((t) => t.id === id)?.title ?? '(보이지 않는 작업)';
  const editingDeps: DependencyItem[] = editing
    ? data.dependencies.flatMap((d): DependencyItem[] => {
        if (d.toTaskId === editing.id) return [{ id: d.id, direction: 'pred', title: title(d.fromTaskId) }];
        if (d.fromTaskId === editing.id) return [{ id: d.id, direction: 'succ', title: title(d.toTaskId) }];
        return [];
      })
    : [];

  return (
    <>
      <Board<TaskStatus, TaskDto>
        statuses={TASK_STATUSES}
        labels={TASK_STATUS_LABELS}
        colors={TASK_STATUS_COLORS}
        columns={cols}
        canDrag={canEdit}
        message={message}
        onDismiss={() => setMessage(null)}
        onMove={(id, to) => void move(id, to)}
        cardLabel={(t) => t.title}
        onOpen={canEdit ? (t) => setEditingId(t.id) : undefined}
        renderCard={(t) => (
          <>
            <span className="text-[13px] leading-snug font-medium break-words">
              {t.isMilestone ? '◆ ' : ''}
              {t.title}
            </span>
            <span className="flex items-center justify-between gap-2 text-[11px] text-text-subtle">
              <span className={isLate(t, data.today) ? 'font-medium text-red-700' : 'tabular-nums'}>
                ~{t.endDate}
                {isLate(t, data.today) ? ' 지연' : ''}
              </span>
              <span className="truncate">{t.assigneeId ? (names.get(t.assigneeId) ?? '') : ''}</span>
            </span>
            {t.hasChildren ? <span className="text-[11px] text-text-subtle">상위 작업 · {t.progress}%</span> : null}
          </>
        )}
      />
      {canEdit ? (
        <TaskFormDialog
          open={editing !== null}
          onOpenChange={(open) => (open ? null : setEditingId(null))}
          task={editing}
          projects={[project]}
          tasks={editing ? tasks : []}
          allDependencies={data.dependencies}
          users={data.users}
          defaultProjectId={project.id}
          dependencies={editingDeps}
          descendantCount={0}
          today={data.today}
          onSaved={refresh}
          onDeleted={refresh}
          onStale={refresh}
        />
      ) : null}
    </>
  );
}

export function IssueBoard({ issues, truncated, canEdit, today }: { issues: IssueListItem[]; truncated: boolean; canEdit: boolean; today: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, setPending] = useState(0);
  const resync = useCallback(() => router.refresh(), [router]);
  const [items, setItems] = useServerState(issues, pending > 0, resync);
  const [message, setMessage] = useState<Message | null>(null);
  const saving = useRef(new Set<string>());
  const cols: BoardColumns<IssueStatus, IssueListItem> = issueColumns(items);

  async function move(id: string, to: IssueStatus) {
    const before = items.find((i) => i.id === id);
    if (!before || before.status === to || saving.current.has(id)) return;
    saving.current.add(id);
    setPending((n) => n + 1);
    setItems((list) => list.map((i) => (i.id === id ? { ...i, status: to } : i)));
    try {
      const r = await updateIssue({ id, version: before.version, status: to });
      if (r.ok) {
        setItems((list) => list.map((i) => (i.id === id ? { ...i, status: r.data.status, version: r.data.version, updatedAt: r.data.updatedAt } : i)));
        setMessage(null);
        // 응답 값만 반영한다(다시 읽으면 저장 중인 다른 카드의 낙관 상태를 덮을 수 있다). 열린 상세 패널이 이 이슈면 패널만 새로 읽는다
        if (params.get('issue') === before.key) router.refresh();
        return;
      }
      setItems((list) => list.map((i) => (i.id === id ? before : i)));
      setMessage({ kind: 'error', text: r.message });
      if (r.code === 'CONFLICT' || r.code === 'NOT_FOUND') router.refresh();
    } catch {
      setItems((list) => list.map((i) => (i.id === id ? before : i)));
      setMessage({ kind: 'error', text: '저장하지 못했습니다. 네트워크를 확인해 주세요.' });
    } finally {
      saving.current.delete(id);
      setPending((n) => n - 1);
    }
  }

  const open = (i: IssueListItem) => {
    const next = new URLSearchParams(params.toString());
    next.set('issue', i.key);
    router.push(`${pathname}?${next.toString()}`, { scroll: false });
  };

  return (
    <Board<IssueStatus, IssueListItem>
      notice={truncated ? `이슈가 많아 최근 ${ISSUE_BOARD_LIMIT.toLocaleString('ko-KR')}건만 보입니다. 나머지는 이슈 탭에서 필터·검색으로 찾아 주세요.` : null}
      statuses={ISSUE_STATUSES}
      labels={ISSUE_STATUS_LABELS}
      colors={ISSUE_STATUS_COLORS}
      columns={cols}
      canDrag={canEdit}
      message={message}
      onDismiss={() => setMessage(null)}
      onMove={(id, to) => void move(id, to)}
      cardLabel={(i) => `${i.key} ${i.title}`}
      onOpen={open}
      renderCard={(i) => {
        const late = !!i.dueDate && i.dueDate < today && (i.status === 'OPEN' || i.status === 'IN_PROGRESS');
        return (
          <>
            <span className="font-mono text-[11px] text-text-subtle">{i.key}</span>
            <span className="text-[13px] leading-snug font-medium break-words">{i.title}</span>
            <span className="flex items-center justify-between gap-2 text-[11px] text-text-subtle">
              <IssuePriorityBadge priority={i.priority} />
              <span className={late ? 'font-medium text-red-700' : 'tabular-nums'}>{i.dueDate ? `~${i.dueDate}` : ''}</span>
            </span>
            {i.assigneeName ? <span className="truncate text-[11px] text-text-subtle">{i.assigneeName}</span> : null}
          </>
        );
      }}
    />
  );
}

type BoardProps<S extends string, C extends { id: string; status: S }> = {
  statuses: readonly S[];
  labels: Record<S, string>;
  colors: Record<S, string>;
  columns: BoardColumns<S, C>;
  canDrag: boolean;
  /** 보드 위 안내(예: 이슈가 많아 일부만 보임) */
  notice?: string | null;
  message: Message | null;
  onDismiss: () => void;
  onMove: (id: string, to: S) => void;
  onOpen?: (card: C) => void;
  cardLabel: (card: C) => string;
  renderCard: (card: C) => ReactNode;
};

/** 상태 열 보드(작업·이슈 공용). 끌기는 마우스(5px 이상 움직이면 시작)와 키보드(Space → ←/→ → Space) */
function Board<S extends string, C extends { id: string; status: S }>(props: BoardProps<S, C>) {
  const { statuses, labels, colors, columns, canDrag, message, onDismiss, onMove, cardLabel } = props;
  const id = useId();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: columnKeyboard, keyboardCodes: KEYBOARD_CODES }),
  );
  const find = (cardId: string) => {
    for (const s of statuses) {
      const c = columns[s].find((x) => x.id === cardId);
      if (c) return c;
    }
    return undefined;
  };
  const colName = (s: unknown) => (typeof s === 'string' && s in labels ? labels[s as S] : '');
  const announcements: Announcements = {
    onDragStart: ({ active }) => `${cardLabel(find(String(active.id))!)} 카드를 들었습니다. 왼쪽·오른쪽 화살표로 열을 옮기고 Space 로 놓습니다.`,
    onDragOver: ({ over }) => (over ? `${colName(over.id)} 열 위` : '열 밖'),
    onDragEnd: ({ over }) => (over ? `${colName(over.id)} 열에 놓았습니다.` : '옮기지 않았습니다.'),
    onDragCancel: () => '옮기기를 취소했습니다.',
  };

  function onDragEnd(e: DragEndEvent) {
    const to = e.over?.id;
    if (typeof to !== 'string' || !(statuses as readonly string[]).includes(to)) return;
    onMove(String(e.active.id), to as S);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {props.notice ? (
        <p role="status" data-testid="board-notice" className="mx-4 mt-3 rounded-lg border border-line bg-surface-muted px-3 py-2 text-[13px] text-muted-foreground">
          {props.notice}
        </p>
      ) : null}
      {message ? (
        <div role="alert" data-testid="board-message" className="mx-4 mt-3 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">
          <CircleAlert className="size-4 shrink-0" aria-hidden />
          <span className="flex-1">{message.text}</span>
          <button type="button" aria-label="닫기" className="inline-flex size-6 items-center justify-center rounded-md opacity-70 hover:bg-black/5 hover:opacity-100" onClick={onDismiss}>
            <X className="size-3.5" />
          </button>
        </div>
      ) : null}
      <DndContext
        id={id}
        sensors={sensors}
        collisionDetection={rectIntersection}
        onDragEnd={onDragEnd}
        accessibility={{
          announcements,
          screenReaderInstructions: { draggable: '카드를 옮기려면 Space 를 누르고 왼쪽·오른쪽 화살표로 열을 고른 뒤 Space 로 놓습니다. Esc 는 취소, Enter 는 열기입니다.' },
        }}
      >
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-4" data-testid="board">
          {statuses.map((s) => (
            <Column key={s} status={s} label={labels[s]} color={colors[s]} count={columns[s].length}>
              {columns[s].map((c) => (
                <Card key={c.id} id={c.id} label={cardLabel(c)} disabled={!canDrag} onOpen={props.onOpen ? () => props.onOpen!(c) : undefined}>
                  {props.renderCard(c)}
                </Card>
              ))}
            </Column>
          ))}
        </div>
      </DndContext>
    </div>
  );
}

function Column({ status, label, color, count, children }: { status: string; label: string; color: string; count: number; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <section
      ref={setNodeRef}
      aria-label={`${label} 열`}
      data-testid={`board-col-${status}`}
      data-over={isOver || undefined}
      className={`flex w-72 shrink-0 flex-col rounded-xl border bg-surface-muted/70 ${isOver ? 'border-brand/60 bg-brand-soft/60' : 'border-line'}`}
    >
      <h2 className="flex items-center gap-2 px-3 pt-3 pb-2 text-xs font-semibold">
        <span className="size-2 rounded-full" style={{ background: color }} aria-hidden />
        {label}
        <span className="font-normal text-text-subtle tabular-nums">{count}</span>
      </h2>
      <ul className="flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-3">{children}</ul>
    </section>
  );
}

function Card({ id, label, disabled, onOpen, children }: { id: string; label: string; disabled: boolean; onOpen?: () => void; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id, disabled });
  return (
    <li
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      aria-label={label}
      // 끌 수 없으면(VIEWER·보관) '끌 수 있는 항목' 표시를 빼고, 열기는 되므로 aria-disabled 도 두지 않는다
      aria-roledescription={disabled ? undefined : attributes['aria-roledescription']}
      aria-disabled={undefined}
      tabIndex={0}
      data-testid={`board-card-${id}`}
      data-dragging={isDragging || undefined}
      style={{ transform: CSS.Translate.toString(transform) }}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !isDragging && onOpen) {
          e.preventDefault();
          onOpen();
          return;
        }
        listeners?.onKeyDown?.(e);
      }}
      className={`flex flex-col gap-1.5 rounded-lg border border-line bg-background px-3 py-2.5 shadow-[var(--shadow-sm)] outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${
        disabled ? (onOpen ? 'cursor-pointer' : '') : 'cursor-grab touch-none active:cursor-grabbing'
      } ${isDragging ? 'z-10 opacity-80 shadow-lg' : ''}`}
    >
      {children}
    </li>
  );
}

/** 보드 위 도구 모음: 작업|이슈 전환, 상위 작업 포함 토글(링크 — 서버가 다시 읽는다) */
export function BoardToolbar({ basePath, kind, includeParents }: { basePath: string; kind: 'task' | 'issue'; includeParents: boolean }) {
  const tab = (active: boolean) =>
    active ? 'h-7 rounded-md bg-background px-3 text-xs leading-7 font-semibold text-brand shadow-sm' : 'h-7 rounded-md px-3 text-xs leading-7 font-medium text-muted-foreground hover:text-foreground';
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-line bg-background px-4 py-2 text-sm">
      <div className="inline-flex items-center rounded-lg border border-line bg-surface-muted p-0.5" role="group" aria-label="보드 종류">
        <Link href={basePath} className={tab(kind === 'task')} aria-current={kind === 'task' ? 'page' : undefined}>
          작업
        </Link>
        <Link href={`${basePath}?kind=issue`} className={tab(kind === 'issue')} aria-current={kind === 'issue' ? 'page' : undefined}>
          이슈
        </Link>
      </div>
      {kind === 'task' ? (
        <Link
          href={includeParents ? basePath : `${basePath}?parents=1`}
          role="checkbox"
          aria-checked={includeParents}
          className="flex h-8 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:bg-surface-muted"
        >
          <span className={`flex size-3.5 items-center justify-center rounded-[3px] border ${includeParents ? 'border-brand bg-brand text-white' : 'border-line-strong bg-background'}`} aria-hidden>
            {includeParents ? '✓' : ''}
          </span>
          상위 작업 포함
        </Link>
      ) : null}
    </div>
  );
}

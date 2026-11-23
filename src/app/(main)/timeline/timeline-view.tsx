'use client';

import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { IApi } from '@svar-ui/react-gantt';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { dragPatch, isProjectRow, LINK_REJECTION_MESSAGES, projectRowId, rowValues, validateLink } from '@/components/gantt/adapter';
import { ZOOMS, ZOOM_LABELS, type Zoom } from '@/components/gantt/scales';
import { TimelineStore, UNASSIGNED, type TimelineFilter } from '@/components/gantt/timeline-store';
import type { TaskDeleteResult, TaskDto, TaskWriteResult, TimelineData } from '@/lib/schedule/dto';
import { isLate } from '@/lib/schedule/rollup';
import { TASK_STATUSES, TASK_STATUS_LABELS, type TaskStatus } from '@/lib/schedule/status';
import { addDependency, removeDependency } from '@/server/actions/dependency';
import { updateTask } from '@/server/actions/task';
import { SELECT_CLASS, TaskFormDialog, type DependencyItem } from './task-form-dialog';

// SVAR 는 브라우저 전용(window 사용)이라 서버 렌더를 끈다. ssr:false 는 클라이언트 컴포넌트 안에서만 쓸 수 있다.
const GanttChart = dynamic(() => import('@/components/gantt/gantt-chart'), {
  ssr: false,
  loading: () => <p className="p-4 text-sm text-muted-foreground">간트 불러오는 중…</p>,
});

/** SVAR 의 내장 편집(추가·삭제·행 이동·복사·들여쓰기)은 쓰지 않는다(D10). 서버 값 반영(eventSource 'server')만 통과. */
const BLOCKED_ACTIONS = ['add-task', 'delete-task', 'move-task', 'copy-task', 'indent-task'] as const;
export const SERVER = 'server';

export type TimelineViewProps = {
  data: TimelineData;
  canEdit: boolean;
  initialFilter: TimelineFilter;
  initialZoom: Zoom;
  /** 전체 타임라인: 보관 포함 토글과 프로젝트 필터를 보인다. 프로젝트 화면에서는 그 프로젝트만 */
  scope: { kind: 'all'; includeArchived: boolean } | { kind: 'project'; projectId: string };
};

type Message = { kind: 'error' | 'info'; text: string };
type DialogState = { open: false } | { open: true; taskId: string | null };

export function TimelineView({ data, canEdit, initialFilter, initialZoom, scope }: TimelineViewProps) {
  const router = useRouter();
  // 서버 값이 새로 오면(router.refresh·이동) 사본을 새로 만든다. 접힘 상태는 이어 간다.
  const [source, setSource] = useState(data);
  const [store, setStore] = useState(() => new TimelineStore(data));
  if (source !== data) {
    setSource(data);
    setStore(new TimelineStore(data, store.closed));
  }
  const [revision, setRevision] = useState(0);
  const [filter, setFilter] = useState(initialFilter);
  const [zoom, setZoom] = useState<Zoom>(initialZoom);
  const [message, setMessage] = useState<Message | null>(null);
  const [dialog, setDialog] = useState<DialogState>({ open: false });
  const apiRef = useRef<IApi | null>(null);

  // 행은 구조가 바뀔 때(필터·추가·삭제·폼 편집·새 서버 값)만 다시 만든다. 드래그 결과는 exec 로 그 자리만 고친다.
  // revision 은 store 안의 변경을 알리는 신호라 본문에서 읽지 않는다.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const view = useMemo(() => store.view(filter), [store, filter, revision]);
  const rebuild = useCallback(() => setRevision((r) => r + 1), []);

  // URL query 에 화면 상태를 남긴다(새로고침·공유). 서버 렌더가 다시 일어나지 않도록 history 만 바꾼다.
  const syncUrl = useCallback((f: TimelineFilter, z: Zoom) => {
    const q = new URLSearchParams(window.location.search);
    const set = (k: string, v: string | null) => (v ? q.set(k, v) : q.delete(k));
    set('project', f.projectKey);
    set('assignee', f.assigneeId);
    set('status', f.status);
    set('zoom', z === 'day' ? null : z);
    const qs = q.toString();
    window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname);
  }, []);

  function changeFilter(patch: Partial<TimelineFilter>) {
    const next = { ...filter, ...patch };
    setFilter(next);
    syncUrl(next, zoom);
  }

  function changeZoom(z: Zoom) {
    setZoom(z);
    syncUrl(filter, z);
  }

  // 보관 포함은 서버가 다시 읽어야 하므로 이동한다. 이동이 끝날 때까지 체크 상태를 먼저 보여 준다.
  const [archivedChecked, setArchivedChecked] = useState(scope.kind === 'all' && scope.includeArchived);
  const [archivedSource, setArchivedSource] = useState(archivedChecked);
  const includeArchivedProp = scope.kind === 'all' && scope.includeArchived;
  if (archivedSource !== includeArchivedProp) {
    setArchivedSource(includeArchivedProp);
    setArchivedChecked(includeArchivedProp);
  }

  function toggleArchived(include: boolean) {
    setArchivedChecked(include);
    const q = new URLSearchParams(window.location.search);
    if (include) q.set('archived', '1');
    else q.delete('archived');
    const qs = q.toString();
    router.push(qs ? `?${qs}` : window.location.pathname);
  }

  const refresh = useCallback(() => router.refresh(), [router]);

  function setAllOpen(open: boolean) {
    const api = apiRef.current;
    for (const p of store.projects) {
      const id = projectRowId(p.id);
      if (open) store.closed.delete(id);
      else store.closed.add(id);
      if (api?.getTask(id)) api.exec('open-task', { id, mode: open });
    }
  }

  // SVAR 이벤트 처리기는 처음 한 번만 붙으므로, 바뀌는 값(사본·권한)은 ref 로 읽는다.
  const live = useRef({ store, canEdit });
  useLayoutEffect(() => {
    live.current = { store, canEdit };
  });

  const openEditor = useCallback((id: string) => {
    const { store: s, canEdit: editable } = live.current;
    const t = s.task(id);
    if (!editable || isProjectRow(id) || !t) return;
    if (s.isReadonlyProject(t.projectId)) {
      setMessage({ kind: 'error', text: '보관된 프로젝트의 작업은 바꿀 수 없습니다.' });
      return;
    }
    setDialog({ open: true, taskId: id });
  }, []);

  /** 같은 문구면 다시 그리지 않는다(드래그 중 여러 번 불릴 수 있다). */
  const showError = useCallback((text: string) => setMessage((m) => (m?.kind === 'error' && m.text === text ? m : { kind: 'error', text })), []);

  const onInit = useCallback(
    (api: IApi) => {
      apiRef.current = api;
      const saving = new Set<string>();

      for (const action of BLOCKED_ACTIONS) api.intercept(action, (ev: Record<string, unknown>) => ev.eventSource === SERVER);
      api.intercept('show-editor', (ev) => {
        if (ev.id !== null && ev.id !== undefined) openEditor(String(ev.id));
        return false;
      });
      api.on('open-task', (ev) => {
        const id = String(ev.id);
        if (ev.mode) live.current.store.closed.delete(id);
        else live.current.store.closed.add(id);
      });

      /** 막대를 직접 바꿀 수 없는 이유(없으면 null): 권한·프로젝트 행·요약(D4)·보관(D6)·저장 중 */
      const dragDenied = (id: string): string | null => {
        const { store: s, canEdit: editable } = live.current;
        if (!editable) return '권한이 없습니다.';
        if (isProjectRow(id)) return '프로젝트 행은 작업에서 자동으로 계산됩니다.';
        const t = s.task(id);
        if (!t) return '대상을 찾을 수 없습니다.';
        if (s.isReadonlyProject(t.projectId)) return LINK_REJECTION_MESSAGES.readonly;
        if (t.hasChildren) return '하위 작업이 있는 작업의 기간·진행률은 하위 작업에서 자동으로 계산됩니다.';
        if (saving.has(id)) return '저장 중입니다. 잠시 후 다시 시도해 주세요.';
        return null;
      };

      /** 서버 값으로 막대를 고친다(작업·조상·프로젝트 요약 행) */
      const applyServerValues = (s: TimelineStore, tasks: TaskDto[]) => {
        for (const t of tasks) {
          if (api.getTask(t.id)) api.exec('update-task', { id: t.id, task: { ...rowValues(t), late: isLate(t, s.today) }, eventSource: SERVER });
        }
        const projectIds = new Set(tasks.map((t) => t.projectId));
        for (const pid of projectIds) {
          const row = s.projectRow(pid);
          if (row?.start && api.getTask(row.id)) {
            api.exec('update-task', {
              id: row.id,
              task: { start: row.start, end: row.end, progress: row.progress, startYmd: row.startYmd, endYmd: row.endYmd },
              eventSource: SERVER,
            });
          }
        }
      };

      // 드래그(이동·끝 늘이기·진행률): 거부는 intercept 에서, 저장은 끝났을 때(inProgress 아님) 한 번만(3.8)
      api.intercept('drag-task', (ev) => dragDenied(String(ev.id)) === null);
      api.intercept('update-task', (ev) => {
        if (ev.eventSource === SERVER) return true;
        const reason = dragDenied(String(ev.id));
        if (reason) {
          if (!ev.inProgress) showError(reason);
          return false;
        }
        return true;
      });
      api.on('update-task', (ev) => {
        if (ev.inProgress || ev.eventSource === SERVER) return;
        const id = String(ev.id);
        const s = live.current.store;
        const before = s.task(id);
        if (!before) return;
        const now = api.getTask(id);
        const patch = dragPatch(before, { start: now.start, end: now.end, progress: now.progress });
        const revert = () => api.exec('update-task', { id, task: rowValues(before), eventSource: SERVER });
        if (Object.keys(patch).length === 0) {
          revert(); // 반나절 미만 움직임 등: 서버 값 자리로 맞춘다
          return;
        }
        saving.add(id);
        void updateTask({ id, version: before.version, ...patch })
          .then((r) => {
            if (r.ok) {
              s.applyWrite(r.data);
              applyServerValues(s, [r.data.task, ...r.data.ancestors]);
              setMessage(null);
              return;
            }
            revert();
            showError(r.message);
            if (r.code === 'CONFLICT' || r.code === 'NOT_FOUND') refresh();
          })
          .catch(() => {
            revert();
            showError('저장하지 못했습니다. 네트워크를 확인해 주세요.');
          })
          .finally(() => saving.delete(id));
      });

      // 의존 추가: 사전 검사(UX)는 여기서, 최종 검사(순환·조상 관계)는 서버가 잠금 안에서 다시 한다.
      api.intercept('add-link', (ev) => {
        if (ev.eventSource === SERVER) return true;
        const { store: s, canEdit: editable } = live.current;
        if (!editable) return false;
        const link = { source: String(ev.link.source), target: String(ev.link.target), type: String(ev.link.type ?? 'e2s') };
        const readonlyProjects = new Set(s.projects.filter((p) => p.archived).map((p) => p.id));
        const rejection = validateLink(link, { tasks: s.tasks, readonlyProjects, deps: s.deps });
        if (rejection) {
          showError(LINK_REJECTION_MESSAGES[rejection]);
          return false;
        }
        return true;
      });
      api.on('add-link', (ev) => {
        if (ev.eventSource === SERVER) return;
        const tempId = ev.id;
        const fromTaskId = String(ev.link.source);
        const toTaskId = String(ev.link.target);
        const s = live.current.store;
        const dropTemp = () => {
          if (tempId !== undefined) api.exec('delete-link', { id: tempId, eventSource: SERVER });
        };
        void addDependency({ fromTaskId, toTaskId })
          .then((r) => {
            dropTemp();
            if (!r.ok) {
              showError(r.message);
              if (r.code === 'NOT_FOUND' || (r.code === 'CONFLICT' && /보관/.test(r.message))) refresh();
              return;
            }
            s.addDependency(r.data);
            api.exec('add-link', { id: r.data.id, link: { id: r.data.id, source: fromTaskId, target: toTaskId, type: 'e2s' }, eventSource: SERVER });
            setMessage(null);
          })
          .catch(() => {
            dropTemp();
            showError('저장하지 못했습니다. 네트워크를 확인해 주세요.');
          });
      });

      // 의존 삭제(막대의 삭제 단추): 서버에서 지운 뒤에만 화면에서 뺀다.
      api.intercept('delete-link', (ev) => {
        if (ev.eventSource === SERVER) return true;
        const { store: s, canEdit: editable } = live.current;
        const id = String(ev.id);
        const dep = s.deps.find((d) => d.id === id);
        if (!editable || !dep) return false;
        const ends = [s.task(dep.fromTaskId), s.task(dep.toTaskId)];
        if (ends.some((t) => !t || s.isReadonlyProject(t.projectId))) {
          showError(LINK_REJECTION_MESSAGES.readonly);
          return false;
        }
        void removeDependency({ id }).then((r) => {
          if (r.ok || r.code === 'NOT_FOUND') {
            s.removeDependency(id);
            api.exec('delete-link', { id, eventSource: SERVER });
            if (r.ok) setMessage(null);
            else showError(r.message);
            return;
          }
          showError(r.message);
        });
        return false;
      });
    },
    [openEditor, refresh, showError],
  );

  /** 대화상자의 의존 삭제 */
  async function removeDependencyFromDialog(id: string) {
    const r = await removeDependency({ id });
    if (!r.ok && r.code !== 'NOT_FOUND') return r;
    store.removeDependency(id);
    rebuild();
    return r.ok ? null : r;
  }

  function onSaved(result: TaskWriteResult) {
    store.applyWrite(result);
    rebuild();
    setMessage(null);
  }

  function onDeleted(result: TaskDeleteResult) {
    store.applyDelete(result);
    rebuild();
    setMessage({ kind: 'info', text: `작업 ${result.deletedIds.length}개를 삭제했습니다.` });
  }

  const writableProjects = store.projects.filter((p) => !p.archived && (scope.kind === 'all' || p.id === scope.projectId));
  const editing = dialog.open && dialog.taskId ? store.task(dialog.taskId) ?? null : null;
  const taskList = dialog.open ? store.taskList() : [];
  const editingDeps: DependencyItem[] = editing
    ? store.deps.flatMap((d): DependencyItem[] => {
        if (d.toTaskId === editing.id) return [{ id: d.id, direction: 'pred', title: store.tasks.get(d.fromTaskId)?.title ?? '(보이지 않는 작업)' }];
        if (d.fromTaskId === editing.id) return [{ id: d.id, direction: 'succ', title: store.tasks.get(d.toTaskId)?.title ?? '(보이지 않는 작업)' }];
        return [];
      })
    : [];
  const defaultProjectId =
    scope.kind === 'project' ? scope.projectId : (store.projects.find((p) => p.key === filter.projectKey && !p.archived)?.id ?? undefined);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2 text-sm">
        <div className="flex items-center gap-1" role="group" aria-label="줌">
          {ZOOMS.map((z) => (
            <Button key={z} type="button" size="sm" variant={zoom === z ? 'default' : 'outline'} aria-pressed={zoom === z} onClick={() => changeZoom(z)}>
              {ZOOM_LABELS[z]}
            </Button>
          ))}
        </div>
        {scope.kind === 'all' ? (
          <select
            aria-label="프로젝트 필터"
            className={`${SELECT_CLASS} w-44`}
            value={filter.projectKey ?? ''}
            onChange={(e) => changeFilter({ projectKey: e.target.value || null })}
          >
            <option value="">모든 프로젝트</option>
            {store.projects.map((p) => (
              <option key={p.id} value={p.key}>
                [{p.key}] {p.name}
              </option>
            ))}
          </select>
        ) : null}
        <select
          aria-label="담당자 필터"
          className={`${SELECT_CLASS} w-36`}
          value={filter.assigneeId ?? ''}
          onChange={(e) => changeFilter({ assigneeId: e.target.value || null })}
        >
          <option value="">모든 담당자</option>
          <option value={UNASSIGNED}>(담당자 없음)</option>
          {store.users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        <select
          aria-label="상태 필터"
          className={`${SELECT_CLASS} w-32`}
          value={filter.status ?? ''}
          onChange={(e) => changeFilter({ status: (e.target.value || null) as TaskStatus | null })}
        >
          <option value="">모든 상태</option>
          {TASK_STATUSES.map((s) => (
            <option key={s} value={s}>
              {TASK_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        {scope.kind === 'all' ? (
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={archivedChecked} onChange={(e) => toggleArchived(e.target.checked)} />
            보관 포함
          </label>
        ) : null}
        <Button type="button" size="sm" variant="ghost" onClick={() => setAllOpen(false)}>
          모두 접기
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setAllOpen(true)}>
          모두 펼치기
        </Button>
        <span className="text-muted-foreground" data-testid="timeline-count">
          작업 {view.visibleTaskIds.size.toLocaleString('ko-KR')}건
        </span>
        {canEdit ? (
          <Button type="button" size="sm" className="ml-auto" disabled={writableProjects.length === 0} onClick={() => setDialog({ open: true, taskId: null })}>
            작업 추가
          </Button>
        ) : null}
      </div>
      {message ? (
        <Alert
          variant={message.kind === 'error' ? 'destructive' : 'default'}
          role={message.kind === 'error' ? 'alert' : 'status'}
          data-testid="timeline-message"
          className="mx-4 mt-2 w-auto"
        >
          <AlertDescription className="flex items-center justify-between gap-2">
            <span>{message.text}</span>
            <button type="button" className="text-xs underline" onClick={() => setMessage(null)}>
              닫기
            </button>
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="min-h-0 flex-1">
        {store.projects.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">표시할 프로젝트가 없습니다. 프로젝트 화면에서 먼저 만들어 주세요.</p>
        ) : (
          <GanttChart rows={view.rows} links={view.links} zoom={zoom} today={store.today} readonly={!canEdit} onInit={onInit} />
        )}
      </div>
      {canEdit ? (
        <TaskFormDialog
          open={dialog.open}
          onOpenChange={(open) => (open ? null : setDialog({ open: false }))}
          task={editing}
          projects={writableProjects}
          tasks={taskList}
          users={store.users}
          defaultProjectId={defaultProjectId}
          descendantCount={editing ? store.descendantsOf(editing.id).length : 0}
          dependencies={editingDeps}
          onRemoveDependency={removeDependencyFromDialog}
          today={store.today}
          onSaved={onSaved}
          onDeleted={onDeleted}
          onStale={refresh}
        />
      ) : null}
    </div>
  );
}

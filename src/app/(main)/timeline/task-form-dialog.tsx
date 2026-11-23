'use client';

import { Trash2 } from 'lucide-react';
import { useMemo, useState, useTransition, type ReactNode } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { DependencyDto, ProjectDto, TaskDeleteResult, TaskDto, TaskWriteResult, UserOption } from '@/lib/schedule/dto';
import { moveCreatesHierarchyDependency, subtreeDependencyPartners } from '@/lib/schedule/graph';
import { TASK_STATUSES, TASK_STATUS_COLORS, TASK_STATUS_LABELS, type TaskStatus } from '@/lib/schedule/status';
import { isHttpUrl, TASK_MEMO_MAX, TASK_URL_MAX, TITLE_MAX } from '@/lib/validation/limits';
import { createTask, deleteTask, updateTask } from '@/server/actions/task';

export const SELECT_CLASS =
  'h-9 rounded-md border border-input bg-transparent px-2.5 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50';

export type DependencyItem = { id: string; direction: 'pred' | 'succ'; title: string };

/** 새 작업의 미리 채울 값(차트에서 끌어 연 경우). 프로젝트가 작업을 만들 수 없는 곳이면 무시한다 */
export type TaskPreset = { projectId?: string; parentId?: string | null; startDate: string; endDate: string };

type Failure = { code: string; message: string; fieldErrors?: Record<string, string[]> };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 편집할 작업(없으면 생성) */
  task: TaskDto | null;
  /** 작업을 만들 수 있는(보관되지 않은) 프로젝트 */
  projects: ProjectDto[];
  /** 상위 작업 후보를 고르기 위한 현재 작업 목록 */
  tasks: TaskDto[];
  /** 상위 후보에서 의존이 걸린 작업을 빼기 위한 전체 의존(D14) */
  allDependencies?: DependencyDto[];
  users: UserOption[];
  defaultProjectId?: string;
  preset?: TaskPreset;
  /** 편집 중인 작업의 의존(선행·후행) */
  dependencies?: DependencyItem[];
  descendantCount?: number;
  today: string;
  onSaved: (result: TaskWriteResult) => void;
  onDeleted: (result: TaskDeleteResult) => void;
  onRemoveDependency?: (id: string) => Promise<Failure | null>;
  /** CONFLICT·NOT_FOUND: 최신 값을 다시 불러온다 */
  onStale: () => void;
};

export function TaskFormDialog(props: Props) {
  const { open, onOpenChange, task } = props;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] gap-5 overflow-y-auto sm:max-w-xl">
        <DialogHeader className="gap-1">
          <DialogTitle className="text-base font-semibold">{task ? '작업 수정' : '작업 추가'}</DialogTitle>
          <DialogDescription className="text-xs">
            {task?.hasChildren ? '하위 작업이 있는 작업의 기간·진행률은 하위 작업에서 자동으로 계산됩니다.' : '날짜는 시작일과 종료일을 포함합니다.'}
          </DialogDescription>
        </DialogHeader>
        {open ? <TaskForm {...props} /> : null}
      </DialogContent>
    </Dialog>
  );
}

/** 라벨(작게, 회색) + 입력 + 오류. span 이면 두 칸을 다 쓴다 */
function Field({ id, label, span, errors, children }: { id: string; label: string; span?: boolean; errors?: string[]; children: ReactNode }) {
  return (
    <div className={span ? 'col-span-2 flex flex-col gap-1.5' : 'flex min-w-0 flex-col gap-1.5'}>
      <Label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </Label>
      {children}
      <FieldErrors errors={errors} />
    </div>
  );
}

function FieldErrors({ errors }: { errors?: string[] }) {
  return errors?.map((m) => (
    <p key={m} className="text-xs text-destructive">
      {m}
    </p>
  ));
}

function TaskForm({
  task,
  projects,
  tasks,
  allDependencies,
  users,
  defaultProjectId,
  preset,
  dependencies = [],
  descendantCount = 0,
  today,
  onOpenChange,
  onSaved,
  onDeleted,
  onRemoveDependency,
  onStale,
}: Props) {
  const presetProject = preset?.projectId && projects.some((p) => p.id === preset.projectId) ? preset.projectId : undefined;
  const [projectId, setProjectId] = useState(task?.projectId ?? presetProject ?? defaultProjectId ?? projects[0]?.id ?? '');
  const [parentId, setParentId] = useState(task?.parentId ?? (presetProject ? preset?.parentId : null) ?? '');
  const [title, setTitle] = useState(task?.title ?? '');
  const [isMilestone, setIsMilestone] = useState(task?.isMilestone ?? false);
  const [startDate, setStartDate] = useState(task?.startDate ?? preset?.startDate ?? today);
  const [endDate, setEndDate] = useState(task?.endDate ?? preset?.endDate ?? today);
  const [progress, setProgress] = useState(String(task?.progress ?? 0));
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? 'TODO');
  const [assigneeId, setAssigneeId] = useState(task?.assigneeId ?? '');
  const [url, setUrl] = useState(task?.url ?? '');
  const [memo, setMemo] = useState(task?.memo ?? '');
  const [error, setError] = useState<Failure | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, startTransition] = useTransition();
  const summary = task?.hasChildren ?? false;

  // 상위 작업 후보: 같은 프로젝트, 마일스톤 아님, 자기 자신·하위 아님, 옮기면 상위·하위 사이 의존이 생기는 작업 아님(D14)
  // (깊이 제한은 서버가 검사한다. 서버도 의존 조건을 잠금 안에서 다시 검사한다)
  const movingId = task?.id;
  const currentParentId = task?.parentId;
  const parentOptions = useMemo(() => {
    const inProject = tasks.filter((t) => t.projectId === projectId);
    const parentOf = new Map(inProject.map((t) => [t.id, t.parentId]));
    const depth = (id: string) => {
      let d = 0;
      for (let cur = parentOf.get(id); cur; cur = parentOf.get(cur)) d += 1;
      return d;
    };
    const underTask = (id: string) => {
      for (let cur: string | null | undefined = id; cur; cur = parentOf.get(cur)) if (cur === movingId) return true;
      return false;
    };
    const edges = (allDependencies ?? []).map((d) => ({ from: d.fromTaskId, to: d.toTaskId }));
    const partners = movingId ? subtreeDependencyPartners(parentOf, edges, movingId) : null;
    const depBlocked = (id: string) =>
      !!movingId && !!partners && id !== currentParentId && moveCreatesHierarchyDependency(parentOf, edges, movingId, id, partners);
    return inProject
      .filter((t) => !t.isMilestone && !underTask(t.id) && !depBlocked(t.id))
      .map((t) => ({ id: t.id, label: `${'— '.repeat(depth(t.id))}${t.title}` }));
  }, [tasks, allDependencies, projectId, movingId, currentParentId]);

  function fail(r: Failure) {
    setError(r);
    if (r.code === 'CONFLICT' || r.code === 'NOT_FOUND') onStale();
  }

  function submit() {
    const end = isMilestone ? startDate : endDate;
    const progressNum = Number(progress);
    startTransition(async () => {
      if (!task) {
        const r = await createTask({
          projectId,
          parentId: parentId || null,
          title,
          startDate,
          endDate: end,
          progress: progressNum,
          status,
          assigneeId: assigneeId || null,
          isMilestone,
          url: url.trim() || null,
          memo: memo.trim() || null,
        });
        if (!r.ok) return fail(r);
        onSaved(r.data);
        onOpenChange(false);
        return;
      }
      const patch: Record<string, unknown> = {};
      if (title !== task.title) patch.title = title;
      if ((parentId || null) !== task.parentId) patch.parentId = parentId || null;
      if (isMilestone !== task.isMilestone) patch.isMilestone = isMilestone;
      if (!summary) {
        if (startDate !== task.startDate) patch.startDate = startDate;
        if (end !== task.endDate) patch.endDate = end;
        if (progressNum !== task.progress) patch.progress = progressNum;
      }
      if (status !== task.status) patch.status = status;
      if ((assigneeId || null) !== task.assigneeId) patch.assigneeId = assigneeId || null;
      if ((url.trim() || null) !== task.url) patch.url = url.trim() || null;
      if ((memo.trim() || null) !== task.memo) patch.memo = memo.trim() || null;
      if (Object.keys(patch).length === 0) return onOpenChange(false);
      const r = await updateTask({ id: task.id, version: task.version, ...patch });
      if (!r.ok) return fail(r);
      onSaved(r.data);
      onOpenChange(false);
    });
  }

  function remove() {
    if (!task) return;
    startTransition(async () => {
      const r = await deleteTask({ id: task.id, version: task.version });
      if (!r.ok) return fail(r);
      onDeleted(r.data);
      onOpenChange(false);
    });
  }

  function removeDependency(id: string) {
    if (!onRemoveDependency) return;
    startTransition(async () => {
      const r = await onRemoveDependency(id);
      if (r) fail(r);
    });
  }

  const fe = error?.fieldErrors ?? {};
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="grid grid-cols-2 gap-x-4 gap-y-3.5"
    >
      <Field id="task-title" label="제목" span errors={fe.title}>
        <Input
          id="task-title"
          className="h-10 text-[15px] font-medium"
          placeholder="작업 이름"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          maxLength={TITLE_MAX}
        />
      </Field>
      {task ? null : (
        <Field id="task-project" label="프로젝트" errors={fe.projectId}>
          <select
            id="task-project"
            className={`${SELECT_CLASS} w-full`}
            value={projectId}
            onChange={(e) => {
              setProjectId(e.target.value);
              setParentId('');
            }}
            required
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                [{p.key}] {p.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field id="task-parent" label="상위 작업" span={!!task} errors={fe.parentId}>
        <select id="task-parent" className={`${SELECT_CLASS} w-full`} value={parentId} onChange={(e) => setParentId(e.target.value)}>
          <option value="">(없음 — 프로젝트 바로 아래)</option>
          {parentOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>
      <Field id="task-start" label={isMilestone ? '날짜' : '시작일'} errors={fe.startDate}>
        <Input
          id="task-start"
          type="date"
          min="2000-01-01"
          max="2100-12-31"
          required
          disabled={summary}
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
        />
      </Field>
      {isMilestone ? (
        <div className="flex flex-col justify-end gap-1.5">
          <FieldErrors errors={fe.endDate} />
        </div>
      ) : (
        <Field id="task-end" label="종료일" errors={fe.endDate}>
          <Input
            id="task-end"
            type="date"
            min="2000-01-01"
            max="2100-12-31"
            required
            disabled={summary}
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </Field>
      )}
      <div className="col-span-2 -mt-1 flex flex-col gap-1">
        <label className="flex w-fit cursor-pointer items-center gap-2 text-[13px] text-foreground has-disabled:cursor-not-allowed has-disabled:opacity-60">
          <input
            type="checkbox"
            className="size-3.5 accent-[var(--brand)]"
            checked={isMilestone}
            disabled={summary}
            onChange={(e) => {
              setIsMilestone(e.target.checked);
              if (e.target.checked) setEndDate(startDate);
            }}
          />
          마일스톤(하루짜리 기준점)
        </label>
        <FieldErrors errors={fe.isMilestone} />
      </div>
      <Field id="task-status" label="상태">
        <div className="relative">
          <span
            className="pointer-events-none absolute top-1/2 left-3 size-2 -translate-y-1/2 rounded-full"
            style={{ background: TASK_STATUS_COLORS[status] }}
            aria-hidden
          />
          <select id="task-status" className={`${SELECT_CLASS} w-full pl-7`} value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)}>
            {TASK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {TASK_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
      </Field>
      <Field id="task-assignee" label="담당자" errors={fe.assigneeId}>
        <select id="task-assignee" className={`${SELECT_CLASS} w-full`} value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
          <option value="">(없음)</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </Field>
      <Field id="task-progress" label="진행률(%)" errors={fe.progress}>
        <Input
          id="task-progress"
          type="number"
          min={0}
          max={100}
          step={1}
          required
          disabled={summary}
          value={progress}
          onChange={(e) => setProgress(e.target.value)}
        />
      </Field>
      <Field id="task-url" label="관련 링크(URL)" errors={fe.url}>
        <div className="flex items-center gap-2">
          <Input
            id="task-url"
            type="url"
            placeholder="https://"
            maxLength={TASK_URL_MAX}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          {/* href 에는 http/https 로 검증된 값만 넣는다(javascript: 등 차단) */}
          {isHttpUrl(url.trim()) ? (
            <a
              href={url.trim()}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 text-xs font-medium text-brand hover:underline"
              data-testid="task-url-open"
            >
              열기
            </a>
          ) : null}
        </div>
      </Field>
      <Field id="task-memo" label="메모" span errors={fe.memo}>
        <textarea
          id="task-memo"
          rows={3}
          maxLength={TASK_MEMO_MAX}
          placeholder="메모를 남겨 주세요"
          className="min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none placeholder:text-text-subtle focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
        />
      </Field>
      {task && dependencies.length ? (
        <div className="col-span-2 flex flex-col gap-1.5" data-testid="task-dependencies">
          <span className="text-xs font-medium text-muted-foreground">의존(완료→시작)</span>
          <ul className="flex flex-col divide-y divide-line rounded-md border border-line text-[13px]">
            {dependencies.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2 py-1 pr-1 pl-3">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="shrink-0 rounded bg-surface-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                    {d.direction === 'pred' ? '선행' : '후행'}
                    <span className="sr-only">: </span>
                  </span>
                  <span className="truncate">{d.title}</span>
                </span>
                {onRemoveDependency ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-muted-foreground hover:text-destructive"
                    disabled={pending}
                    onClick={() => removeDependency(d.id)}
                    aria-label={`의존 삭제 ${d.title}`}
                  >
                    삭제
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {error ? (
        <Alert variant="destructive" role="alert" data-testid="task-form-error" className="col-span-2">
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      ) : null}
      {confirmDelete ? (
        <Alert variant="destructive" data-testid="task-delete-confirm" className="col-span-2">
          <AlertDescription>
            {descendantCount > 0
              ? `하위 작업 ${descendantCount}개와 연결된 의존 관계도 함께 삭제됩니다. 되돌릴 수 없습니다.`
              : '이 작업과 연결된 의존 관계가 삭제됩니다. 되돌릴 수 없습니다.'}
          </AlertDescription>
        </Alert>
      ) : null}
      <DialogFooter className="col-span-2 mt-1 gap-2 border-t border-line pt-4 sm:justify-between">
        {task ? (
          confirmDelete ? (
            <div className="flex gap-2">
              <Button type="button" variant="destructive" size="sm" disabled={pending} onClick={remove}>
                삭제 확인
              </Button>
              <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => setConfirmDelete(false)}>
                취소
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1.5 text-muted-foreground hover:bg-red-50 hover:text-destructive"
              disabled={pending}
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="size-3.5" />
              삭제
            </Button>
          )
        ) : (
          <span />
        )}
        <Button type="submit" size="sm" className="min-w-20 bg-brand font-semibold text-white hover:bg-brand-hover" disabled={pending}>
          {pending ? '저장 중…' : '저장'}
        </Button>
      </DialogFooter>
    </form>
  );
}

'use client';

import { useMemo, useState, useTransition } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ProjectDto, TaskDeleteResult, TaskDto, TaskWriteResult, UserOption } from '@/lib/schedule/dto';
import { TASK_STATUSES, TASK_STATUS_LABELS, type TaskStatus } from '@/lib/schedule/status';
import { TITLE_MAX } from '@/lib/validation/limits';
import { createTask, deleteTask, updateTask } from '@/server/actions/task';

export const SELECT_CLASS =
  'h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50';

export type DependencyItem = { id: string; direction: 'pred' | 'succ'; title: string };

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
  users: UserOption[];
  defaultProjectId?: string;
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
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{task ? '작업 수정' : '작업 추가'}</DialogTitle>
          <DialogDescription>
            {task?.hasChildren ? '하위 작업이 있는 작업의 기간·진행률은 하위 작업에서 자동으로 계산됩니다.' : '날짜는 시작일과 종료일을 포함합니다.'}
          </DialogDescription>
        </DialogHeader>
        {open ? <TaskForm {...props} /> : null}
      </DialogContent>
    </Dialog>
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
  users,
  defaultProjectId,
  dependencies = [],
  descendantCount = 0,
  today,
  onOpenChange,
  onSaved,
  onDeleted,
  onRemoveDependency,
  onStale,
}: Props) {
  const [projectId, setProjectId] = useState(task?.projectId ?? defaultProjectId ?? projects[0]?.id ?? '');
  const [parentId, setParentId] = useState(task?.parentId ?? '');
  const [title, setTitle] = useState(task?.title ?? '');
  const [isMilestone, setIsMilestone] = useState(task?.isMilestone ?? false);
  const [startDate, setStartDate] = useState(task?.startDate ?? today);
  const [endDate, setEndDate] = useState(task?.endDate ?? today);
  const [progress, setProgress] = useState(String(task?.progress ?? 0));
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? 'TODO');
  const [assigneeId, setAssigneeId] = useState(task?.assigneeId ?? '');
  const [error, setError] = useState<Failure | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, startTransition] = useTransition();
  const summary = task?.hasChildren ?? false;

  // 상위 작업 후보: 같은 프로젝트, 마일스톤 아님, 자기 자신·하위 아님(깊이 제한은 서버가 검사한다)
  const parentOptions = useMemo(() => {
    const inProject = tasks.filter((t) => t.projectId === projectId);
    const parentOf = new Map(inProject.map((t) => [t.id, t.parentId]));
    const depth = (id: string) => {
      let d = 0;
      for (let cur = parentOf.get(id); cur; cur = parentOf.get(cur)) d += 1;
      return d;
    };
    const underTask = (id: string) => {
      for (let cur: string | null | undefined = id; cur; cur = parentOf.get(cur)) if (cur === task?.id) return true;
      return false;
    };
    return inProject.filter((t) => !t.isMilestone && !underTask(t.id)).map((t) => ({ id: t.id, label: `${'— '.repeat(depth(t.id))}${t.title}` }));
  }, [tasks, projectId, task?.id]);

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
      className="flex flex-col gap-3"
    >
      {task ? null : (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="task-project">프로젝트</Label>
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
          <FieldErrors errors={fe.projectId} />
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="task-parent">상위 작업</Label>
        <select id="task-parent" className={`${SELECT_CLASS} w-full`} value={parentId} onChange={(e) => setParentId(e.target.value)}>
          <option value="">(없음 — 프로젝트 바로 아래)</option>
          {parentOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
        <FieldErrors errors={fe.parentId} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="task-title">제목</Label>
        <Input id="task-title" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={TITLE_MAX} />
        <FieldErrors errors={fe.title} />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
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
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="task-start">{isMilestone ? '날짜' : '시작일'}</Label>
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
          <FieldErrors errors={fe.startDate} />
        </div>
        {isMilestone ? null : (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="task-end">종료일</Label>
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
            <FieldErrors errors={fe.endDate} />
          </div>
        )}
      </div>
      {isMilestone ? <FieldErrors errors={fe.endDate} /> : null}
      <div className="grid grid-cols-3 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="task-progress">진행률(%)</Label>
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
          <FieldErrors errors={fe.progress} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="task-status">상태</Label>
          <select id="task-status" className={`${SELECT_CLASS} w-full`} value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)}>
            {TASK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {TASK_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="task-assignee">담당자</Label>
          <select id="task-assignee" className={`${SELECT_CLASS} w-full`} value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
            <option value="">(없음)</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          <FieldErrors errors={fe.assigneeId} />
        </div>
      </div>
      {task && dependencies.length ? (
        <div className="flex flex-col gap-1.5" data-testid="task-dependencies">
          <span className="text-sm font-medium">의존(완료→시작)</span>
          <ul className="flex flex-col gap-1 text-sm">
            {dependencies.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2">
                <span>
                  {d.direction === 'pred' ? '선행: ' : '후행: '}
                  {d.title}
                </span>
                {onRemoveDependency ? (
                  <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => removeDependency(d.id)} aria-label={`의존 삭제 ${d.title}`}>
                    삭제
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {error ? (
        <Alert variant="destructive" role="alert" data-testid="task-form-error">
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      ) : null}
      {confirmDelete ? (
        <Alert variant="destructive" data-testid="task-delete-confirm">
          <AlertDescription>
            {descendantCount > 0
              ? `하위 작업 ${descendantCount}개와 연결된 의존 관계도 함께 삭제됩니다. 되돌릴 수 없습니다.`
              : '이 작업과 연결된 의존 관계가 삭제됩니다. 되돌릴 수 없습니다.'}
          </AlertDescription>
        </Alert>
      ) : null}
      <DialogFooter className="gap-2 sm:justify-between">
        {task ? (
          confirmDelete ? (
            <div className="flex gap-2">
              <Button type="button" variant="destructive" disabled={pending} onClick={remove}>
                삭제 확인
              </Button>
              <Button type="button" variant="ghost" disabled={pending} onClick={() => setConfirmDelete(false)}>
                취소
              </Button>
            </div>
          ) : (
            <Button type="button" variant="outline" disabled={pending} onClick={() => setConfirmDelete(true)}>
              삭제
            </Button>
          )
        ) : (
          <span />
        )}
        <Button type="submit" disabled={pending}>
          {pending ? '저장 중…' : '저장'}
        </Button>
      </DialogFooter>
    </form>
  );
}

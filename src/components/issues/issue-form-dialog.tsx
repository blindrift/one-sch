'use client';

import { useState, useTransition, type ReactNode } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { IssueDto } from '@/lib/issue/dto';
import {
  ISSUE_PRIORITIES,
  ISSUE_PRIORITY_LABELS,
  ISSUE_STATUSES,
  ISSUE_STATUS_LABELS,
  ISSUE_TYPES,
  ISSUE_TYPE_LABELS,
  type IssuePriority,
  type IssueStatus,
  type IssueType,
} from '@/lib/issue/status';
import type { UserOption } from '@/lib/schedule/dto';
import { ISSUE_DESC_MAX, TITLE_MAX } from '@/lib/validation/limits';
import { createIssue, updateIssue } from '@/server/actions/issue';

const SELECT_CLASS =
  'h-9 w-full rounded-md border border-input bg-transparent px-2.5 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50';

export type ProjectOption = { id: string; key: string; name: string };
export type TaskOption = { id: string; title: string };
type Failure = { code: string; message: string; fieldErrors?: Record<string, string[]> };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 고칠 이슈(없으면 생성) */
  issue: IssueDto | null;
  /** 이슈를 만들 수 있는(보관되지 않은) 프로젝트. 고칠 때는 쓰지 않는다 */
  projects: ProjectOption[];
  defaultProjectId?: string;
  users: UserOption[];
  /** 연결 작업 후보(그 프로젝트의 작업). 없으면 연결 작업 칸을 숨긴다(전체 이슈에서 새로 만들 때) */
  taskOptions?: TaskOption[];
  onSaved: (issue: IssueDto) => void;
  /** CONFLICT·NOT_FOUND: 최신 값을 다시 불러온다 */
  onStale: () => void;
};

export function IssueFormDialog(props: Props) {
  const { open, onOpenChange, issue } = props;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] gap-5 overflow-y-auto sm:max-w-xl">
        <DialogHeader className="gap-1">
          <DialogTitle className="text-base font-semibold">{issue ? `${issue.key} 수정` : '이슈 추가'}</DialogTitle>
          <DialogDescription className="text-xs">설명은 마크다운으로 쓸 수 있습니다(HTML·이미지는 표시하지 않습니다).</DialogDescription>
        </DialogHeader>
        {open ? <IssueForm {...props} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function Field({ id, label, span, errors, children }: { id: string; label: string; span?: boolean; errors?: string[]; children: ReactNode }) {
  return (
    <div className={span ? 'col-span-2 flex flex-col gap-1.5' : 'flex min-w-0 flex-col gap-1.5'}>
      <Label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </Label>
      {children}
      {errors?.map((m) => (
        <p key={m} className="text-xs text-destructive">
          {m}
        </p>
      ))}
    </div>
  );
}

function IssueForm({ issue, projects, defaultProjectId, users, taskOptions, onOpenChange, onSaved, onStale }: Props) {
  const [projectId, setProjectId] = useState(issue?.projectId ?? defaultProjectId ?? projects[0]?.id ?? '');
  const [title, setTitle] = useState(issue?.title ?? '');
  const [description, setDescription] = useState(issue?.description ?? '');
  const [type, setType] = useState<IssueType>(issue?.type ?? 'ISSUE');
  const [status, setStatus] = useState<IssueStatus>(issue?.status ?? 'OPEN');
  const [priority, setPriority] = useState<IssuePriority>(issue?.priority ?? 'MEDIUM');
  const [assigneeId, setAssigneeId] = useState(issue?.assigneeId ?? '');
  const [taskId, setTaskId] = useState(issue?.taskId ?? '');
  const [dueDate, setDueDate] = useState(issue?.dueDate ?? '');
  const [error, setError] = useState<Failure | null>(null);
  const [pending, startTransition] = useTransition();

  function fail(r: Failure) {
    setError(r);
    if (r.code === 'CONFLICT' || r.code === 'NOT_FOUND') onStale();
  }

  function submit() {
    startTransition(async () => {
      if (!issue) {
        const r = await createIssue({
          projectId,
          title,
          description,
          type,
          status,
          priority,
          assigneeId: assigneeId || null,
          ...(taskOptions ? { taskId: taskId || null } : {}),
          dueDate: dueDate || null,
        });
        if (!r.ok) return fail(r);
        onSaved(r.data);
        onOpenChange(false);
        return;
      }
      const patch: Record<string, unknown> = {};
      if (title !== issue.title) patch.title = title;
      if (description.trim() !== issue.description) patch.description = description;
      if (type !== issue.type) patch.type = type;
      if (status !== issue.status) patch.status = status;
      if (priority !== issue.priority) patch.priority = priority;
      if ((assigneeId || null) !== issue.assigneeId) patch.assigneeId = assigneeId || null;
      if (taskOptions && (taskId || null) !== issue.taskId) patch.taskId = taskId || null;
      if ((dueDate || null) !== issue.dueDate) patch.dueDate = dueDate || null;
      if (Object.keys(patch).length === 0) return onOpenChange(false);
      const r = await updateIssue({ id: issue.id, version: issue.version, ...patch });
      if (!r.ok) return fail(r);
      onSaved(r.data);
      onOpenChange(false);
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
      <Field id="issue-title" label="제목" span errors={fe.title}>
        <Input id="issue-title" className="h-10 text-[15px] font-medium" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={TITLE_MAX} />
      </Field>
      {issue || projects.length <= 1 ? null : (
        <Field id="issue-project" label="프로젝트" span errors={fe.projectId}>
          <select id="issue-project" className={SELECT_CLASS} value={projectId} onChange={(e) => setProjectId(e.target.value)} required>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                [{p.key}] {p.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field id="issue-type" label="유형" errors={fe.type}>
        <select id="issue-type" className={SELECT_CLASS} value={type} onChange={(e) => setType(e.target.value as IssueType)}>
          {ISSUE_TYPES.map((t) => (
            <option key={t} value={t}>
              {ISSUE_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </Field>
      <Field id="issue-priority" label="우선순위" errors={fe.priority}>
        <select id="issue-priority" className={SELECT_CLASS} value={priority} onChange={(e) => setPriority(e.target.value as IssuePriority)}>
          {ISSUE_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {ISSUE_PRIORITY_LABELS[p]}
            </option>
          ))}
        </select>
      </Field>
      <Field id="issue-status" label="상태" errors={fe.status}>
        <select id="issue-status" className={SELECT_CLASS} value={status} onChange={(e) => setStatus(e.target.value as IssueStatus)}>
          {ISSUE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {ISSUE_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </Field>
      <Field id="issue-assignee" label="담당자" errors={fe.assigneeId}>
        <select id="issue-assignee" className={SELECT_CLASS} value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
          <option value="">(없음)</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </Field>
      <Field id="issue-due" label="마감일" errors={fe.dueDate}>
        <Input id="issue-due" type="date" min="2000-01-01" max="2100-12-31" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
      </Field>
      {taskOptions ? (
        <Field id="issue-task" label="연결 작업" errors={fe.taskId}>
          <select id="issue-task" className={SELECT_CLASS} value={taskId} onChange={(e) => setTaskId(e.target.value)}>
            <option value="">(없음)</option>
            {taskOptions.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      <Field id="issue-description" label="설명(마크다운)" span errors={fe.description}>
        <Textarea id="issue-description" rows={8} maxLength={ISSUE_DESC_MAX} value={description} onChange={(e) => setDescription(e.target.value)} className="font-mono text-[13px]" />
      </Field>
      {error ? (
        <Alert variant="destructive" role="alert" data-testid="issue-form-error" className="col-span-2">
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      ) : null}
      <DialogFooter className="col-span-2 mt-1 gap-2 border-t border-line pt-4">
        <Button type="submit" size="sm" className="min-w-20 bg-brand font-semibold text-white hover:bg-brand-hover" disabled={pending}>
          {pending ? '저장 중…' : '저장'}
        </Button>
      </DialogFooter>
    </form>
  );
}

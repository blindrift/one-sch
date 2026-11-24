'use client';

import { Pencil, Plus, Trash2 } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import type { IssueDto } from '@/lib/issue/dto';
import type { UserOption } from '@/lib/schedule/dto';
import { deleteIssue } from '@/server/actions/issue';
import { IssueFormDialog, type ProjectOption, type TaskOption } from './issue-form-dialog';

/** 현재 URL 에서 issue 만 바꾼 주소(목록 query 유지) */
function useIssueHref() {
  const pathname = usePathname();
  const params = useSearchParams();
  return (key: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (key) next.set('issue', key);
    else next.delete('issue');
    const qs = next.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };
}

/** "이슈 추가" 단추와 대화상자. 만들면 새 이슈의 상세 패널로 간다 */
export function NewIssueButton({
  projects,
  defaultProjectId,
  users,
  taskOptions,
}: {
  projects: ProjectOption[];
  defaultProjectId?: string;
  users: UserOption[];
  taskOptions?: TaskOption[];
}) {
  const router = useRouter();
  const issueHref = useIssueHref();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        size="sm"
        className="ml-auto h-8 gap-1.5 rounded-md bg-brand px-3 text-xs font-semibold text-white shadow-sm hover:bg-brand-hover"
        disabled={projects.length === 0}
        onClick={() => setOpen(true)}
      >
        <Plus className="size-3.5" />
        이슈 추가
      </Button>
      <IssueFormDialog
        open={open}
        onOpenChange={setOpen}
        issue={null}
        projects={projects}
        defaultProjectId={defaultProjectId}
        users={users}
        taskOptions={taskOptions}
        onSaved={(issue) => router.push(issueHref(issue.key), { scroll: false })}
        onStale={() => router.refresh()}
      />
    </>
  );
}

/** 상세 패널의 수정·삭제(MEMBER, 보관 프로젝트 제외). 삭제는 한 번 더 확인한다 */
export function IssueActions({ issue, users, taskOptions, commentCount }: { issue: IssueDto; users: UserOption[]; taskOptions: TaskOption[]; commentCount: number }) {
  const router = useRouter();
  const issueHref = useIssueHref();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function remove() {
    startTransition(async () => {
      const r = await deleteIssue({ id: issue.id, version: issue.version });
      if (!r.ok) {
        setError(r.message);
        if (r.code === 'CONFLICT' || r.code === 'NOT_FOUND') router.refresh();
        return;
      }
      router.push(issueHref(null), { scroll: false });
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <Button type="button" variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => setOpen(true)}>
          <Pencil className="size-3.5" />
          수정
        </Button>
        {confirm ? (
          <>
            <Button type="button" variant="destructive" size="sm" className="h-7 text-xs" disabled={pending} onClick={remove}>
              삭제 확인
            </Button>
            <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" disabled={pending} onClick={() => setConfirm(false)}>
              취소
            </Button>
          </>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-xs text-muted-foreground hover:bg-red-50 hover:text-destructive"
            onClick={() => setConfirm(true)}
          >
            <Trash2 className="size-3.5" />
            삭제
          </Button>
        )}
      </div>
      {confirm ? (
        <Alert variant="destructive" data-testid="issue-delete-confirm">
          <AlertDescription>
            {commentCount > 0 ? `댓글 ${commentCount}개도 함께 삭제됩니다. ` : ''}되돌릴 수 없습니다.
          </AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="destructive" role="alert" data-testid="issue-panel-error">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <IssueFormDialog
        open={open}
        onOpenChange={setOpen}
        issue={issue}
        projects={[]}
        users={users}
        taskOptions={taskOptions}
        onSaved={() => router.refresh()}
        onStale={() => router.refresh()}
      />
    </div>
  );
}

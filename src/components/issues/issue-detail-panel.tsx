import { X } from 'lucide-react';
import Link from 'next/link';
import { Markdown } from '@/components/markdown';
import type { IssueDetail } from '@/lib/issue/dto';
import { formatDateTime } from '@/lib/issue/format';
import { ISSUE_TYPE_LABELS } from '@/lib/issue/status';
import { hasRole } from '@/lib/roles';
import type { UserOption } from '@/lib/schedule/dto';
import type { SessionUser } from '@/server/auth/current-user';
import { CommentForm, CommentItem } from './comment-client';
import { IssuePriorityBadge, IssueStatusBadge } from './issue-badges';
import { IssueActions } from './issue-client';
import type { TaskOption } from './issue-form-dialog';

/**
 * 이슈 상세 패널(서버 렌더, `?issue=KEY-n`). 설명·댓글 마크다운은 여기서 렌더하고, 단추만 클라이언트 컴포넌트다.
 * 보관 프로젝트는 읽기 전용(D18): 수정·삭제·댓글 단추가 없다.
 */
export function IssueDetailPanel({
  detail,
  me,
  users,
  taskOptions,
  closeHref,
}: {
  detail: IssueDetail;
  me: SessionUser;
  users: UserOption[];
  taskOptions: TaskOption[];
  closeHref: string;
}) {
  const writable = !detail.projectArchived;
  const canEdit = writable && hasRole(me.role, 'MEMBER');
  const commentCount = detail.comments.filter((c) => !c.deleted).length;
  const row = (label: string, value: React.ReactNode) => (
    <div className="flex items-center gap-3 py-1 text-[13px]">
      <dt className="w-16 shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1">{value}</dd>
    </div>
  );
  const none = <span className="text-text-subtle">—</span>;

  return (
    <aside
      aria-label={`${detail.key} 상세`}
      data-testid="issue-panel"
      className="flex min-h-0 w-full shrink-0 flex-col border-l border-line bg-background lg:w-[460px]"
    >
      <div className="flex items-start gap-2 border-b border-line px-5 py-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="font-mono text-xs text-text-subtle">
            {detail.key} · {ISSUE_TYPE_LABELS[detail.type]}
          </span>
          <h2 className="text-base leading-snug font-semibold break-words">{detail.title}</h2>
        </div>
        <Link href={closeHref} scroll={false} aria-label="상세 닫기" className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-text-subtle hover:bg-surface-muted hover:text-foreground">
          <X className="size-4" />
        </Link>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
        {detail.projectArchived ? (
          <p className="rounded-md border border-line bg-surface-muted px-3 py-2 text-xs text-muted-foreground">보관된 프로젝트의 이슈는 읽기 전용입니다.</p>
        ) : null}
        {canEdit ? <IssueActions issue={detail} users={users} taskOptions={taskOptions} commentCount={commentCount} /> : null}
        <dl className="flex flex-col">
          {row('상태', <IssueStatusBadge status={detail.status} />)}
          {row('우선순위', <IssuePriorityBadge priority={detail.priority} />)}
          {row('담당자', detail.assigneeName ?? none)}
          {row('보고자', detail.reporterName)}
          {row('마감일', detail.dueDate ? <span className="tabular-nums">{detail.dueDate}</span> : none)}
          {row(
            '연결 작업',
            detail.task ? (
              <Link href={`/projects/${detail.projectKey}/list?q=${encodeURIComponent(detail.task.title.slice(0, 100))}`} className="text-brand hover:underline">
                {detail.task.title}
              </Link>
            ) : (
              none
            ),
          )}
          {row('프로젝트', `[${detail.projectKey}] ${detail.projectName}`)}
          {row('만든 시각', <span className="text-xs tabular-nums">{formatDateTime(detail.createdAt)}</span>)}
        </dl>
        <section aria-label="설명" className="rounded-lg border border-line px-4 py-3" data-testid="issue-description">
          {detail.description ? <Markdown>{detail.description}</Markdown> : <p className="text-[13px] text-text-subtle">설명이 없습니다.</p>}
        </section>
        <section aria-label="댓글" className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">댓글 {commentCount}</h3>
          <ul className="flex flex-col" data-testid="comment-list">
            {detail.comments.map((c) => (
              <CommentItem
                key={c.id}
                comment={c}
                canEdit={writable && c.authorId === me.id}
                canDelete={writable && (c.authorId === me.id || me.role === 'ADMIN')}
              >
                {c.body !== null ? <Markdown>{c.body}</Markdown> : null}
              </CommentItem>
            ))}
          </ul>
          {writable ? <CommentForm issueId={detail.id} /> : null}
        </section>
      </div>
    </aside>
  );
}

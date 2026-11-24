'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type ReactNode } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { formatDateTime } from '@/lib/issue/format';
import type { CommentDto } from '@/lib/issue/dto';
import { COMMENT_MAX } from '@/lib/validation/limits';
import { addComment, deleteComment, updateComment } from '@/server/actions/comment';

/**
 * 댓글 하나. 본문(마크다운)은 서버가 렌더해 children 으로 넘긴다(클라이언트에는 파서를 싣지 않는다).
 * 수정은 작성자만, 삭제는 작성자 또는 ADMIN(서버가 다시 판정한다). 보관 프로젝트면 단추가 없다.
 */
export function CommentItem({ comment, canEdit, canDelete, children }: { comment: CommentDto; canEdit: boolean; canDelete: boolean; children: ReactNode }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(comment.body ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<{ ok: boolean; message?: string; code?: string }>, after: () => void) {
    startTransition(async () => {
      const r = await action();
      if (!r.ok) {
        setError(r.message ?? '저장하지 못했습니다.');
        if (r.code === 'CONFLICT' || r.code === 'NOT_FOUND') router.refresh();
        return;
      }
      setError(null);
      after();
      router.refresh();
    });
  }

  return (
    <li className="flex flex-col gap-1.5 border-b border-line py-3 last:border-0" data-testid={`comment-${comment.id}`}>
      <div className="flex items-center gap-2 text-xs">
        <span className="font-medium">{comment.authorName}</span>
        <span className="text-text-subtle tabular-nums">{formatDateTime(comment.createdAt)}</span>
        {comment.edited ? <span className="text-text-subtle">(수정됨)</span> : null}
        {!comment.deleted && !editing ? (
          <span className="ml-auto flex items-center gap-1">
            {canEdit ? (
              <button type="button" className="rounded px-1.5 py-0.5 text-text-subtle hover:bg-surface-muted hover:text-foreground" onClick={() => setEditing(true)}>
                수정
              </button>
            ) : null}
            {canDelete ? (
              <button
                type="button"
                className="rounded px-1.5 py-0.5 text-text-subtle hover:bg-red-50 hover:text-destructive"
                disabled={pending}
                onClick={() => run(() => deleteComment({ id: comment.id }), () => undefined)}
              >
                삭제
              </button>
            ) : null}
          </span>
        ) : null}
      </div>
      {comment.deleted ? (
        <p className="text-[13px] text-text-subtle italic">삭제된 댓글입니다.</p>
      ) : editing ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => updateComment({ id: comment.id, body }), () => setEditing(false));
          }}
        >
          <Textarea aria-label="댓글 수정" rows={3} maxLength={COMMENT_MAX} value={body} onChange={(e) => setBody(e.target.value)} />
          <div className="flex justify-end gap-1.5">
            <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setEditing(false)}>
              취소
            </Button>
            <Button type="submit" size="sm" className="h-7 bg-brand text-xs text-white hover:bg-brand-hover" disabled={pending}>
              저장
            </Button>
          </div>
        </form>
      ) : (
        children
      )}
      {error ? (
        <Alert variant="destructive" role="alert" data-testid="comment-error">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </li>
  );
}

/** 새 댓글 입력(VIEWER 이상, 보관 프로젝트 제외) */
export function CommentForm({ issueId }: { issueId: string }) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const r = await addComment({ issueId, body });
          if (!r.ok) {
            setError(r.fieldErrors?.body?.[0] ?? r.message);
            if (r.code === 'CONFLICT' || r.code === 'NOT_FOUND') router.refresh();
            return;
          }
          setBody('');
          setError(null);
          router.refresh();
        });
      }}
    >
      <Textarea aria-label="댓글" placeholder="댓글을 남겨 주세요(마크다운)" rows={3} maxLength={COMMENT_MAX} value={body} onChange={(e) => setBody(e.target.value)} />
      {error ? (
        <Alert variant="destructive" role="alert" data-testid="comment-error">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex justify-end">
        <Button type="submit" size="sm" className="h-8 bg-brand text-xs font-semibold text-white hover:bg-brand-hover" disabled={pending || !body.trim()}>
          {pending ? '등록 중…' : '댓글 등록'}
        </Button>
      </div>
    </form>
  );
}

import 'server-only';
import type { CommentDto } from '@/lib/issue/dto';
import type { Role } from '@/lib/roles';
import { COMMENTS_PER_ISSUE_MAX } from '@/lib/validation/limits';
import type { AddCommentInput, DeleteCommentInput, UpdateCommentInput } from '@/lib/validation/comment';
import { AppError } from '../action-result';
import { writeAudit } from '../audit';
import { prisma } from '../db';
import type { RequestMeta } from '../request-meta';
import { ensureWritableProject } from './schedule-dto';
import { lockProject, SCHEDULE_TX } from './schedule-lock';

// 댓글 권한(설계서 7.4, D21): 작성은 VIEWER 이상 누구나, 수정은 작성자만, 삭제는 작성자 또는 ADMIN.
// 보관 프로젝트의 이슈에는 쓸 수 없다(D18). 보관 처리와 엇갈리지 않게 같은 프로젝트 잠금을 잡는다.

export type CommentActor = { id: string; role: Role };

type CommentRow = {
  id: string;
  authorId: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  author: { name: string };
};

/** 화면용 댓글. 지운 댓글은 본문을 싣지 않는다 */
export function toCommentDto(c: CommentRow): CommentDto {
  const deleted = c.deletedAt !== null;
  return {
    id: c.id,
    authorId: c.authorId,
    authorName: c.author.name,
    body: deleted ? null : c.body,
    deleted,
    // 만들 때 createdAt·updatedAt 을 같은 값으로 넣으므로(addComment) 다르면 고친 것이다
    edited: !deleted && c.updatedAt.getTime() !== c.createdAt.getTime(),
    createdAt: c.createdAt.toISOString(),
  };
}

/** 잠금 전에 댓글·이슈의 프로젝트를 알아낸다(바뀌지 않는 값) */
async function projectOfIssue(issueId: string): Promise<string> {
  const i = await prisma.issue.findUnique({ where: { id: issueId }, select: { projectId: true } });
  if (!i) throw new AppError('NOT_FOUND');
  return i.projectId;
}

async function projectOfComment(commentId: string): Promise<string> {
  const c = await prisma.comment.findUnique({ where: { id: commentId }, select: { issue: { select: { projectId: true } } } });
  if (!c) throw new AppError('NOT_FOUND');
  return c.issue.projectId;
}

export async function addComment(actor: CommentActor, input: AddCommentInput, meta: RequestMeta): Promise<CommentDto> {
  const projectId = await projectOfIssue(input.issueId);
  return prisma.$transaction(async (tx) => {
    await lockProject(tx, projectId);
    // 잠금 사이에 이슈가 지워졌을 수 있다
    if (!(await tx.issue.findUnique({ where: { id: input.issueId }, select: { id: true } }))) throw new AppError('NOT_FOUND');
    await ensureWritableProject(tx, projectId);
    // 이슈 하나에 댓글이 끝없이 쌓이지 않게 한다(지운 것도 행이 남으므로 함께 센다). 같은 프로젝트 잠금 안이라 경쟁 없음
    if ((await tx.comment.count({ where: { issueId: input.issueId } })) >= COMMENTS_PER_ISSUE_MAX) {
      const message = `이슈 하나에는 댓글을 ${COMMENTS_PER_ISSUE_MAX.toLocaleString('ko-KR')}개까지 쓸 수 있습니다.`;
      throw new AppError('VALIDATION', 'comment_limit', message, { body: [message] });
    }
    // 고침 여부(edited)를 updatedAt ≠ createdAt 으로 판정하므로 두 값을 같은 시각으로 넣는다
    const now = new Date();
    const created = await tx.comment.create({
      data: { issueId: input.issueId, authorId: actor.id, body: input.body, createdAt: now, updatedAt: now },
      include: { author: { select: { name: true } } },
    });
    await writeAudit(tx, {
      actorId: actor.id,
      action: 'comment.create',
      entity: 'Comment',
      entityId: created.id,
      after: { issueId: input.issueId, body: input.body },
      meta,
    });
    return toCommentDto(created);
  }, SCHEDULE_TX);
}

/** 작성자만 고칠 수 있다. 지운 댓글은 없는 것으로 본다(NOT_FOUND). 동시에 고치면 마지막 저장이 남는다(작성자 한 사람뿐) */
export async function updateComment(actor: CommentActor, input: UpdateCommentInput, meta: RequestMeta): Promise<CommentDto> {
  const projectId = await projectOfComment(input.id);
  return prisma.$transaction(async (tx) => {
    await lockProject(tx, projectId);
    const row = await tx.comment.findUnique({ where: { id: input.id } });
    if (!row || row.deletedAt) throw new AppError('NOT_FOUND');
    if (row.authorId !== actor.id) throw new AppError('FORBIDDEN', 'not_author', '본인이 쓴 댓글만 고칠 수 있습니다.');
    await ensureWritableProject(tx, projectId);
    if (row.body === input.body) {
      return toCommentDto({ ...row, author: await tx.user.findUniqueOrThrow({ where: { id: row.authorId }, select: { name: true } }) });
    }
    const updated = await tx.comment.update({
      where: { id: row.id },
      data: { body: input.body },
      include: { author: { select: { name: true } } },
    });
    await writeAudit(tx, {
      actorId: actor.id,
      action: 'comment.update',
      entity: 'Comment',
      entityId: row.id,
      before: { body: row.body },
      after: { body: input.body },
      meta,
    });
    return toCommentDto(updated);
  }, SCHEDULE_TX);
}

/** 소프트 삭제(deletedAt). 작성자 본인 또는 ADMIN. 이미 지운 댓글은 NOT_FOUND */
export async function deleteComment(actor: CommentActor, input: DeleteCommentInput, meta: RequestMeta): Promise<CommentDto> {
  const projectId = await projectOfComment(input.id);
  return prisma.$transaction(async (tx) => {
    await lockProject(tx, projectId);
    const row = await tx.comment.findUnique({ where: { id: input.id } });
    if (!row || row.deletedAt) throw new AppError('NOT_FOUND');
    if (row.authorId !== actor.id && actor.role !== 'ADMIN') {
      throw new AppError('FORBIDDEN', 'not_author', '본인이 쓴 댓글만 지울 수 있습니다.');
    }
    await ensureWritableProject(tx, projectId);
    const updated = await tx.comment.update({
      where: { id: row.id },
      data: { deletedAt: new Date() },
      include: { author: { select: { name: true } } },
    });
    await writeAudit(tx, {
      actorId: actor.id,
      action: 'comment.delete',
      entity: 'Comment',
      entityId: row.id,
      before: { issueId: row.issueId, authorId: row.authorId, body: row.body },
      meta,
    });
    return toCommentDto(updated);
  }, SCHEDULE_TX);
}

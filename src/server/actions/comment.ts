'use server';

import type { CommentDto } from '@/lib/issue/dto';
import { addCommentSchema, deleteCommentSchema, updateCommentSchema } from '@/lib/validation/comment';
import { toActionResult, type ActionResult } from '../action-result';
import { requireRole } from '../auth/require-role';
import { getRequestMeta } from '../request-meta';
import * as comments from '../services/comment-service';

// 댓글은 VIEWER 도 쓸 수 있다(설계서 7.4). 본인 확인·ADMIN 예외는 서비스가 한다.

export async function addComment(input: unknown): Promise<ActionResult<CommentDto>> {
  return toActionResult(async () => {
    const actor = await requireRole('VIEWER');
    const data = addCommentSchema.parse(input);
    return comments.addComment(actor, data, await getRequestMeta());
  });
}

export async function updateComment(input: unknown): Promise<ActionResult<CommentDto>> {
  return toActionResult(async () => {
    const actor = await requireRole('VIEWER');
    const data = updateCommentSchema.parse(input);
    return comments.updateComment(actor, data, await getRequestMeta());
  });
}

export async function deleteComment(input: unknown): Promise<ActionResult<CommentDto>> {
  return toActionResult(async () => {
    const actor = await requireRole('VIEWER');
    const data = deleteCommentSchema.parse(input);
    return comments.deleteComment(actor, data, await getRequestMeta());
  });
}

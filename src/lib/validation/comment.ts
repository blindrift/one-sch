import { z } from 'zod';
import { COMMENT_MAX, UNSAFE_MEMO_RE, UNSAFE_TEXT_MESSAGE } from './limits';
import { id } from './schedule-common';

/** 댓글 본문: 마크다운(여러 줄). trim 뒤 1자 이상, 줄바꿈·탭 외의 제어 문자는 거부 */
const body = z
  .string()
  .trim()
  .min(1, '내용을 입력해 주세요.')
  .max(COMMENT_MAX, `댓글은 ${COMMENT_MAX.toLocaleString('ko-KR')}자 이하입니다.`)
  .refine((v) => !UNSAFE_MEMO_RE.test(v), UNSAFE_TEXT_MESSAGE);

export const addCommentSchema = z.object({ issueId: id('잘못된 이슈입니다.'), body });
export const updateCommentSchema = z.object({ id: id('잘못된 댓글입니다.'), body });
export const deleteCommentSchema = z.object({ id: id('잘못된 댓글입니다.') });

export type AddCommentInput = z.infer<typeof addCommentSchema>;
export type UpdateCommentInput = z.infer<typeof updateCommentSchema>;
export type DeleteCommentInput = z.infer<typeof deleteCommentSchema>;

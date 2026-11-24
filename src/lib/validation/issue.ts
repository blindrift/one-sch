import { z } from 'zod';
import { ISSUE_PRIORITIES, ISSUE_STATUSES, ISSUE_TYPES } from '../issue/status';
import { ISSUE_DESC_MAX, TITLE_MAX, UNSAFE_MEMO_RE, UNSAFE_TEXT_MESSAGE, UNSAFE_TEXT_RE } from './limits';
import { id, nullableId, nullableYmd, version } from './schedule-common';

const title = z
  .string()
  .trim()
  .min(1, '제목을 입력해 주세요.')
  .max(TITLE_MAX, `제목은 ${TITLE_MAX}자 이하입니다.`)
  .refine((v) => !UNSAFE_TEXT_RE.test(v), UNSAFE_TEXT_MESSAGE);
/** 설명: 마크다운(여러 줄). trim 뒤 빈 문자열 허용(DB 기본값 ''). 줄바꿈·탭 외의 제어 문자는 거부 */
const description = z
  .string()
  .trim()
  .max(ISSUE_DESC_MAX, `설명은 ${ISSUE_DESC_MAX.toLocaleString('ko-KR')}자 이하입니다.`)
  .refine((v) => !UNSAFE_MEMO_RE.test(v), UNSAFE_TEXT_MESSAGE);
const type = z.enum(ISSUE_TYPES);
const status = z.enum(ISSUE_STATUSES);
const priority = z.enum(ISSUE_PRIORITIES);

export const createIssueSchema = z.object({
  projectId: id('잘못된 프로젝트입니다.'),
  title,
  description: description.default(''),
  type: type.default('ISSUE'),
  status: status.default('OPEN'),
  priority: priority.default('MEDIUM'),
  assigneeId: nullableId('잘못된 담당자입니다.').optional(),
  taskId: nullableId('잘못된 작업입니다.').optional(),
  dueDate: nullableYmd.optional(),
});

/** 폼 편집과 보드 이동 공용. 바꿀 필드만 보낸다. projectId·number·reporterId 는 바꿀 수 없다(스키마에 없어 버려진다). */
export const updateIssueSchema = z.object({
  id: id('잘못된 이슈입니다.'),
  version,
  title: title.optional(),
  description: description.optional(),
  type: type.optional(),
  status: status.optional(),
  priority: priority.optional(),
  assigneeId: nullableId('잘못된 담당자입니다.').optional(),
  taskId: nullableId('잘못된 작업입니다.').optional(),
  dueDate: nullableYmd.optional(),
});

export const deleteIssueSchema = z.object({ id: id('잘못된 이슈입니다.'), version });

export type CreateIssueInput = z.infer<typeof createIssueSchema>;
export type UpdateIssueInput = z.infer<typeof updateIssueSchema>;
export type DeleteIssueInput = z.infer<typeof deleteIssueSchema>;

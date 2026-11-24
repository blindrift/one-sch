import { z } from 'zod';
import { TASK_STATUSES } from '../schedule/status';
import {
  isHttpUrl,
  TASK_MEMO_MAX,
  TASK_URL_MAX,
  TITLE_MAX,
  UNSAFE_MEMO_RE,
  UNSAFE_TEXT_MESSAGE,
  UNSAFE_TEXT_RE,
} from './limits';
import { checkDateOrder, id, nullableId, version, ymd } from './schedule-common';

const title = z
  .string()
  .trim()
  .min(1, '제목을 입력해 주세요.')
  .max(TITLE_MAX, `제목은 ${TITLE_MAX}자 이하입니다.`)
  .refine((v) => !UNSAFE_TEXT_RE.test(v), UNSAFE_TEXT_MESSAGE);
/** 관련 링크: trim 뒤 빈 문자열·null 은 null, http/https 만 허용(javascript:·data: 등 거부) */
const url = z
  .string()
  .trim()
  .max(TASK_URL_MAX, `링크는 ${TASK_URL_MAX}자 이하입니다.`)
  .refine((v) => !UNSAFE_TEXT_RE.test(v), UNSAFE_TEXT_MESSAGE)
  .refine((v) => v === '' || isHttpUrl(v), 'http:// 또는 https:// 로 시작하는 주소만 쓸 수 있습니다.')
  .transform((v) => v || null)
  .nullable();
/** 메모: 여러 줄 평문. trim 뒤 빈 문자열·null 은 null. 줄바꿈·탭 외의 제어 문자는 거부 */
const memo = z
  .string()
  .trim()
  .max(TASK_MEMO_MAX, `메모는 ${TASK_MEMO_MAX}자 이하입니다.`)
  .refine((v) => !UNSAFE_MEMO_RE.test(v), UNSAFE_TEXT_MESSAGE)
  .transform((v) => v || null)
  .nullable();
const progress = z.number().int('진행률은 정수입니다.').min(0).max(100);
const status = z.enum(TASK_STATUSES);

function checkMilestone(ctx: z.RefinementCtx, isMilestone: boolean | undefined, start?: string, end?: string) {
  if (isMilestone && start && end && start !== end) {
    ctx.addIssue({ code: 'custom', path: ['endDate'], message: '마일스톤은 시작일과 종료일이 같아야 합니다.' });
  }
}

export const createTaskSchema = z
  .object({
    projectId: id('잘못된 프로젝트입니다.'),
    parentId: nullableId('잘못된 상위 작업입니다.').optional(),
    title,
    startDate: ymd,
    endDate: ymd,
    progress: progress.default(0),
    status: status.default('TODO'),
    assigneeId: nullableId('잘못된 담당자입니다.').optional(),
    isMilestone: z.boolean().default(false),
    url: url.optional(),
    memo: memo.optional(),
  })
  .superRefine((v, ctx) => {
    checkDateOrder(ctx, v.startDate, v.endDate);
    checkMilestone(ctx, v.isMilestone, v.startDate, v.endDate);
  });

/**
 * 폼 편집과 드래그 공용. 바꿀 필드만 보낸다. projectId 는 바꿀 수 없다(스키마에 없어 버려진다).
 * 날짜 순서·마일스톤 규칙은 기존 값과 합친 결과로 서비스가 다시 검사한다.
 */
export const updateTaskSchema = z
  .object({
    id: id('잘못된 작업입니다.'),
    version,
    title: title.optional(),
    startDate: ymd.optional(),
    endDate: ymd.optional(),
    progress: progress.optional(),
    status: status.optional(),
    assigneeId: nullableId('잘못된 담당자입니다.').optional(),
    isMilestone: z.boolean().optional(),
    parentId: nullableId('잘못된 상위 작업입니다.').optional(),
    url: url.optional(),
    memo: memo.optional(),
  })
  .superRefine((v, ctx) => {
    checkDateOrder(ctx, v.startDate, v.endDate);
    checkMilestone(ctx, v.isMilestone, v.startDate, v.endDate);
  });

export const deleteTaskSchema = z.object({ id: id('잘못된 작업입니다.'), version });

/** 형제 순서 바꾸기(D17): 기준 형제 앞(beforeId) 또는 뒤(afterId) 중 하나만 */
export const reorderTaskSchema = z
  .object({
    id: id('잘못된 작업입니다.'),
    version,
    beforeId: id('잘못된 기준 작업입니다.').optional(),
    afterId: id('잘못된 기준 작업입니다.').optional(),
  })
  .refine((v) => (v.beforeId === undefined) !== (v.afterId === undefined), { path: ['beforeId'], message: '기준 작업을 하나만 지정해 주세요.' })
  .refine((v) => v.beforeId !== v.id && v.afterId !== v.id, { path: ['beforeId'], message: '자기 자신을 기준으로 옮길 수 없습니다.' });

export const addDependencySchema = z
  .object({ fromTaskId: id('잘못된 작업입니다.'), toTaskId: id('잘못된 작업입니다.') })
  .refine((v) => v.fromTaskId !== v.toTaskId, { path: ['toTaskId'], message: '자기 자신에 의존할 수 없습니다.' });

export const removeDependencySchema = z.object({ id: id('잘못된 의존 관계입니다.') });

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type DeleteTaskInput = z.infer<typeof deleteTaskSchema>;
export type ReorderTaskInput = z.infer<typeof reorderTaskSchema>;
export type AddDependencyInput = z.infer<typeof addDependencySchema>;

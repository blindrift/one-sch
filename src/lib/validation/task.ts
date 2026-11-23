import { z } from 'zod';
import { TASK_STATUSES } from '../schedule/status';
import { TITLE_MAX, UNSAFE_TEXT_MESSAGE, UNSAFE_TEXT_RE } from './limits';
import { checkDateOrder, id, nullableId, version, ymd } from './schedule-common';

const title = z
  .string()
  .trim()
  .min(1, '제목을 입력해 주세요.')
  .max(TITLE_MAX, `제목은 ${TITLE_MAX}자 이하입니다.`)
  .refine((v) => !UNSAFE_TEXT_RE.test(v), UNSAFE_TEXT_MESSAGE);
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
  })
  .superRefine((v, ctx) => {
    checkDateOrder(ctx, v.startDate, v.endDate);
    checkMilestone(ctx, v.isMilestone, v.startDate, v.endDate);
  });

export const deleteTaskSchema = z.object({ id: id('잘못된 작업입니다.'), version });

export const addDependencySchema = z
  .object({ fromTaskId: id('잘못된 작업입니다.'), toTaskId: id('잘못된 작업입니다.') })
  .refine((v) => v.fromTaskId !== v.toTaskId, { path: ['toTaskId'], message: '자기 자신에 의존할 수 없습니다.' });

export const removeDependencySchema = z.object({ id: id('잘못된 의존 관계입니다.') });

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type DeleteTaskInput = z.infer<typeof deleteTaskSchema>;
export type AddDependencyInput = z.infer<typeof addDependencySchema>;

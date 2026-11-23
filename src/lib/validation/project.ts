import { z } from 'zod';
import { PROJECT_STATUSES } from '../schedule/status';
import { COLOR_RE, PROJECT_KEY_RE, PROJECT_NAME_MAX, UNSAFE_TEXT_MESSAGE, UNSAFE_TEXT_RE } from './limits';
import { checkDateOrder, id, nullableId, nullableYmd, version } from './schedule-common';

const name = z
  .string()
  .trim()
  .min(1, '이름을 입력해 주세요.')
  .max(PROJECT_NAME_MAX, `이름은 ${PROJECT_NAME_MAX}자 이하입니다.`)
  .refine((v) => !UNSAFE_TEXT_RE.test(v), UNSAFE_TEXT_MESSAGE);
const color = z.string().trim().regex(COLOR_RE, '색은 #RRGGBB 형식이어야 합니다.').toLowerCase();
const status = z.enum(PROJECT_STATUSES);

export const createProjectSchema = z
  .object({
    key: z
      .string()
      .trim()
      .toUpperCase()
      .regex(PROJECT_KEY_RE, '키는 영문 대문자로 시작하는 영문·숫자 2–10자입니다.'),
    name,
    color,
    status: status.default('PLANNED'),
    startDate: nullableYmd.optional(),
    endDate: nullableYmd.optional(),
    /** 없으면 요청자 */
    ownerId: nullableId('잘못된 책임자입니다.').optional(),
  })
  .superRefine((v, ctx) => checkDateOrder(ctx, v.startDate, v.endDate));

/** 키는 바꿀 수 없다(D3). 스키마에 없는 필드(key 등)는 버려진다. */
export const updateProjectSchema = z
  .object({
    id: id('잘못된 프로젝트입니다.'),
    version,
    name: name.optional(),
    color: color.optional(),
    status: status.optional(),
    startDate: nullableYmd.optional(),
    endDate: nullableYmd.optional(),
    ownerId: id('잘못된 책임자입니다.').optional(),
  })
  .superRefine((v, ctx) => checkDateOrder(ctx, v.startDate, v.endDate));

export const setProjectArchivedSchema = z.object({
  id: id('잘못된 프로젝트입니다.'),
  version,
  archived: z.boolean(),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type SetProjectArchivedInput = z.infer<typeof setProjectArchivedSchema>;

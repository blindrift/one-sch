import { z } from 'zod';
import { ROLES } from '../roles';
import { EMAIL_MAX, NAME_MAX } from './limits';

const userId = z.uuid('잘못된 사용자입니다.');

// 사용자 등록은 구글 계정(이메일)만 받는다. 로컬 계정은 시드한 admin 하나뿐이다.
export const createUserSchema = z.object({
  email: z.string().trim().toLowerCase().max(EMAIL_MAX).pipe(z.email('이메일 형식이 아닙니다.')),
  name: z.string().trim().min(1, '이름을 입력해 주세요.').max(NAME_MAX),
  role: z.enum(ROLES),
});

export const updateUserRoleSchema = z.object({ userId, role: z.enum(ROLES) });
export const setUserActiveSchema = z.object({ userId, active: z.boolean() });
export const userTargetSchema = z.object({ userId });

export type CreateUserInput = z.infer<typeof createUserSchema>;

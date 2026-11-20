import { z } from 'zod';
import { PASSWORD_MAX } from './limits';

export const loginSchema = z.object({
  username: z.string().trim().min(1).max(64).toLowerCase(),
  password: z.string().min(1).max(PASSWORD_MAX),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, '현재 비밀번호를 입력해 주세요.').max(PASSWORD_MAX),
    newPassword: z.string().min(1, '새 비밀번호를 입력해 주세요.').max(PASSWORD_MAX, `${PASSWORD_MAX}자 이하여야 합니다.`),
    confirmPassword: z.string().max(PASSWORD_MAX),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ['confirmPassword'],
    message: '새 비밀번호와 확인이 다릅니다.',
  });

const DEFAULT_CALLBACK = '/timeline';

/** 같은 사이트 안의 경로만 허용한다(오픈 리디렉션 방지). */
export function safeCallbackUrl(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 512) return DEFAULT_CALLBACK;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return DEFAULT_CALLBACK;
  // 제어 문자·역슬래시는 브라우저가 경로를 다르게 해석할 수 있어 거부한다.
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return DEFAULT_CALLBACK;
  if (raw === '/login' || raw.startsWith('/login?') || raw.startsWith('/api/')) return DEFAULT_CALLBACK;
  return raw;
}

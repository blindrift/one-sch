'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { changePasswordSchema, loginSchema, safeCallbackUrl } from '@/lib/validation/auth';
import { AppError, toActionResult, type ActionResult } from '../action-result';
import { sessionCookie } from '../auth/cookies';
import { signIn, signOut } from '../auth/config';
import { requireRole } from '../auth/require-role';
import { getRequestMeta } from '../request-meta';
import { changeOwnPassword, passwordLogin } from '../services/auth-service';

const INVALID_CREDENTIALS = '아이디 또는 비밀번호가 올바르지 않습니다.';

/** PUBLIC: 로컬(admin) 로그인. 성공하면 세션 쿠키를 설정하고 이동한다. */
export async function loginWithPassword(_prev: unknown, formData: FormData): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    if (process.env.LOCAL_LOGIN_ENABLED !== 'true') {
      throw new AppError('FORBIDDEN', 'LOCAL_LOGIN_DISABLED', '로컬 로그인이 비활성화되어 있습니다.');
    }
    const parsed = loginSchema.safeParse({ username: formData.get('username'), password: formData.get('password') });
    if (!parsed.success) throw new AppError('UNAUTHENTICATED', 'invalid_input', INVALID_CREDENTIALS);

    const cookie = sessionCookie();
    const jar = await cookies();
    const result = await passwordLogin({
      ...parsed.data,
      meta: await getRequestMeta(),
      currentRawToken: jar.get(cookie.name)?.value ?? null,
    });
    if (!result.ok) {
      if (result.reason === 'rate_limited') throw new AppError('RATE_LIMITED');
      throw new AppError('UNAUTHENTICATED', result.reason, INVALID_CREDENTIALS);
    }

    jar.set(cookie.name, result.rawToken, { ...cookie.options, expires: result.expires });
    redirect(result.mustChangePassword ? '/change-password' : safeCallbackUrl(formData.get('callbackUrl')));
  });
}

/** 로그인 사용자 본인의 비밀번호 변경. 강제 변경 상태에서도 허용한다. */
export async function changePassword(_prev: unknown, formData: FormData): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const user = await requireRole('VIEWER', { allowPasswordChange: true });
    const input = changePasswordSchema.parse({
      currentPassword: formData.get('currentPassword'),
      newPassword: formData.get('newPassword'),
      confirmPassword: formData.get('confirmPassword'),
    });
    const result = await changeOwnPassword({
      userId: user.id,
      sessionId: user.sessionId,
      currentPassword: input.currentPassword,
      newPassword: input.newPassword,
      meta: await getRequestMeta(),
    });
    if (!result.ok) {
      switch (result.reason) {
        case 'rate_limited':
          throw new AppError('RATE_LIMITED');
        case 'no_password':
          throw new AppError('FORBIDDEN', 'no_password', '비밀번호가 없는 계정입니다(구글 로그인 사용).');
        case 'invalid_current':
          throw new AppError('VALIDATION', 'invalid_current', '현재 비밀번호가 올바르지 않습니다.', {
            currentPassword: ['현재 비밀번호가 올바르지 않습니다.'],
          });
        case 'policy':
          throw new AppError('VALIDATION', 'policy', '비밀번호 정책을 확인해 주세요.', { newPassword: result.errors });
      }
    }
    redirect('/timeline');
  });
}

/** PUBLIC: 로그아웃. 세션이 없어도 쿠키만 지우고 로그인 화면으로 간다. */
export async function logout(): Promise<void> {
  await signOut({ redirectTo: '/login' });
}

/** PUBLIC: 구글 로그인 시작. 허용 여부는 Auth.js signIn 콜백(googleSignInGuard)이 판단한다. */
export async function signInWithGoogle(formData: FormData): Promise<void> {
  await signIn('google', { redirectTo: safeCallbackUrl(formData.get('callbackUrl')) });
}

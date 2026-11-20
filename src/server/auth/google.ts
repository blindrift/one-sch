import 'server-only';

type MinimalUser = { id: string; active: boolean } | null;

export type GoogleGuardDeps = {
  findUserByEmail: (email: string) => Promise<MinimalUser>;
  recordDenied: (info: { email: string | null; reason: string }) => Promise<void>;
};

export type GuardAccount = { provider?: string | null } | null | undefined;
export type GuardProfile = { email?: unknown; email_verified?: unknown } | null | undefined;

/**
 * Auth.js signIn 콜백. 사용자 생성·계정 연결보다 먼저 실행된다.
 * 등록·활성 사용자이고 구글이 이메일을 확인한 경우만 허용한다(자동 가입 없음).
 */
export function createGoogleSignInGuard(deps: GoogleGuardDeps) {
  return async function googleSignInGuard(account: GuardAccount, profile: GuardProfile): Promise<boolean> {
    const rawEmail = typeof profile?.email === 'string' ? profile.email : null;
    const email = rawEmail ? rawEmail.trim().toLowerCase() : null;
    const deny = async (reason: string) => {
      await deps.recordDenied({ email, reason });
      return false;
    };

    if (account?.provider !== 'google') return deny('provider');
    if (!email) return deny('no_email');
    if (profile?.email_verified !== true) return deny('email_unverified');
    const user = await deps.findUserByEmail(email);
    if (!user) return deny('not_registered');
    if (!user.active) return deny('inactive');
    return true;
  };
}

/** id_token(JWT) 의 email 클레임. Auth.js 가 구글 토큰 엔드포인트와 직접 교환해 받은 값에만 쓴다. */
export function emailFromIdToken(idToken: unknown): string | null {
  if (typeof idToken !== 'string') return null;
  const payload = idToken.split('.')[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { email?: unknown };
    return typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : null;
  } catch {
    return null;
  }
}

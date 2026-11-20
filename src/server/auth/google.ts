import 'server-only';

type MinimalUser = { id: string; active: boolean } | null;
type LinkedUser = { id: string; active: boolean; email: string | null } | null;

export type GoogleGuardDeps = {
  findUserByEmail: (email: string) => Promise<MinimalUser>;
  /** 이 구글 계정(sub)에 이미 연결된 사용자. Auth.js 는 연결돼 있으면 이메일이 아니라 이 사용자로 세션을 만든다. */
  findUserByAccount: (provider: string, providerAccountId: string) => Promise<LinkedUser>;
  recordDenied: (info: { email: string | null; reason: string }) => Promise<void>;
};

export type GuardAccount = { provider?: string | null; providerAccountId?: string | null } | null | undefined;
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
    // 이미 연결된 계정이 있으면 그 사용자로 로그인되므로, 그 사용자도 같은 이메일·활성이어야 한다.
    // (등록 이메일이 바뀌었거나 퇴사자 주소를 다른 사람이 받은 경우 다른 사용자로 로그인되는 것을 막는다)
    if (account.providerAccountId) {
      const linked = await deps.findUserByAccount(account.provider, account.providerAccountId);
      if (linked) {
        if (linked.id !== user.id || linked.email !== email) return deny('account_email_mismatch');
        if (!linked.active) return deny('inactive');
      }
    }
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

import 'server-only';

export type Approval = 'PENDING' | 'APPROVED' | 'REJECTED';
type MinimalUser = { id: string; active: boolean; approval: Approval } | null;
type LinkedUser = { id: string; active: boolean; email: string | null } | null;

export type GoogleGuardDeps = {
  findUserByEmail: (email: string) => Promise<MinimalUser>;
  /** 이 구글 계정(sub)에 이미 연결된 사용자. Auth.js 는 연결돼 있으면 이메일이 아니라 이 사용자로 세션을 만든다. */
  findUserByAccount: (provider: string, providerAccountId: string) => Promise<LinkedUser>;
  recordDenied: (info: { email: string | null; reason: string }) => Promise<void>;
  /** 미등록 이메일의 가입 신청(PENDING, 비활성)을 만든다. 동시에 만들어졌으면 이미 있는 행의 상태를 돌려준다. */
  requestSignup: (info: { email: string; name: string; image: string | null }) => Promise<Approval>;
};

/** 로그인 화면이 안내 문구를 고르는 error 값. signIn 콜백이 이 주소를 돌려주면 Auth.js 가 그리로 보낸다(세션 없음). */
export const SIGNUP_PENDING_URL = '/login?error=pending';
export const SIGNUP_REJECTED_URL = '/login?error=rejected';

export type GuardAccount = { provider?: string | null; providerAccountId?: string | null } | null | undefined;
export type GuardProfile = { email?: unknown; email_verified?: unknown; name?: unknown; picture?: unknown } | null | undefined;

function signupName(profile: GuardProfile, email: string): string {
  const raw = typeof profile?.name === 'string' ? profile.name.trim() : '';
  return (raw || email.split('@')[0] || email).slice(0, 100);
}

/**
 * Auth.js signIn 콜백. 사용자 생성·계정 연결보다 먼저 실행된다.
 * 승인·활성 사용자이고 구글이 이메일을 확인한 경우만 허용한다.
 * 미등록 이메일은 가입 신청(PENDING)을 만들고 승인 대기 안내로 보낸다. 승인 대기·거부 계정도 안내로 보낸다.
 */
export function createGoogleSignInGuard(deps: GoogleGuardDeps) {
  return async function googleSignInGuard(account: GuardAccount, profile: GuardProfile): Promise<boolean | string> {
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
    if (!user) {
      const approval = await deps.requestSignup({ email, name: signupName(profile, email), image: typeof profile?.picture === 'string' ? profile.picture : null });
      await deps.recordDenied({ email, reason: approval === 'REJECTED' ? 'rejected' : 'pending' });
      if (approval === 'APPROVED') return false; // 동시에 관리자가 등록한 경우 — 다시 로그인하면 된다
      return approval === 'REJECTED' ? SIGNUP_REJECTED_URL : SIGNUP_PENDING_URL;
    }
    if (user.approval === 'PENDING') {
      await deps.recordDenied({ email, reason: 'pending' });
      return SIGNUP_PENDING_URL;
    }
    if (user.approval === 'REJECTED') {
      await deps.recordDenied({ email, reason: 'rejected' });
      return SIGNUP_REJECTED_URL;
    }
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

import { describe, expect, it, vi } from 'vitest';
import {
  createGoogleSignInGuard,
  emailFromIdToken,
  SIGNUP_PENDING_URL,
  SIGNUP_REJECTED_URL,
  type Approval,
} from '@/server/auth/google';

type Linked = { id: string; active: boolean; email: string | null };

type U = { id: string; active: boolean; approval?: Approval };

function setup(users: Record<string, U>, linked: Record<string, Linked> = {}, signupResult: Approval = 'PENDING') {
  const findUserByEmail = vi.fn(async (email: string) => {
    const u = users[email];
    return u ? { approval: 'APPROVED' as Approval, ...u } : null;
  });
  const requestSignup = vi.fn<(info: { email: string; name: string; image: string | null }) => Promise<Approval>>(async () => signupResult);
  const findUserByAccount = vi.fn(async (_provider: string, sub: string) => linked[sub] ?? null);
  const recordDenied = vi.fn(async () => {});
  return {
    guard: createGoogleSignInGuard({ findUserByEmail, findUserByAccount, recordDenied, requestSignup }),
    findUserByEmail,
    requestSignup,
    findUserByAccount,
    recordDenied,
  };
}

const google = { provider: 'google' };

describe('googleSignInGuard', () => {
  it('등록·활성·이메일 확인 사용자는 허용', async () => {
    const { guard, recordDenied } = setup({ 'a@example.com': { id: '1', active: true } });
    expect(await guard(google, { email: 'a@example.com', email_verified: true })).toBe(true);
    expect(recordDenied).not.toHaveBeenCalled();
  });

  it('미등록은 가입 신청(PENDING)을 만들고 승인 대기 안내로 보낸다', async () => {
    const { guard, recordDenied, requestSignup } = setup({});
    expect(
      await guard(google, { email: 'X@example.com', email_verified: true, name: ' 홍길동 ', picture: 'https://img/p.png' }),
    ).toBe(SIGNUP_PENDING_URL);
    expect(requestSignup).toHaveBeenCalledWith({ email: 'x@example.com', name: '홍길동', image: 'https://img/p.png' });
    expect(recordDenied).toHaveBeenCalledWith({ email: 'x@example.com', reason: 'pending' });
  });

  it('가입 신청 이름이 없으면 이메일 앞부분', async () => {
    const { guard, requestSignup } = setup({});
    await guard(google, { email: 'kim@example.com', email_verified: true });
    expect(requestSignup).toHaveBeenCalledWith({ email: 'kim@example.com', name: 'kim', image: null });
  });

  it('동시 신청으로 이미 거부·승인된 행이면 그 상태를 따른다', async () => {
    expect(await setup({}, {}, 'REJECTED').guard(google, { email: 'x@example.com', email_verified: true })).toBe(SIGNUP_REJECTED_URL);
    expect(await setup({}, {}, 'APPROVED').guard(google, { email: 'x@example.com', email_verified: true })).toBe(false);
  });

  it('승인 대기·거부 계정은 새 신청 없이 안내로 보낸다', async () => {
    const p = setup({ 'p@example.com': { id: '1', active: false, approval: 'PENDING' } });
    expect(await p.guard(google, { email: 'p@example.com', email_verified: true })).toBe(SIGNUP_PENDING_URL);
    expect(p.requestSignup).not.toHaveBeenCalled();
    const r = setup({ 'r@example.com': { id: '2', active: false, approval: 'REJECTED' } });
    expect(await r.guard(google, { email: 'r@example.com', email_verified: true })).toBe(SIGNUP_REJECTED_URL);
    expect(r.requestSignup).not.toHaveBeenCalled();
    expect(r.recordDenied).toHaveBeenCalledWith({ email: 'r@example.com', reason: 'rejected' });
  });

  it('email_verified 가 아니면 가입 신청도 만들지 않는다', async () => {
    const { guard, requestSignup } = setup({});
    expect(await guard(google, { email: 'x@example.com', email_verified: false })).toBe(false);
    expect(requestSignup).not.toHaveBeenCalled();
  });

  it('비활성은 거부', async () => {
    const { guard, recordDenied } = setup({ 'a@example.com': { id: '1', active: false } });
    expect(await guard(google, { email: 'a@example.com', email_verified: true })).toBe(false);
    expect(recordDenied).toHaveBeenCalledWith({ email: 'a@example.com', reason: 'inactive' });
  });

  it('email_verified 가 true 가 아니면 거부(문자열 "true" 포함)', async () => {
    const { guard, findUserByEmail } = setup({ 'a@example.com': { id: '1', active: true } });
    expect(await guard(google, { email: 'a@example.com', email_verified: false })).toBe(false);
    expect(await guard(google, { email: 'a@example.com', email_verified: 'true' })).toBe(false);
    expect(await guard(google, { email: 'a@example.com' })).toBe(false);
    expect(findUserByEmail).not.toHaveBeenCalled();
  });

  it('대문자·공백 이메일을 소문자로 정규화해 조회', async () => {
    const { guard, findUserByEmail } = setup({ 'a@example.com': { id: '1', active: true } });
    expect(await guard(google, { email: ' A@Example.COM ', email_verified: true })).toBe(true);
    expect(findUserByEmail).toHaveBeenCalledWith('a@example.com');
  });

  it('provider 가 google 이 아니면 거부', async () => {
    const { guard, recordDenied } = setup({ 'a@example.com': { id: '1', active: true } });
    expect(await guard({ provider: 'github' }, { email: 'a@example.com', email_verified: true })).toBe(false);
    expect(await guard(null, { email: 'a@example.com', email_verified: true })).toBe(false);
    expect(recordDenied).toHaveBeenCalledWith({ email: 'a@example.com', reason: 'provider' });
  });

  it('이미 연결된 계정(sub)의 사용자도 같은 이메일·활성일 때만 허용(SEC-4)', async () => {
    const users = { 'a@example.com': { id: '1', active: true } };
    const ok = setup(users, { 'sub-1': { id: '1', active: true, email: 'a@example.com' } });
    expect(await ok.guard({ provider: 'google', providerAccountId: 'sub-1' }, { email: 'a@example.com', email_verified: true })).toBe(true);
    expect(ok.findUserByAccount).toHaveBeenCalledWith('google', 'sub-1');

    // 등록 이메일이 바뀌어 sub 가 다른 사용자에 붙어 있는 경우
    const moved = setup(users, { 'sub-1': { id: '2', active: true, email: 'old@example.com' } });
    expect(await moved.guard({ provider: 'google', providerAccountId: 'sub-1' }, { email: 'a@example.com', email_verified: true })).toBe(false);
    expect(moved.recordDenied).toHaveBeenCalledWith({ email: 'a@example.com', reason: 'account_email_mismatch' });

    // 같은 사용자지만 DB 이메일이 다른 경우
    const changed = setup(users, { 'sub-1': { id: '1', active: true, email: 'b@example.com' } });
    expect(await changed.guard({ provider: 'google', providerAccountId: 'sub-1' }, { email: 'a@example.com', email_verified: true })).toBe(false);

    // 연결된 사용자가 비활성
    const inactive = setup(users, { 'sub-1': { id: '1', active: false, email: 'a@example.com' } });
    expect(await inactive.guard({ provider: 'google', providerAccountId: 'sub-1' }, { email: 'a@example.com', email_verified: true })).toBe(false);
  });

  it('연결된 계정이 없으면(첫 로그인) 이메일 기준으로 허용', async () => {
    const { guard, findUserByAccount } = setup({ 'a@example.com': { id: '1', active: true } });
    expect(await guard({ provider: 'google', providerAccountId: 'new-sub' }, { email: 'a@example.com', email_verified: true })).toBe(true);
    expect(findUserByAccount).toHaveBeenCalledTimes(1);
  });

  it('이메일 없으면 거부', async () => {
    const { guard } = setup({});
    expect(await guard(google, { email_verified: true })).toBe(false);
    expect(await guard(google, null)).toBe(false);
  });
});

describe('emailFromIdToken', () => {
  const token = (claims: object) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;

  it('email 클레임을 소문자로', () => {
    expect(emailFromIdToken(token({ email: 'A@Example.com' }))).toBe('a@example.com');
  });

  it('없거나 깨졌으면 null', () => {
    expect(emailFromIdToken(undefined)).toBeNull();
    expect(emailFromIdToken('abc')).toBeNull();
    expect(emailFromIdToken('a.!!!.c')).toBeNull();
    expect(emailFromIdToken(token({ sub: '1' }))).toBeNull();
  });
});

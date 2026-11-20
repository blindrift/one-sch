import { describe, expect, it, vi } from 'vitest';
import { createGoogleSignInGuard, emailFromIdToken } from '@/server/auth/google';

type Linked = { id: string; active: boolean; email: string | null };

function setup(users: Record<string, { id: string; active: boolean }>, linked: Record<string, Linked> = {}) {
  const findUserByEmail = vi.fn(async (email: string) => users[email] ?? null);
  const findUserByAccount = vi.fn(async (_provider: string, sub: string) => linked[sub] ?? null);
  const recordDenied = vi.fn(async () => {});
  return {
    guard: createGoogleSignInGuard({ findUserByEmail, findUserByAccount, recordDenied }),
    findUserByEmail,
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

  it('미등록은 거부하고 감사 기록', async () => {
    const { guard, recordDenied } = setup({});
    expect(await guard(google, { email: 'x@example.com', email_verified: true })).toBe(false);
    expect(recordDenied).toHaveBeenCalledWith({ email: 'x@example.com', reason: 'not_registered' });
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

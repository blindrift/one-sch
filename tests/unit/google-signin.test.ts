import { describe, expect, it, vi } from 'vitest';
import { createGoogleSignInGuard, emailFromIdToken } from '@/server/auth/google';

function setup(users: Record<string, { id: string; active: boolean }>) {
  const findUserByEmail = vi.fn(async (email: string) => users[email] ?? null);
  const recordDenied = vi.fn(async () => {});
  return { guard: createGoogleSignInGuard({ findUserByEmail, recordDenied }), findUserByEmail, recordDenied };
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

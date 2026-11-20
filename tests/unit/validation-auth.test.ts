import { describe, expect, it } from 'vitest';
import { changePasswordSchema, loginSchema, safeCallbackUrl } from '@/lib/validation/auth';

describe('safeCallbackUrl', () => {
  it('내부 경로는 허용', () => {
    expect(safeCallbackUrl('/timeline')).toBe('/timeline');
    expect(safeCallbackUrl('/admin/users?x=1')).toBe('/admin/users?x=1');
  });

  it('외부·프로토콜 상대·역슬래시·제어 문자는 거부', () => {
    for (const bad of ['//evil.com', 'https://evil.com', '/\\evil.com', '/\\/evil', 'evil', '/a\nb', '/a\\b', 'javascript:alert(1)']) {
      expect(safeCallbackUrl(bad)).toBe('/timeline');
    }
  });

  it('로그인 화면·API·비문자열·너무 긴 값은 기본값', () => {
    expect(safeCallbackUrl('/login')).toBe('/timeline');
    expect(safeCallbackUrl('/login?callbackUrl=/x')).toBe('/timeline');
    expect(safeCallbackUrl('/api/auth/signout')).toBe('/timeline');
    expect(safeCallbackUrl(null)).toBe('/timeline');
    expect(safeCallbackUrl('/' + 'a'.repeat(600))).toBe('/timeline');
  });
});

describe('loginSchema', () => {
  it('아이디를 소문자·trim', () => {
    expect(loginSchema.parse({ username: ' Admin ', password: 'x' }).username).toBe('admin');
  });

  it('길이 제한', () => {
    expect(loginSchema.safeParse({ username: '', password: 'x' }).success).toBe(false);
    expect(loginSchema.safeParse({ username: 'a'.repeat(65), password: 'x' }).success).toBe(false);
    expect(loginSchema.safeParse({ username: 'a', password: 'x'.repeat(129) }).success).toBe(false);
    expect(loginSchema.safeParse({ username: 'a', password: null }).success).toBe(false);
  });
});

describe('changePasswordSchema', () => {
  it('확인 불일치 거부', () => {
    const r = changePasswordSchema.safeParse({ currentPassword: 'a', newPassword: 'b'.repeat(12), confirmPassword: 'c' });
    expect(r.success).toBe(false);
  });

  it('새 비밀번호 128자 초과 거부', () => {
    const p = 'b'.repeat(129);
    expect(changePasswordSchema.safeParse({ currentPassword: 'a', newPassword: p, confirmPassword: p }).success).toBe(false);
  });
});

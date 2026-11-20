import { describe, expect, it } from 'vitest';
import { createUserSchema, setUserActiveSchema, updateUserRoleSchema } from '@/lib/validation/user';

describe('createUserSchema', () => {
  it('이메일을 소문자·trim, 이름 trim', () => {
    expect(createUserSchema.parse({ email: ' A@Example.com ', name: ' 홍길동 ', role: 'MEMBER' })).toEqual({
      email: 'a@example.com',
      name: '홍길동',
      role: 'MEMBER',
    });
  });

  it('잘못된 이메일·빈 이름·긴 이름·없는 역할 거부', () => {
    expect(createUserSchema.safeParse({ email: 'nope', name: 'a', role: 'VIEWER' }).success).toBe(false);
    expect(createUserSchema.safeParse({ email: 'a@b.co', name: '  ', role: 'VIEWER' }).success).toBe(false);
    expect(createUserSchema.safeParse({ email: 'a@b.co', name: 'x'.repeat(101), role: 'VIEWER' }).success).toBe(false);
    expect(createUserSchema.safeParse({ email: 'a@b.co', name: 'a', role: 'ROOT' }).success).toBe(false);
    expect(createUserSchema.safeParse({ email: `${'a'.repeat(250)}@b.co`, name: 'a', role: 'VIEWER' }).success).toBe(false);
  });
});

describe('user target schemas', () => {
  const id = '3f1c2b9e-8d4a-4c3b-9a2e-1f0e5d6c7b8a';
  it('uuid 만 허용', () => {
    expect(updateUserRoleSchema.safeParse({ userId: id, role: 'ADMIN' }).success).toBe(true);
    expect(updateUserRoleSchema.safeParse({ userId: 'x', role: 'ADMIN' }).success).toBe(false);
  });

  it('active 는 boolean 만', () => {
    expect(setUserActiveSchema.safeParse({ userId: id, active: 'false' }).success).toBe(false);
    expect(setUserActiveSchema.safeParse({ userId: id, active: false }).success).toBe(true);
  });
});

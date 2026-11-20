import { describe, expect, it } from 'vitest';
import {
  dummyVerify,
  hashPassword,
  isSameAsCurrent,
  passwordPolicyErrors,
  verifyPassword,
} from '@/server/auth/password';

describe('passwordPolicyErrors', () => {
  it('11자는 거부, 12자는 허용', () => {
    expect(passwordPolicyErrors('a1b2c3d4e5f')).toHaveLength(1);
    expect(passwordPolicyErrors('a1b2c3d4e5f6')).toEqual([]);
  });

  it('129자 거부, 128자 허용', () => {
    expect(passwordPolicyErrors('x'.repeat(129)).length).toBeGreaterThan(0);
    expect(passwordPolicyErrors('x'.repeat(128))).toEqual([]);
  });

  it("'admin' 포함 거부(대소문자 무시)", () => {
    expect(passwordPolicyErrors('my-AdMiN-password')).toHaveLength(1);
  });

  it('아이디 포함 거부(대소문자 무시)', () => {
    expect(passwordPolicyErrors('xx-Operator-123', 'operator')).toHaveLength(1);
    expect(passwordPolicyErrors('xx-Operator-123', 'someone')).toEqual([]);
  });
});

describe('hash/verify', () => {
  it('왕복 검증', async () => {
    const h = await hashPassword('correct horse battery');
    expect(h.startsWith('$argon2id$v=19$m=19456,t=2,p=1$')).toBe(true);
    expect(await verifyPassword(h, 'correct horse battery')).toBe(true);
    expect(await verifyPassword(h, 'wrong')).toBe(false);
  });

  it('129자 비밀번호는 해시를 거부하고 검증은 false', async () => {
    await expect(hashPassword('x'.repeat(129))).rejects.toThrow();
    const h = await hashPassword('x'.repeat(128));
    expect(await verifyPassword(h, 'x'.repeat(129))).toBe(false);
  });

  it('깨진 해시는 false', async () => {
    expect(await verifyPassword('not-a-hash', 'x')).toBe(false);
  });

  it('이전 비밀번호와 같은지', async () => {
    const h = await hashPassword('old-password-1');
    expect(await isSameAsCurrent(h, 'old-password-1')).toBe(true);
    expect(await isSameAsCurrent(h, 'new-password-1')).toBe(false);
    expect(await isSameAsCurrent(null, 'x')).toBe(false);
  });

  it('dummyVerify 는 항상 false', async () => {
    expect(await dummyVerify('admin')).toBe(false);
  });
});

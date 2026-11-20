import { describe, expect, it } from 'vitest';
import { hasRole, isRole, ROLES } from '@/lib/roles';

describe('roles', () => {
  it('상위 역할은 하위 권한을 포함한다', () => {
    expect(hasRole('ADMIN', 'VIEWER')).toBe(true);
    expect(hasRole('ADMIN', 'MEMBER')).toBe(true);
    expect(hasRole('ADMIN', 'ADMIN')).toBe(true);
    expect(hasRole('MEMBER', 'VIEWER')).toBe(true);
    expect(hasRole('MEMBER', 'MEMBER')).toBe(true);
    expect(hasRole('VIEWER', 'VIEWER')).toBe(true);
  });

  it('하위 역할은 상위 권한이 없다', () => {
    expect(hasRole('MEMBER', 'ADMIN')).toBe(false);
    expect(hasRole('VIEWER', 'MEMBER')).toBe(false);
    expect(hasRole('VIEWER', 'ADMIN')).toBe(false);
  });

  it('isRole 은 정의된 값만 허용한다', () => {
    for (const r of ROLES) expect(isRole(r)).toBe(true);
    expect(isRole('admin')).toBe(false);
    expect(isRole('ROOT')).toBe(false);
    expect(isRole(undefined)).toBe(false);
  });
});

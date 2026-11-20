import { describe, expect, it, vi } from 'vitest';
import { diffFields, writeAudit } from '@/server/audit';
import { maskSensitive, REDACTED } from '@/server/log';

describe('diffFields', () => {
  it('바뀐 필드만 돌려준다', () => {
    const before = { name: 'a', role: 'VIEWER', active: true };
    expect(diffFields(before, { name: 'a', role: 'ADMIN' })).toEqual({
      before: { role: 'VIEWER' },
      after: { role: 'ADMIN' },
    });
  });

  it('바뀐 것이 없으면 null', () => {
    expect(diffFields({ a: 1 }, { a: 1 })).toBeNull();
  });

  it('Date 는 ISO 문자열로 비교한다', () => {
    const d = new Date('2026-01-01T00:00:00Z');
    expect(diffFields({ at: d }, { at: new Date(d) })).toBeNull();
    expect(diffFields({ at: d }, { at: null as unknown as Date })).toEqual({
      before: { at: '2026-01-01T00:00:00.000Z' },
      after: { at: null },
    });
  });

  it('fields 로 대상을 제한한다', () => {
    expect(diffFields({ a: 1, b: 1 }, { a: 2, b: 2 }, ['a'])).toEqual({ before: { a: 1 }, after: { a: 2 } });
  });
});

describe('maskSensitive', () => {
  it('비밀번호·토큰·해시·쿠키 키를 마스킹한다', () => {
    expect(
      maskSensitive({
        password: 'p',
        passwordHash: 'h',
        sessionToken: 't',
        access_token: 't',
        cookie: 'c',
        nested: { newPassword: 'x', ok: 1 },
        list: [{ secret: 's' }],
      }),
    ).toEqual({
      password: REDACTED,
      passwordHash: REDACTED,
      sessionToken: REDACTED,
      access_token: REDACTED,
      cookie: REDACTED,
      nested: { newPassword: REDACTED, ok: 1 },
      list: [{ secret: REDACTED }],
    });
  });

  it('원시값은 그대로', () => {
    expect(maskSensitive('a')).toBe('a');
    expect(maskSensitive(null)).toBeNull();
  });
});

describe('writeAudit', () => {
  it('before/after 를 마스킹하고 메타를 기록한다', async () => {
    const create = vi.fn().mockResolvedValue({});
    const db = { auditLog: { create } } as unknown as Parameters<typeof writeAudit>[0];
    await writeAudit(db, {
      actorId: 'u1',
      action: 'user.update',
      entity: 'User',
      entityId: 'u2',
      after: { passwordHash: 'h', role: 'ADMIN' },
      meta: { ip: '1.2.3.4', userAgent: 'ua' },
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        actorId: 'u1',
        action: 'user.update',
        entity: 'User',
        entityId: 'u2',
        before: undefined,
        after: { passwordHash: REDACTED, role: 'ADMIN' },
        ip: '1.2.3.4',
        userAgent: 'ua',
      },
    });
  });
});

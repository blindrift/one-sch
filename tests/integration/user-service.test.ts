import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/server/db';
import { AppError } from '@/server/action-result';
import { hashPassword, verifyPassword } from '@/server/auth/password';
import { createSession, loadSession } from '@/server/auth/session';
import * as users from '@/server/services/user-service';
import { disconnectAll, resetDb } from '../helpers/db';

const meta = { ip: '127.0.0.1', userAgent: 'vitest' };

async function makeUser(email: string, role: 'ADMIN' | 'MEMBER' | 'VIEWER' = 'VIEWER') {
  return prisma.user.create({ data: { email, name: email.split('@')[0], role } });
}

async function reasonOf(p: Promise<unknown>) {
  try {
    await p;
    return 'OK';
  } catch (e) {
    if (e instanceof AppError) return `${e.code}:${e.reason ?? ''}`;
    throw e;
  }
}

beforeEach(resetDb);
afterAll(async () => {
  await prisma.$disconnect();
  await disconnectAll();
});

describe('user-service', () => {
  it('createUser: 등록·감사, 중복 이메일은 CONFLICT', async () => {
    const admin = await makeUser('admin@example.com', 'ADMIN');
    await users.createUser(admin, { email: 'new@example.com', name: 'n', role: 'MEMBER' }, meta);
    const u = await prisma.user.findUniqueOrThrow({ where: { email: 'new@example.com' } });
    expect(u).toMatchObject({ role: 'MEMBER', active: true, passwordHash: null, username: null });
    expect(await prisma.auditLog.count({ where: { action: 'user.create', entityId: u.id, actorId: admin.id } })).toBe(1);
    expect(await reasonOf(users.createUser(admin, { email: 'new@example.com', name: 'x', role: 'VIEWER' }, meta))).toBe(
      'CONFLICT:email_taken',
    );
  });

  it('updateUserRole: 대상 세션 삭제·감사 전후 값', async () => {
    const admin = await makeUser('admin@example.com', 'ADMIN');
    const target = await makeUser('t@example.com', 'VIEWER');
    const { rawToken } = await createSession(prisma, { userId: target.id });
    await users.updateUserRole(admin, target.id, 'MEMBER', meta);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).role).toBe('MEMBER');
    expect(await loadSession(rawToken)).toBeNull();
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'user.role.update' } });
    expect(log.before).toEqual({ role: 'VIEWER' });
    expect(log.after).toEqual({ role: 'MEMBER', revokedSessions: 1 });
  });

  it('자기 역할은 바꿀 수 없다(본인 강등으로 활성 ADMIN 0명이 되는 경로 차단)', async () => {
    const admin = await makeUser('admin@example.com', 'ADMIN');
    expect(await reasonOf(users.updateUserRole(admin, admin.id, 'MEMBER', meta))).toBe('CONFLICT:self');
    expect(await reasonOf(users.setUserActive(admin, admin.id, false, meta))).toBe('CONFLICT:self');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: admin.id } })).role).toBe('ADMIN');
  });

  it('다른 활성 ADMIN 은 강등·비활성화할 수 있고, 남은 1명은 자기 자신이라 막힌다', async () => {
    const a = await makeUser('a@example.com', 'ADMIN');
    const b = await makeUser('b@example.com', 'ADMIN');
    expect(await reasonOf(users.updateUserRole(a, b.id, 'MEMBER', meta))).toBe('OK');
    expect(await prisma.user.count({ where: { role: 'ADMIN', active: true } })).toBe(1);
    expect(await reasonOf(users.updateUserRole(a, a.id, 'MEMBER', meta))).toBe('CONFLICT:self');
  });

  it('동시에 서로를 강등하면 먼저 처리된 쪽만 성공하고, 늦은 쪽은 이미 강등된 요청자라 거부된다', async () => {
    const a = await makeUser('a@example.com', 'ADMIN');
    const b = await makeUser('b@example.com', 'ADMIN');
    const results = await Promise.all([
      reasonOf(users.updateUserRole(a, b.id, 'VIEWER', meta)),
      reasonOf(users.updateUserRole(b, a.id, 'VIEWER', meta)),
    ]);
    expect(results.sort()).toEqual(['FORBIDDEN:actor_stale', 'OK']);
    expect(await prisma.user.count({ where: { role: 'ADMIN', active: true } })).toBe(1);
  });

  it('ADMIN 3명에서 A→B, B→C 강등이 동시에 와도 B 의 요청은 강등 뒤라 거부된다(TST-12)', async () => {
    const a = await makeUser('a@example.com', 'ADMIN');
    const b = await makeUser('b@example.com', 'ADMIN');
    const c = await makeUser('c@example.com', 'ADMIN');
    // A 의 요청을 먼저 줄 세운 뒤 B 의 요청을 보낸다.
    const first = users.updateUserRole(a, b.id, 'VIEWER', meta);
    const second = users.updateUserRole(b, c.id, 'VIEWER', meta);
    const results = [await reasonOf(first), await reasonOf(second)];
    const roles = Object.fromEntries((await prisma.user.findMany()).map((u) => [u.email, u.role]));
    if (results[0] === 'OK') {
      expect(results[1]).toBe('FORBIDDEN:actor_stale');
      expect(roles).toEqual({ 'a@example.com': 'ADMIN', 'b@example.com': 'VIEWER', 'c@example.com': 'ADMIN' });
    } else {
      // B 의 요청이 먼저 잡힌 경우: B→C 성공 후 A→B 도 정당(A 는 여전히 ADMIN)
      expect(results).toEqual(['OK', 'OK']);
    }
    expect(await prisma.user.count({ where: { role: 'ADMIN', active: true } })).toBeGreaterThanOrEqual(1);
  });

  it('비활성화되거나 강등된 요청자의 모든 관리 작업은 FORBIDDEN(actor_stale)', async () => {
    const a = await makeUser('a@example.com', 'ADMIN');
    const t = await makeUser('t@example.com');
    await prisma.user.update({ where: { id: a.id }, data: { role: 'MEMBER' } });
    const calls = [
      users.createUser(a, { email: 'n@example.com', name: 'n', role: 'VIEWER' }, meta),
      users.updateUserRole(a, t.id, 'MEMBER', meta),
      users.setUserActive(a, t.id, false, meta),
      users.revokeUserSessions(a, t.id, meta),
      users.unlockUser(a, t.id, meta),
      users.resetUserPassword(a, t.id, meta),
    ];
    for (const c of calls) expect(await reasonOf(c)).toBe('FORBIDDEN:actor_stale');
    expect(await prisma.user.count({ where: { email: 'n@example.com' } })).toBe(0);
  });

  it('세션 수는 만료되지 않은 세션만 센다', async () => {
    const t = await makeUser('t@example.com');
    await createSession(prisma, { userId: t.id, random: () => 1 });
    await createSession(prisma, { userId: t.id, now: new Date(Date.now() - 9 * 60 * 60 * 1000), random: () => 1 });
    const row = (await users.listUsers()).find((u) => u.id === t.id)!;
    expect(row.sessionCount).toBe(1);
    // 정리가 돌면 만료 세션 행이 지워진다
    await createSession(prisma, { userId: t.id, random: () => 0 });
    expect(await prisma.session.count({ where: { userId: t.id } })).toBe(2);
  });

  it('자기 자신은 비활성화할 수 없다', async () => {
    const admin = await makeUser('admin@example.com', 'ADMIN');
    await makeUser('b@example.com', 'ADMIN');
    expect(await reasonOf(users.setUserActive(admin, admin.id, false, meta))).toBe('CONFLICT:self');
  });

  it('setUserActive(false): 세션 삭제·감사, 다시 활성화 가능', async () => {
    const admin = await makeUser('admin@example.com', 'ADMIN');
    const t = await makeUser('t@example.com');
    const { rawToken } = await createSession(prisma, { userId: t.id });
    await users.setUserActive(admin, t.id, false, meta);
    expect(await prisma.session.count({ where: { userId: t.id } })).toBe(0);
    expect(await loadSession(rawToken)).toBeNull();
    await users.setUserActive(admin, t.id, true, meta);
    expect(await prisma.auditLog.count({ where: { action: { in: ['user.deactivate', 'user.activate'] } } })).toBe(2);
  });

  it('revokeUserSessions·unlockUser', async () => {
    const admin = await makeUser('admin@example.com', 'ADMIN');
    const t = await makeUser('t@example.com');
    await createSession(prisma, { userId: t.id });
    await createSession(prisma, { userId: t.id });
    await users.revokeUserSessions(admin, t.id, meta);
    expect(await prisma.session.count({ where: { userId: t.id } })).toBe(0);

    await prisma.user.update({ where: { id: t.id }, data: { failedLogins: 3, lockedUntil: new Date(Date.now() + 60_000) } });
    await users.unlockUser(admin, t.id, meta);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: t.id } });
    expect(after.failedLogins).toBe(0);
    expect(after.lockedUntil).toBeNull();
    expect(await prisma.auditLog.count({ where: { action: { in: ['user.sessions.revoke', 'user.unlock'] } } })).toBe(2);
  });

  it('resetUserPassword: 비밀번호 있는 계정만, 본인 제외, 강제 변경·세션 삭제, 감사에 비밀번호 없음', async () => {
    const google = await makeUser('g@example.com', 'ADMIN');
    const local = await prisma.user.create({
      data: { username: 'admin', name: '관리자', role: 'ADMIN', passwordHash: await hashPassword('old-password-1') },
    });
    await createSession(prisma, { userId: local.id });

    expect(await reasonOf(users.resetUserPassword(google, google.id, meta))).toBe('CONFLICT:self');
    const other = await makeUser('o@example.com');
    expect(await reasonOf(users.resetUserPassword(google, other.id, meta))).toBe('CONFLICT:no_password');

    const { temporaryPassword } = await users.resetUserPassword(google, local.id, meta);
    expect(temporaryPassword).toHaveLength(24);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: local.id } });
    expect(after.mustChangePassword).toBe(true);
    expect(await verifyPassword(after.passwordHash!, temporaryPassword)).toBe(true);
    expect(await prisma.session.count({ where: { userId: local.id } })).toBe(0);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'user.password.reset' } });
    expect(JSON.stringify(log)).not.toContain(temporaryPassword);
  });

  it('트랜잭션: 감사 기록이 실패하면 변경도 롤백된다', async () => {
    const admin = await makeUser('admin@example.com', 'ADMIN');
    const t = await makeUser('t@example.com');
    await createSession(prisma, { userId: t.id });
    // PostgreSQL text 는 NUL 문자를 받지 않으므로 감사 INSERT 만 실패한다.
    await expect(users.updateUserRole(admin, t.id, 'MEMBER', { ip: 'bad\u0000ip', userAgent: null })).rejects.toThrow();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: t.id } })).role).toBe('VIEWER');
    expect(await prisma.session.count({ where: { userId: t.id } })).toBe(1);
  });

  it('없는 사용자는 NOT_FOUND', async () => {
    const admin = await makeUser('admin@example.com', 'ADMIN');
    expect(await reasonOf(users.unlockUser(admin, '00000000-0000-4000-8000-000000000000', meta))).toBe('NOT_FOUND:');
  });
});

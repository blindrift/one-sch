import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { seed } from '../../prisma/seed';
import { verifyPassword } from '@/server/auth/password';
import { disconnectAll, ownerDb, resetDb } from '../helpers/db';

beforeEach(resetDb);
afterAll(disconnectAll);

describe('seed', () => {
  it('빈 DB 에 admin/admin 을 변경 강제로 만든다', async () => {
    expect(await seed(ownerDb)).toBe('created');
    const users = await ownerDb.user.findMany();
    expect(users).toHaveLength(1);
    const [admin] = users;
    expect(admin.username).toBe('admin');
    expect(admin.email).toBeNull();
    expect(admin.role).toBe('ADMIN');
    expect(admin.mustChangePassword).toBe(true);
    expect(admin.active).toBe(true);
    expect(await verifyPassword(admin.passwordHash!, 'admin')).toBe(true);
    expect(await ownerDb.auditLog.count({ where: { action: 'user.seed_admin' } })).toBe(1);
  });

  it('다시 실행해도 바뀌지 않는다', async () => {
    await seed(ownerDb);
    const before = await ownerDb.user.findFirstOrThrow();
    expect(await seed(ownerDb)).toBe('skipped');
    const after = await ownerDb.user.findMany();
    expect(after).toHaveLength(1);
    expect(after[0].passwordHash).toBe(before.passwordHash);
  });

  it('사용자가 이미 있으면 admin 을 만들지 않는다', async () => {
    await ownerDb.user.create({ data: { email: 'someone@example.com', name: 'x', role: 'ADMIN' } });
    expect(await seed(ownerDb)).toBe('skipped');
    expect(await ownerDb.user.count({ where: { username: 'admin' } })).toBe(0);
  });

  it('동시에 실행해도 한 명만 만든다', async () => {
    const results = await Promise.all([seed(ownerDb), seed(ownerDb), seed(ownerDb)]);
    expect(results.filter((r) => r === 'created')).toHaveLength(1);
    expect(await ownerDb.user.count()).toBe(1);
  });
});

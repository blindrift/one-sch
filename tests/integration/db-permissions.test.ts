import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { appDb, disconnectAll, ownerDb, resetDb } from '../helpers/db';

beforeEach(resetDb);
afterAll(disconnectAll);

async function insertAudit() {
  const row = await appDb.auditLog.create({ data: { action: 'test.audit' } });
  return row.id;
}

describe('AuditLog append-only', () => {
  it('앱 역할은 INSERT·SELECT 할 수 있다', async () => {
    const id = await insertAudit();
    expect(await appDb.auditLog.findUnique({ where: { id } })).not.toBeNull();
  });

  it('앱 역할의 UPDATE·DELETE 는 권한 오류', async () => {
    const id = await insertAudit();
    await expect(appDb.$executeRaw`UPDATE "AuditLog" SET "action" = 'x' WHERE "id" = ${id}`).rejects.toThrow(
      /permission denied/,
    );
    await expect(appDb.$executeRaw`DELETE FROM "AuditLog" WHERE "id" = ${id}`).rejects.toThrow(/permission denied/);
    await expect(appDb.$executeRaw`TRUNCATE "AuditLog"`).rejects.toThrow(/permission denied for table "?AuditLog"?/);
  });

  it('소유자도 UPDATE·DELETE 는 트리거가 거부한다', async () => {
    const id = await insertAudit();
    await expect(ownerDb.$executeRaw`UPDATE "AuditLog" SET "action" = 'x' WHERE "id" = ${id}`).rejects.toThrow(
      /append-only/,
    );
    await expect(ownerDb.$executeRaw`DELETE FROM "AuditLog" WHERE "id" = ${id}`).rejects.toThrow(/append-only/);
  });

  it('소유자의 TRUNCATE 도 문장 트리거가 거부한다', async () => {
    await insertAudit();
    await expect(ownerDb.$executeRaw`TRUNCATE "AuditLog"`).rejects.toThrow(/append-only/);
    expect(await ownerDb.auditLog.count()).toBe(1);
  });
});

describe('앱 역할 최소 권한', () => {
  it('_prisma_migrations 는 읽기·쓰기 모두 거부된다', async () => {
    await expect(appDb.$queryRaw`SELECT count(*) FROM "_prisma_migrations"`).rejects.toThrow(/permission denied for table "?_prisma_migrations"?/);
    await expect(appDb.$executeRaw`UPDATE "_prisma_migrations" SET "logs" = 'x'`).rejects.toThrow(
      /permission denied for table "?_prisma_migrations"?/,
    );
    await expect(appDb.$executeRaw`DELETE FROM "_prisma_migrations"`).rejects.toThrow(/permission denied for table "?_prisma_migrations"?/);
  });

  it('CREATE TABLE 은 거부된다', async () => {
    await expect(appDb.$executeRaw`CREATE TABLE "Evil" ("id" int)`).rejects.toThrow(/permission denied/);
  });

  it('다른 테이블 DML 은 가능하다', async () => {
    const u = await appDb.user.create({ data: { email: 'a@example.com', name: 'a' } });
    await appDb.user.update({ where: { id: u.id }, data: { name: 'b' } });
    await appDb.user.delete({ where: { id: u.id } });
  });
});

describe('CHECK 제약', () => {
  it('email·username 둘 다 없으면 거부', async () => {
    await expect(appDb.user.create({ data: { name: 'x' } })).rejects.toThrow(/User_email_or_username_check/);
  });

  it('대문자 email 거부', async () => {
    await expect(appDb.user.create({ data: { name: 'x', email: 'A@example.com' } })).rejects.toThrow(
      /User_email_lower_check/,
    );
  });
});

describe('0002(2단계 일정)', () => {
  async function owner() {
    return appDb.user.create({ data: { email: 'o@example.com', name: 'o' } });
  }

  it('앱 역할은 Project·Task·TaskDependency DML 을 할 수 있고 Project.version 기본값은 0', async () => {
    const o = await owner();
    const p = await appDb.project.create({ data: { key: 'AB', name: 'p', color: '#112233', ownerId: o.id } });
    expect(p.version).toBe(0);
    await appDb.project.update({ where: { id: p.id }, data: { version: { increment: 1 } } });
    const d = new Date('2026-01-01T00:00:00Z');
    const t1 = await appDb.task.create({ data: { projectId: p.id, title: 'a', startDate: d, endDate: d } });
    const t2 = await appDb.task.create({ data: { projectId: p.id, title: 'b', startDate: d, endDate: d } });
    const dep = await appDb.taskDependency.create({ data: { fromTaskId: t1.id, toTaskId: t2.id } });
    await appDb.taskDependency.delete({ where: { id: dep.id } });
    await appDb.task.delete({ where: { id: t1.id } });
  });

  it('제목·이름 길이 CHECK', async () => {
    const o = await owner();
    await expect(
      appDb.project.create({ data: { key: 'AB', name: '', color: '#112233', ownerId: o.id } }),
    ).rejects.toThrow(/Project_name_length_check/);
    const p = await appDb.project.create({ data: { key: 'AC', name: 'p', color: '#112233', ownerId: o.id } });
    const d = new Date('2026-01-01T00:00:00Z');
    await expect(appDb.task.create({ data: { projectId: p.id, title: 'x'.repeat(201), startDate: d, endDate: d } })).rejects.toThrow(
      /Task_title_length_check/,
    );
    await expect(appDb.task.create({ data: { projectId: p.id, title: '', startDate: d, endDate: d } })).rejects.toThrow(
      /Task_title_length_check/,
    );
  });
});

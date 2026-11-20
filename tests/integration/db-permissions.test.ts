import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { appDb, ownerDb, resetDb } from '../helpers/db';

beforeEach(resetDb);
afterAll(async () => {
  await appDb.$disconnect();
  await ownerDb.$disconnect();
});

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
    await expect(appDb.$executeRaw`TRUNCATE "AuditLog"`).rejects.toThrow(/permission denied|must be owner/);
  });

  it('소유자도 UPDATE·DELETE 는 트리거가 거부한다', async () => {
    const id = await insertAudit();
    await expect(ownerDb.$executeRaw`UPDATE "AuditLog" SET "action" = 'x' WHERE "id" = ${id}`).rejects.toThrow(
      /append-only/,
    );
    await expect(ownerDb.$executeRaw`DELETE FROM "AuditLog" WHERE "id" = ${id}`).rejects.toThrow(/append-only/);
  });
});

describe('앱 역할 최소 권한', () => {
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

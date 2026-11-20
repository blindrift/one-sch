import { PrismaClient } from '@prisma/client';

// 소유자(onesch_owner): 시드·검증용. 앱 코드는 @/server/db(onesch_app)를 쓴다.
export const ownerDb = new PrismaClient({ datasourceUrl: process.env.TEST_MIGRATE_DATABASE_URL });
// 앱 역할로 직접 붙는 클라이언트(권한 검증용)
export const appDb = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
// superuser(postgres): 테스트 DB 정리 전용. AuditLog 의 TRUNCATE 트리거는 소유자도 막으므로
// 이 연결에서만 session_replication_role=replica 로 사용자 트리거를 끄고 비운다.
const adminDb = new PrismaClient({ datasourceUrl: process.env.TEST_ADMIN_DATABASE_URL });

/** 지워도 되는 DB 이름(테스트·E2E 전용). 잘못된 URL 로 개발 DB 를 지우지 않게 한다. */
export const DISPOSABLE_DB = /_(test|e2e)$/;

/** 모든 테이블을 비운다(테스트 DB 전용). 접속한 DB 이름이 *_test·*_e2e 가 아니면 아무것도 하지 않고 실패한다. */
export async function resetDb(): Promise<void> {
  const [{ db }] = await adminDb.$queryRaw<Array<{ db: string }>>`SELECT current_database() AS db`;
  if (!DISPOSABLE_DB.test(db)) {
    throw new Error(`resetDb 거부: ${db} 는 테스트 DB 가 아닙니다(TEST_ADMIN_DATABASE_URL 확인).`);
  }
  await adminDb.$transaction([
    adminDb.$executeRaw`SET LOCAL session_replication_role = replica`,
    adminDb.$executeRaw`TRUNCATE "AuditLog", "LoginAttempt", "Comment", "Issue", "TaskDependency", "Task", "Project", "Session", "Account", "User" RESTART IDENTITY CASCADE`,
  ]);
}

export async function disconnectAll(): Promise<void> {
  await Promise.all([ownerDb.$disconnect(), appDb.$disconnect(), adminDb.$disconnect()]);
}

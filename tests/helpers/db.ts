import { PrismaClient } from '@prisma/client';

// 소유자(onesch_owner): 시드·검증용. 앱 코드는 @/server/db(onesch_app)를 쓴다.
export const ownerDb = new PrismaClient({ datasourceUrl: process.env.TEST_MIGRATE_DATABASE_URL });
// 앱 역할로 직접 붙는 클라이언트(권한 검증용)
export const appDb = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
// superuser(postgres): 테스트 DB 정리 전용. AuditLog 의 TRUNCATE 트리거는 소유자도 막으므로
// 이 연결에서만 session_replication_role=replica 로 사용자 트리거를 끄고 비운다.
const adminDb = new PrismaClient({ datasourceUrl: process.env.TEST_ADMIN_DATABASE_URL });

/** 모든 테이블을 비운다(테스트 DB 전용). */
export async function resetDb(): Promise<void> {
  await adminDb.$transaction([
    adminDb.$executeRaw`SET LOCAL session_replication_role = replica`,
    adminDb.$executeRaw`TRUNCATE "AuditLog", "LoginAttempt", "Comment", "Issue", "TaskDependency", "Task", "Project", "Session", "Account", "User" RESTART IDENTITY CASCADE`,
  ]);
}

export async function disconnectAll(): Promise<void> {
  await Promise.all([ownerDb.$disconnect(), appDb.$disconnect(), adminDb.$disconnect()]);
}

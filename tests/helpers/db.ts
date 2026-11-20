import { PrismaClient } from '@prisma/client';

// 소유자(onesch_owner): 테스트 정리·검증용. 앱 코드는 @/server/db(onesch_app)를 쓴다.
export const ownerDb = new PrismaClient({ datasourceUrl: process.env.TEST_MIGRATE_DATABASE_URL });
// 앱 역할로 직접 붙는 클라이언트(권한 검증용)
export const appDb = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });

/** 모든 테이블을 비운다. TRUNCATE 는 행 트리거를 타지 않으므로 소유자는 AuditLog 도 비울 수 있다. */
export async function resetDb(): Promise<void> {
  await ownerDb.$executeRaw`TRUNCATE "AuditLog", "LoginAttempt", "Comment", "Issue", "TaskDependency", "Task", "Project", "Session", "Account", "User" RESTART IDENTITY CASCADE`;
}

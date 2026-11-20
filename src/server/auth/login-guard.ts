import 'server-only';
import type { PrismaClient } from '@prisma/client';
import { prisma, type Tx } from '../db';

export const IP_LIMIT = 10;
export const IP_WINDOW_MS = 60 * 1000;
export const LOCK_THRESHOLD = 5;
export const LOCK_MS = 15 * 60 * 1000;
const ATTEMPT_RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * IP 당 60초에 10회(성공·실패 모두). 허용이면 시도 기록 id, 초과면 null.
 * 같은 IP 의 동시 요청은 advisory lock 으로 줄 세워 한도를 넘지 않게 한다.
 */
export async function checkIpRate(ip: string, now = new Date(), random = Math.random): Promise<bigint | null> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`login:${ip}`}))`;
    const recent = await tx.loginAttempt.count({
      where: { ip, at: { gt: new Date(now.getTime() - IP_WINDOW_MS) } },
    });
    if (recent >= IP_LIMIT) return null;
    const attempt = await tx.loginAttempt.create({ data: { ip, at: now } });
    if (random() < 0.01) {
      await tx.loginAttempt.deleteMany({ where: { at: { lt: new Date(now.getTime() - ATTEMPT_RETENTION_MS) } } });
    }
    return attempt.id;
  });
}

export async function markAttemptSuccess(db: Tx | PrismaClient, attemptId: bigint): Promise<void> {
  await db.loginAttempt.updateMany({ where: { id: attemptId }, data: { success: true } });
}

export function isLocked(user: { lockedUntil: Date | null }, now = new Date()): boolean {
  return user.lockedUntil !== null && user.lockedUntil.getTime() > now.getTime();
}

/**
 * 실패 횟수를 원자적으로 1 올린다. 5회째면 15분 잠그고 횟수를 0 으로 되돌린다.
 * 이번 실패로 잠겼으면 true.
 */
export async function recordFailure(userId: string, now = new Date()): Promise<boolean> {
  const lockUntil = new Date(now.getTime() + LOCK_MS);
  const rows = await prisma.$queryRaw<Array<{ locked: boolean }>>`
    UPDATE "User"
    SET "failedLogins" = CASE WHEN "failedLogins" + 1 >= ${LOCK_THRESHOLD} THEN 0 ELSE "failedLogins" + 1 END,
        "lockedUntil"  = CASE WHEN "failedLogins" + 1 >= ${LOCK_THRESHOLD} THEN ${lockUntil} ELSE "lockedUntil" END,
        "updatedAt"    = ${now}
    WHERE "id" = ${userId}::uuid
    RETURNING ("lockedUntil" = ${lockUntil}) AS "locked"`;
  return rows[0]?.locked === true;
}

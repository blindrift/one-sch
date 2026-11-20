import 'server-only';
import { Prisma, type PrismaClient } from '@prisma/client';
import { prisma, type Tx } from '../db';
import { log } from '../log';

export const IP_LIMIT = 10;
export const IP_WINDOW_MS = 60 * 1000;
export const LOCK_THRESHOLD = 5;
export const LOCK_MS = 15 * 60 * 1000;
const ATTEMPT_RETENTION_MS = 24 * 60 * 60 * 1000;

/** 같은 IP 동시 폭주로 advisory lock 대기가 길어지면 기다리지 않고 제한으로 처리한다. */
const IP_TX_OPTIONS = { maxWait: 5_000, timeout: 10_000 } as const;

/**
 * IP 당 60초에 10회(성공·실패 모두). 허용이면 시도 기록 id, 초과면 null.
 * 같은 IP 의 동시 요청은 advisory lock 으로 줄 세워 한도를 넘지 않게 한다.
 * 트랜잭션 대기·연결 풀 시간 초과(P2028·P2024)도 null(RATE_LIMITED)로 돌려 INTERNAL 이 되지 않게 한다.
 */
export async function checkIpRate(ip: string, now = new Date(), random = Math.random): Promise<bigint | null> {
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${`login:${ip}`}))`;
      const recent = await tx.loginAttempt.count({
        where: { ip, at: { gt: new Date(now.getTime() - IP_WINDOW_MS) } },
      });
      if (recent >= IP_LIMIT) return null;
      const attempt = await tx.loginAttempt.create({ data: { ip, at: now } });
      if (random() < 0.01) {
        await tx.loginAttempt.deleteMany({ where: { at: { lt: new Date(now.getTime() - ATTEMPT_RETENTION_MS) } } });
      }
      return attempt.id;
    }, IP_TX_OPTIONS);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === 'P2028' || err.code === 'P2024')) {
      log.warn('login_guard.ip_rate_timeout', { code: err.code });
      return null;
    }
    throw err;
  }
}

export async function markAttemptSuccess(db: Tx | PrismaClient, attemptId: bigint): Promise<void> {
  await db.loginAttempt.updateMany({ where: { id: attemptId }, data: { success: true } });
}

export function isLocked(user: { lockedUntil: Date | null }, now = new Date()): boolean {
  return user.lockedUntil !== null && user.lockedUntil.getTime() > now.getTime();
}

/**
 * 비밀번호를 검증하기 **전에** 실패 카운터를 원자적으로 1 올려 시도를 예약한다.
 * 잠겨 있으면 null. 돌려준 n 이 LOCK_THRESHOLD 를 넘으면(동시 요청이 몰린 경우) 검증하지 말고 잠가야 한다.
 * 이렇게 하면 잠금 확인과 실패 기록 사이 경쟁이 없어져, 잠금 창마다 실제 검증은 최대 5회다.
 * 성공하면 호출자가 failedLogins 를 0 으로 되돌린다.
 */
export async function reserveAttempt(userId: string, now = new Date()): Promise<number | null> {
  const rows = await prisma.$queryRaw<Array<{ failedLogins: number }>>`
    UPDATE "User"
    SET "failedLogins" = "failedLogins" + 1,
        "updatedAt"    = ${now}::timestamptz
    WHERE "id" = ${userId}::uuid
      AND ("lockedUntil" IS NULL OR "lockedUntil" <= ${now}::timestamptz)
    RETURNING "failedLogins"`;
  return rows[0]?.failedLogins ?? null;
}

/** 15분 잠그고 카운터를 0 으로. */
export async function lockUser(userId: string, now = new Date()): Promise<Date> {
  const lockedUntil = new Date(now.getTime() + LOCK_MS);
  await prisma.$executeRaw`
    UPDATE "User"
    SET "lockedUntil" = ${lockedUntil}::timestamptz, "failedLogins" = 0, "updatedAt" = ${now}::timestamptz
    WHERE "id" = ${userId}::uuid`;
  return lockedUntil;
}

/** 예약 결과로 이번 시도를 검증해도 되는지. 아니면(잠김·초과) 검증 없이 실패 처리한다. */
export function mayVerify(reserved: number | null): reserved is number {
  return reserved !== null && reserved <= LOCK_THRESHOLD;
}

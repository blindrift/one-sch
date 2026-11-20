import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import type { PrismaClient, User } from '@prisma/client';
import { prisma, type Tx } from '../db';
import { SESSION_ABSOLUTE_SECONDS, SESSION_IDLE_SECONDS, SESSION_TOUCH_SECONDS } from './cookies';

export type SessionWithUser = {
  id: string;
  userId: string;
  expires: Date;
  createdAt: Date;
  user: User;
};

const MAX_TOKEN_LENGTH = 256;

/** DB 에는 원본 토큰이 아니라 SHA-256 hex 만 저장한다. */
export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function newRawToken(): string {
  return randomBytes(32).toString('base64url');
}

function idleExpiry(now: Date, createdAt: Date): Date {
  const idle = now.getTime() + SESSION_IDLE_SECONDS * 1000;
  const absolute = createdAt.getTime() + SESSION_ABSOLUTE_SECONDS * 1000;
  return new Date(Math.min(idle, absolute));
}

export async function createSession(
  db: Tx | PrismaClient,
  input: { userId: string; ip?: string | null; userAgent?: string | null; rawToken?: string; now?: Date; random?: () => number },
): Promise<{ rawToken: string; expires: Date }> {
  const now = input.now ?? new Date();
  // 로그인 때 가끔(5%) 만료된 세션 행을 정리한다(만료 세션은 이미 무효지만 테이블·세션 수 표시가 부풀지 않게).
  if ((input.random ?? Math.random)() < 0.05) {
    await db.session.deleteMany({ where: { expires: { lt: now } } });
  }
  const rawToken = input.rawToken ?? newRawToken();
  const expires = idleExpiry(now, now);
  await db.session.create({
    data: {
      sessionToken: hashToken(rawToken),
      userId: input.userId,
      expires,
      createdAt: now,
      lastSeenAt: now,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
    },
  });
  return { rawToken, expires };
}

/**
 * 세션 판정의 유일한 기준. 유휴 만료·절대 7일·비활성 사용자·로컬 로그인 꺼짐(로컬 전용 계정)은 세션을 지우고 null.
 * 마지막 갱신에서 5분이 지났을 때만 유휴 만료를 연장한다.
 */
export async function loadSession(rawToken: string | null | undefined, now = new Date()): Promise<SessionWithUser | null> {
  if (!rawToken || rawToken.length > MAX_TOKEN_LENGTH) return null;
  const session = await prisma.session.findUnique({
    where: { sessionToken: hashToken(rawToken) },
    include: { user: true },
  });
  if (!session) return null;

  const absoluteEnd = session.createdAt.getTime() + SESSION_ABSOLUTE_SECONDS * 1000;
  // 로컬 로그인을 끈 뒤에는 로컬 전용 계정(비밀번호 있고 이메일 없음)의 남은 세션도 바로 끊는다.
  const localOnly = session.user.passwordHash !== null && session.user.email === null;
  const localDisabled = localOnly && process.env.LOCAL_LOGIN_ENABLED !== 'true';
  if (session.expires.getTime() <= now.getTime() || absoluteEnd <= now.getTime() || !session.user.active || localDisabled) {
    await prisma.session.deleteMany({ where: { id: session.id } });
    return null;
  }

  let expires = session.expires;
  if (now.getTime() - session.lastSeenAt.getTime() >= SESSION_TOUCH_SECONDS * 1000) {
    expires = idleExpiry(now, session.createdAt);
    await prisma.session.updateMany({ where: { id: session.id }, data: { expires, lastSeenAt: now } });
  }

  return { id: session.id, userId: session.userId, expires, createdAt: session.createdAt, user: session.user };
}

/** 지운 세션(있으면)을 돌려준다. */
export async function deleteSessionByToken(rawToken: string) {
  const hashed = hashToken(rawToken);
  const session = await prisma.session.findUnique({ where: { sessionToken: hashed } });
  if (!session) return null;
  await prisma.session.deleteMany({ where: { id: session.id } });
  return session;
}

/** 비활성화·역할 변경·비밀번호 초기화·세션 종료 때 같은 트랜잭션에서 호출한다. */
export async function deleteSessionsOfUser(db: Tx | PrismaClient, userId: string): Promise<number> {
  const { count } = await db.session.deleteMany({ where: { userId } });
  return count;
}

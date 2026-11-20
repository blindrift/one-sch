import 'server-only';
import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { Role } from '@/lib/roles';
import type { CreateUserInput } from '@/lib/validation/user';
import { AppError } from '../action-result';
import { diffFields, writeAudit } from '../audit';
import { prisma, type Tx } from '../db';
import type { RequestMeta } from '../request-meta';
import { hashPassword } from '../auth/password';
import { deleteSessionsOfUser } from '../auth/session';

// 관리자 수를 바꾸는 작업(역할 변경·비활성화)은 이 키로 줄 세워 "마지막 활성 ADMIN" 검사가 경쟁에 지지 않게 한다.
const ADMIN_CHANGE_LOCK = 74_201_121;

export type Actor = { id: string };

export type UserRow = {
  id: string;
  email: string | null;
  username: string | null;
  name: string;
  role: Role;
  active: boolean;
  hasPassword: boolean;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  sessionCount: number;
};

export async function listUsers(): Promise<UserRow[]> {
  const users = await prisma.user.findMany({
    orderBy: [{ active: 'desc' }, { createdAt: 'asc' }],
    // 만료됐지만 아직 지워지지 않은 세션은 세지 않는다.
    include: { _count: { select: { sessions: { where: { expires: { gt: new Date() } } } } } },
  });
  return users.map((u) => ({
    id: u.id,
    email: u.email,
    username: u.username,
    name: u.name,
    role: u.role,
    active: u.active,
    hasPassword: u.passwordHash !== null,
    lockedUntil: u.lockedUntil,
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
    sessionCount: u._count.sessions,
  }));
}

async function findTarget(tx: Tx, userId: string) {
  const user = await tx.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError('NOT_FOUND');
  return user;
}

/**
 * 관리 작업을 한 줄로 세우고, 줄을 선 뒤에 요청자가 아직 활성 ADMIN 인지 다시 확인한다.
 * (요청자가 기다리는 동안 다른 관리자에게 강등·비활성화됐을 수 있다 — TOCTOU 방지)
 */
async function lockAdminChanges(tx: Tx, actor: Actor) {
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(${ADMIN_CHANGE_LOCK})`;
  const current = await tx.user.findUnique({ where: { id: actor.id }, select: { role: true, active: true } });
  if (!current || !current.active || current.role !== 'ADMIN') {
    throw new AppError('FORBIDDEN', 'actor_stale', '권한이 바뀌었습니다. 다시 로그인해 주세요.');
  }
}

async function otherActiveAdmins(tx: Tx, exceptId: string) {
  return tx.user.count({ where: { role: 'ADMIN', active: true, id: { not: exceptId } } });
}

export async function createUser(actor: Actor, input: CreateUserInput, meta: RequestMeta) {
  try {
    return await prisma.$transaction(async (tx) => {
      await lockAdminChanges(tx, actor);
      const user = await tx.user.create({ data: { email: input.email, name: input.name, role: input.role } });
      await writeAudit(tx, {
        actorId: actor.id,
        action: 'user.create',
        entity: 'User',
        entityId: user.id,
        after: { email: user.email, name: user.name, role: user.role },
        meta,
      });
      return { id: user.id };
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new AppError('CONFLICT', 'email_taken', '이미 등록된 이메일입니다.', { email: ['이미 등록된 이메일입니다.'] });
    }
    throw err;
  }
}

export async function updateUserRole(actor: Actor, userId: string, role: Role, meta: RequestMeta) {
  await prisma.$transaction(async (tx) => {
    if (userId === actor.id) {
      throw new AppError('CONFLICT', 'self', '자기 역할은 바꿀 수 없습니다. 다른 관리자에게 요청해 주세요.');
    }
    await lockAdminChanges(tx, actor);
    const target = await findTarget(tx, userId);
    if (target.role === role) return;
    if (target.role === 'ADMIN' && target.active && (await otherActiveAdmins(tx, target.id)) === 0) {
      throw new AppError('CONFLICT', 'last_admin', '마지막 활성 관리자의 역할은 바꿀 수 없습니다.');
    }
    await tx.user.update({ where: { id: target.id }, data: { role } });
    const revoked = await deleteSessionsOfUser(tx, target.id);
    const diff = diffFields({ role: target.role }, { role });
    await writeAudit(tx, {
      actorId: actor.id,
      action: 'user.role.update',
      entity: 'User',
      entityId: target.id,
      before: diff?.before,
      after: { ...diff?.after, revokedSessions: revoked },
      meta,
    });
  });
}

export async function setUserActive(actor: Actor, userId: string, active: boolean, meta: RequestMeta) {
  await prisma.$transaction(async (tx) => {
    await lockAdminChanges(tx, actor);
    const target = await findTarget(tx, userId);
    if (target.active === active) return;
    if (!active) {
      if (target.id === actor.id) throw new AppError('CONFLICT', 'self', '자기 자신은 비활성화할 수 없습니다.');
      if (target.role === 'ADMIN' && (await otherActiveAdmins(tx, target.id)) === 0) {
        throw new AppError('CONFLICT', 'last_admin', '마지막 활성 관리자는 비활성화할 수 없습니다.');
      }
    }
    await tx.user.update({ where: { id: target.id }, data: { active } });
    const revoked = active ? 0 : await deleteSessionsOfUser(tx, target.id);
    await writeAudit(tx, {
      actorId: actor.id,
      action: active ? 'user.activate' : 'user.deactivate',
      entity: 'User',
      entityId: target.id,
      before: { active: target.active },
      after: { active, revokedSessions: revoked },
      meta,
    });
  });
}

export async function revokeUserSessions(actor: Actor, userId: string, meta: RequestMeta) {
  await prisma.$transaction(async (tx) => {
    await lockAdminChanges(tx, actor);
    const target = await findTarget(tx, userId);
    const revoked = await deleteSessionsOfUser(tx, target.id);
    await writeAudit(tx, {
      actorId: actor.id,
      action: 'user.sessions.revoke',
      entity: 'User',
      entityId: target.id,
      after: { revokedSessions: revoked },
      meta,
    });
  });
}

export async function unlockUser(actor: Actor, userId: string, meta: RequestMeta) {
  await prisma.$transaction(async (tx) => {
    await lockAdminChanges(tx, actor);
    const target = await findTarget(tx, userId);
    await tx.user.update({ where: { id: target.id }, data: { failedLogins: 0, lockedUntil: null } });
    await writeAudit(tx, {
      actorId: actor.id,
      action: 'user.unlock',
      entity: 'User',
      entityId: target.id,
      before: { failedLogins: target.failedLogins, lockedUntil: target.lockedUntil },
      after: { failedLogins: 0, lockedUntil: null },
      meta,
    });
  });
}

/** 18바이트 → base64url 24자. 화면에 한 번만 보여 주고 저장하지 않는다. */
export function generateTemporaryPassword(): string {
  return randomBytes(18).toString('base64url');
}

/**
 * 로컬 비밀번호가 있는 계정(admin)의 비밀번호를 임시값으로 초기화한다. 다른 ADMIN 만 할 수 있다.
 * 다음 로그인 때 변경을 강제하고, 잠금을 풀고, 세션을 모두 지운다.
 */
export async function resetUserPassword(actor: Actor, userId: string, meta: RequestMeta) {
  if (userId === actor.id) {
    throw new AppError('CONFLICT', 'self', '자기 비밀번호는 비밀번호 변경 화면에서 바꿔 주세요.');
  }
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  await prisma.$transaction(async (tx) => {
    await lockAdminChanges(tx, actor);
    const target = await findTarget(tx, userId);
    if (!target.passwordHash) {
      throw new AppError('CONFLICT', 'no_password', '비밀번호가 없는 계정입니다(구글 로그인 사용).');
    }
    await tx.user.update({
      where: { id: target.id },
      data: { passwordHash, mustChangePassword: true, failedLogins: 0, lockedUntil: null },
    });
    const revoked = await deleteSessionsOfUser(tx, target.id);
    await writeAudit(tx, {
      actorId: actor.id,
      action: 'user.password.reset',
      entity: 'User',
      entityId: target.id,
      after: { mustChangePassword: true, revokedSessions: revoked },
      meta,
    });
  });
  return { temporaryPassword };
}

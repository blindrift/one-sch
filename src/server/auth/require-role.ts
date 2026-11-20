import 'server-only';
import { forbidden, redirect } from 'next/navigation';
import type { Role as PrismaRole } from '@prisma/client';
import { hasRole, type Role } from '@/lib/roles';
import { AppError } from '../action-result';
import { writeAudit } from '../audit';
import { firstInWindow } from '../audit-throttle';
import { prisma } from '../db';
import { log } from '../log';
import { getRequestMeta } from '../request-meta';
import { getSessionUser, type SessionUser } from './current-user';

// lib/roles.ts 의 Role 과 Prisma enum 이 어긋나면 컴파일 오류가 나게 한다.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const rolesMatch: Same<Role, PrismaRole> = true;
void rolesMatch;

export type RequireOptions = {
  /** 비밀번호 변경이 강제된 상태에서도 허용(/change-password, changePassword, logout 전용) */
  allowPasswordChange?: boolean;
};

export const PASSWORD_CHANGE_REQUIRED = 'PASSWORD_CHANGE_REQUIRED';

/** 같은 사용자·같은 요구 역할의 거부는 분당 첫 1회만 감사 로그에, 나머지는 앱 로그에 남긴다. */
async function auditDenied(user: SessionUser, required: Role) {
  if (!firstInWindow(`authz.denied:${user.id}:${required}`)) {
    log.warn('authz.denied', { actorId: user.id, required, role: user.role });
    return;
  }
  try {
    await writeAudit(prisma, {
      actorId: user.id,
      action: 'authz.denied',
      after: { required, role: user.role },
      meta: await getRequestMeta(),
    });
  } catch (err) {
    log.error('authz.denied.audit_failed', { err });
  }
}

/**
 * 모든 Server Action·route handler 의 첫 문장. 세션 없음·비밀번호 변경 필요·권한 부족이면 AppError.
 * 비활성 사용자·만료 세션은 loadSession 이 이미 걸러 세션 없음으로 처리된다.
 */
export async function requireRole(minRole: Role, opts: RequireOptions = {}): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new AppError('UNAUTHENTICATED');
  if (user.mustChangePassword && !opts.allowPasswordChange) {
    throw new AppError('FORBIDDEN', PASSWORD_CHANGE_REQUIRED, '비밀번호를 먼저 변경해야 합니다.');
  }
  if (!hasRole(user.role, minRole)) {
    await auditDenied(user, minRole);
    throw new AppError('FORBIDDEN');
  }
  return user;
}

/**
 * 모든 route handler(auth·health 제외)의 첫 문장. 통과하면 사용자, 아니면 401/403 JSON 응답을 돌려준다.
 * 사용: `const auth = await requireApi('VIEWER'); if (auth instanceof Response) return auth;`
 */
export async function requireApi(minRole: Role, opts: RequireOptions = {}): Promise<SessionUser | Response> {
  try {
    return await requireRole(minRole, opts);
  } catch (err) {
    if (err instanceof AppError && (err.code === 'UNAUTHENTICATED' || err.code === 'FORBIDDEN')) {
      return Response.json(
        { ok: false, code: err.code, message: err.message },
        { status: err.code === 'UNAUTHENTICATED' ? 401 : 403, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    throw err;
  }
}

/** 모든 page.tsx 의 첫 문장. 로그인 화면·비밀번호 변경 화면으로 보내거나 403 을 낸다. */
export async function requirePage(minRole: Role, opts: RequireOptions = {}): Promise<SessionUser> {
  try {
    return await requireRole(minRole, opts);
  } catch (err) {
    if (err instanceof AppError) {
      if (err.code === 'UNAUTHENTICATED') redirect('/login');
      if (err.reason === PASSWORD_CHANGE_REQUIRED) redirect('/change-password');
      forbidden();
    }
    throw err;
  }
}

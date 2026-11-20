import 'server-only';
import { cookies } from 'next/headers';
import { cache } from 'react';
import type { Role } from '@/lib/roles';
import { sessionCookie } from './cookies';
import { loadSession } from './session';

export type SessionUser = {
  id: string;
  name: string;
  email: string | null;
  username: string | null;
  role: Role;
  mustChangePassword: boolean;
  /** 로컬 비밀번호가 있는 계정(admin)인지 */
  hasPassword: boolean;
  sessionId: string;
};

/** 요청당 한 번만 DB 를 조회한다. 세션 판정은 loadSession 이 한다. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const raw = (await cookies()).get(sessionCookie().name)?.value;
  const s = await loadSession(raw);
  if (!s) return null;
  const u = s.user;
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    username: u.username,
    role: u.role,
    mustChangePassword: u.mustChangePassword,
    hasPassword: u.passwordHash !== null,
    sessionId: s.id,
  };
});

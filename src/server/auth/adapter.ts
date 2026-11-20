import 'server-only';
import type { Adapter, AdapterAccount, AdapterSession, AdapterUser } from 'next-auth/adapters';
import type { User } from '@prisma/client';
import { prisma } from '../db';
import { log } from '../log';
import { getRequestMeta } from '../request-meta';
import { emailFromIdToken } from './google';
import { createSession, deleteSessionByToken, loadSession } from './session';

/** Auth.js 콜백·이벤트로 넘기는 사용자. passwordHash 같은 내부 필드는 넣지 않는다. */
export type OneschAdapterUser = AdapterUser & { role: User['role'] };

function toAdapterUser(u: User): OneschAdapterUser {
  return {
    id: u.id,
    // 로컬 전용 계정은 email 이 없다. Auth.js 는 구글 경로에서만 이 값을 쓴다.
    email: u.email ?? '',
    emailVerified: u.emailVerified,
    name: u.name,
    image: u.image,
    role: u.role,
  };
}

async function safeMeta() {
  try {
    return await getRequestMeta();
  } catch {
    return null;
  }
}

/**
 * Auth.js(구글 + database 세션) 전용 어댑터.
 * - 사용자 생성 금지: 관리자가 등록한 사용자만 로그인한다.
 * - 세션 토큰은 해시로 저장하고, 판정은 loadSession 하나로 한다.
 * - 구글 토큰(access/refresh/id)은 저장하지 않는다.
 */
export function createOneschAdapter(): Adapter {
  return {
    async createUser() {
      throw new Error('createUser is disabled: users must be registered by an admin');
    },
    async getUser(id) {
      const u = await prisma.user.findUnique({ where: { id } });
      return u ? toAdapterUser(u) : null;
    },
    async getUserByEmail(email) {
      const u = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
      return u ? toAdapterUser(u) : null;
    },
    async getUserByAccount({ provider, providerAccountId }) {
      const account = await prisma.account.findUnique({
        where: { provider_providerAccountId: { provider, providerAccountId } },
        include: { user: true },
      });
      return account ? toAdapterUser(account.user) : null;
    },
    async updateUser() {
      // OAuth 경로에서는 호출되지 않는다(이메일 provider 전용).
      throw new Error('updateUser is disabled');
    },
    async linkAccount(account: AdapterAccount) {
      // 이미 로그인된 세션이 있으면 Auth.js 는 그 세션 사용자에게 계정을 연결한다.
      // 다른 사람 세션에 구글 계정이 붙지 않도록 id_token 의 이메일과 대상 사용자 이메일이 같을 때만 연결한다.
      const user = await prisma.user.findUnique({ where: { id: account.userId } });
      const tokenEmail = emailFromIdToken(account.id_token);
      if (!user?.email || !tokenEmail || user.email !== tokenEmail) {
        log.warn('auth.link_account.rejected', { userId: account.userId, provider: account.provider });
        throw new Error('account link rejected: email mismatch');
      }
      await prisma.account.create({
        data: {
          userId: account.userId,
          type: account.type,
          provider: account.provider,
          providerAccountId: account.providerAccountId,
        },
      });
    },
    async createSession({ sessionToken, userId }) {
      const meta = await safeMeta();
      const { expires } = await createSession(prisma, {
        userId,
        rawToken: sessionToken,
        ip: meta?.ip,
        userAgent: meta?.userAgent,
      });
      // 쿠키에는 원본 토큰이 들어가야 하므로 원본을 돌려준다.
      return { sessionToken, userId, expires };
    },
    async getSessionAndUser(sessionToken) {
      const s = await loadSession(sessionToken);
      if (!s) return null;
      return { session: { sessionToken, userId: s.userId, expires: s.expires }, user: toAdapterUser(s.user) };
    },
    async updateSession() {
      // 만료 연장은 loadSession 이 한다(절대 7일 상한 포함).
      return null;
    },
    async deleteSession(sessionToken): Promise<AdapterSession | null> {
      const s = await deleteSessionByToken(sessionToken);
      return s ? { sessionToken, userId: s.userId, expires: s.expires } : null;
    },
  };
}

import 'server-only';
import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import { writeAudit } from '../audit';
import { prisma } from '../db';
import { log } from '../log';
import { getRequestMeta } from '../request-meta';
import { createOneschAdapter, type OneschAdapterUser } from './adapter';
import { SESSION_IDLE_SECONDS, SESSION_TOUCH_SECONDS, sessionCookie } from './cookies';
import { createGoogleSignInGuard } from './google';
import { newRawToken } from './session';

async function safeMeta() {
  try {
    return await getRequestMeta();
  } catch {
    return null;
  }
}

export const googleSignInGuard = createGoogleSignInGuard({
  findUserByEmail: (email) => prisma.user.findUnique({ where: { email }, select: { id: true, active: true } }),
  findUserByAccount: async (provider, providerAccountId) => {
    const account = await prisma.account.findUnique({
      where: { provider_providerAccountId: { provider, providerAccountId } },
      select: { user: { select: { id: true, active: true, email: true } } },
    });
    return account?.user ?? null;
  },
  recordDenied: async ({ email, reason }) => {
    await writeAudit(prisma, {
      action: 'auth.login.denied',
      entity: 'User',
      after: { provider: 'google', email, reason },
      meta: await safeMeta(),
    });
  },
});

const cookie = sessionCookie();

// 로컬 로그인(아이디·비밀번호)은 Auth.js 가 아니라 server/actions/auth.ts 가 같은 세션 테이블·쿠키로 처리한다.
export const { handlers, signIn, signOut } = NextAuth({
  adapter: createOneschAdapter(),
  session: {
    strategy: 'database',
    maxAge: SESSION_IDLE_SECONDS,
    updateAge: SESSION_TOUCH_SECONDS,
    generateSessionToken: newRawToken,
  },
  cookies: { sessionToken: { name: cookie.name, options: cookie.options } },
  providers: [
    // AUTH_GOOGLE_ID/SECRET 이 비어 있어도 기동은 된다(구글 로그인 버튼을 누를 때만 실패).
    Google({
      allowDangerousEmailAccountLinking: true,
      checks: ['pkce', 'state'],
      profile: (p) => ({
        id: p.sub,
        email: typeof p.email === 'string' ? p.email.trim().toLowerCase() : null,
        name: p.name,
        image: p.picture,
      }),
    }),
  ],
  pages: { signIn: '/login', error: '/login' },
  callbacks: {
    signIn: ({ account, profile }) => googleSignInGuard(account, profile),
    // /api/auth/session 으로 노출되므로 내부 필드를 넣지 않는다.
    session: ({ session, user }) => {
      const u = user as OneschAdapterUser;
      return { expires: session.expires, user: { id: u.id, name: u.name, email: u.email, role: u.role } } as never;
    },
  },
  events: {
    signIn: async ({ user, account }) => {
      if (!user.id) return;
      // 감사 기록이 실패해도 로그인은 이미 끝났다(세션 생성됨). 실패를 삼키지 않고 앱 로그에 남긴다.
      try {
        await prisma.$transaction(async (tx) => {
          await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
          await writeAudit(tx, {
            actorId: user.id,
            action: 'auth.login.success',
            entity: 'User',
            entityId: user.id,
            after: { provider: account?.provider ?? 'google' },
            meta: await safeMeta(),
          });
        });
      } catch (err) {
        log.error('auth.login.success.audit_failed', { userId: user.id, err });
      }
    },
    signOut: async (message) => {
      const session = 'session' in message ? message.session : null;
      if (!session?.userId) return;
      await writeAudit(prisma, {
        actorId: session.userId,
        action: 'auth.logout',
        entity: 'User',
        entityId: session.userId,
        meta: await safeMeta(),
      });
    },
  },
});

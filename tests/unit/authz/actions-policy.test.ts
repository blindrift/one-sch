/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hasRole, type Role } from '@/lib/roles';
import type { SessionUser } from '@/server/auth/current-user';
import { ACTION_POLICY, actionKey, PUBLIC_ACTIONS } from './policy';

// PUBLIC 은 정책 표에 적는 것만으로 모든 권한 검사를 건너뛰므로, 허용 목록을 테스트 안에 고정한다.
// 이 목록을 바꾸려면 보안 리뷰를 거친다.
const EXPECTED_PUBLIC = ['auth.loginWithPassword', 'auth.logout', 'auth.signInWithGoogle'];

// --- 경계 바깥을 모두 가짜로 바꾼다. 권한 검사 전에 DB 를 건드리면 바로 드러나게 한다. ---
const state = vi.hoisted(() => ({ user: null as SessionUser | null, dbAccess: [] as string[] }));
const authjs = vi.hoisted(() => ({ signIn: vi.fn(async () => {}), signOut: vi.fn(async () => {}) }));

vi.mock('@/server/auth/current-user', () => ({ getSessionUser: async () => state.user }));
vi.mock('@/server/db', () => ({
  prisma: new Proxy(
    {},
    {
      get(_t, prop) {
        state.dbAccess.push(String(prop));
        throw new Error(`DB accessed: ${String(prop)}`);
      },
    },
  ),
}));
vi.mock('@/server/audit', () => ({ writeAudit: vi.fn(async () => {}), diffFields: vi.fn() }));
vi.mock('@/server/request-meta', () => ({ getRequestMeta: async () => ({ ip: '1.2.3.4', userAgent: null }) }));
vi.mock('@/server/auth/config', () => ({ signIn: authjs.signIn, signOut: authjs.signOut, handlers: {} }));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined, set: vi.fn() }),
  headers: async () => new Headers(),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const modules = import.meta.glob<Record<string, unknown>>('/src/server/actions/**/*.{ts,tsx}', { eager: true });

type Action = (...args: unknown[]) => Promise<unknown>;

const actions: Array<[string, Action]> = Object.entries(modules).flatMap(([path, mod]) => {
  const rel = path.replace(/^\/src\/server\/actions\//, '');
  return Object.entries(mod).map(([name, fn]) => [actionKey(rel, name), fn as Action] as [string, Action]);
});

function user(role: Role, mustChangePassword = false): SessionUser {
  return {
    id: '3f1c2b9e-8d4a-4c3b-9a2e-1f0e5d6c7b8a',
    name: 'u',
    email: 'u@example.com',
    username: null,
    role,
    mustChangePassword,
    hasPassword: true,
    sessionId: 's',
  };
}

const SESSIONS: Array<[string, SessionUser | null]> = [
  ['무세션', null],
  ['VIEWER', user('VIEWER')],
  ['MEMBER', user('MEMBER')],
  ['ADMIN(비밀번호 변경 필요)', user('ADMIN', true)],
  ['ADMIN', user('ADMIN')],
];

function expectedCode(policy: { min: Role; allowPasswordChange?: boolean }, u: SessionUser | null) {
  if (!u) return 'UNAUTHENTICATED';
  if (u.mustChangePassword && !policy.allowPasswordChange) return 'FORBIDDEN';
  if (!hasRole(u.role, policy.min)) return 'FORBIDDEN';
  // 권한을 통과하면 빈 입력이므로 검증에서 멈춰야 한다(권한 검사가 검증보다 먼저).
  return 'VALIDATION';
}

const savedLocalLogin = process.env.LOCAL_LOGIN_ENABLED;

beforeEach(() => {
  state.user = null;
  state.dbAccess = [];
  authjs.signIn.mockClear();
  authjs.signOut.mockClear();
});
afterEach(() => {
  process.env.LOCAL_LOGIN_ENABLED = savedLocalLogin;
});

describe('Server Action 권한 정책', () => {
  it('액션 파일을 찾았다', () => {
    expect(actions.length).toBeGreaterThan(0);
  });

  it('모든 export 가 정책 표에 있고, 표의 항목은 모두 export 다', () => {
    const exported = actions.map(([k]) => k).sort();
    expect(exported).toEqual(Object.keys(ACTION_POLICY).sort());
  });

  it('PUBLIC 액션은 고정된 3개뿐이다', () => {
    expect([...PUBLIC_ACTIONS].sort()).toEqual([...EXPECTED_PUBLIC].sort());
  });

  for (const [key, fn] of actions) {
    const policy = ACTION_POLICY[key];
    if (!policy || policy.min === 'PUBLIC') continue;

    for (const [label, sessionUser] of SESSIONS) {
      const expected = expectedCode(policy, sessionUser);
      it(`${key} / ${label} → ${expected}, 검사 전 DB 접근 없음`, async () => {
        state.user = sessionUser;
        // (input) 형식과 (prevState, formData) 형식 모두 빈 입력이 되게 호출한다.
        const result = (await fn({}, new FormData())) as { ok: boolean; code?: string };
        expect(result).toMatchObject({ ok: false, code: expected });
        expect(state.dbAccess).toEqual([]);
      });
    }
  }
});

describe('PUBLIC 액션도 무세션에서 DB 를 먼저 건드리지 않는다', () => {
  const byKey = new Map(actions);

  it('loginWithPassword: 로컬 로그인이 꺼져 있으면 FORBIDDEN, DB 접근 0', async () => {
    process.env.LOCAL_LOGIN_ENABLED = 'false';
    const fd = new FormData();
    fd.set('username', 'admin');
    fd.set('password', 'admin');
    const r = await byKey.get('auth.loginWithPassword')!(null, fd);
    expect(r).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(state.dbAccess).toEqual([]);
  });

  it('loginWithPassword: 빈 입력은 DB 접근 없이 실패', async () => {
    process.env.LOCAL_LOGIN_ENABLED = 'true';
    const r = await byKey.get('auth.loginWithPassword')!(null, new FormData());
    expect(r).toMatchObject({ ok: false, code: 'UNAUTHENTICATED' });
    expect(state.dbAccess).toEqual([]);
  });

  it('logout: Auth.js signOut 에 위임하고 직접 DB 를 건드리지 않는다', async () => {
    await byKey.get('auth.logout')!();
    expect(authjs.signOut).toHaveBeenCalledWith({ redirectTo: '/login' });
    expect(state.dbAccess).toEqual([]);
  });

  it('signInWithGoogle: 외부 callbackUrl 은 기본값으로 바꿔 Auth.js 에 위임', async () => {
    const fd = new FormData();
    fd.set('callbackUrl', '//evil.example');
    await byKey.get('auth.signInWithGoogle')!(fd);
    expect(authjs.signIn).toHaveBeenCalledWith('google', { redirectTo: '/timeline' });
    expect(state.dbAccess).toEqual([]);
  });
});

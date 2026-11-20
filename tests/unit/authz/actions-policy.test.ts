/// <reference types="vite/client" />
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hasRole, type Role } from '@/lib/roles';
import type { SessionUser } from '@/server/auth/current-user';
import { ACTION_POLICY } from './policy';

// --- 경계 바깥을 모두 가짜로 바꾼다. 권한 검사 전에 DB 를 건드리면 바로 드러나게 한다. ---
const state = vi.hoisted(() => ({ user: null as SessionUser | null, dbAccess: [] as string[] }));

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
vi.mock('@/server/auth/config', () => ({ signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined, set: vi.fn() }),
  headers: async () => new Headers(),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const modules = import.meta.glob<Record<string, unknown>>('/src/server/actions/**/*.ts', { eager: true });

type Action = (...args: unknown[]) => Promise<unknown>;

const actions: Array<[string, Action]> = Object.entries(modules).flatMap(([path, mod]) => {
  const file = path.split('/').pop()!.replace(/\.ts$/, '');
  return Object.entries(mod).map(([name, fn]) => [`${file}.${name}`, fn as Action] as [string, Action]);
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

beforeEach(() => {
  state.user = null;
  state.dbAccess = [];
});

describe('Server Action 권한 정책', () => {
  it('액션 파일을 찾았다', () => {
    expect(actions.length).toBeGreaterThan(0);
  });

  it('모든 export 가 정책 표에 있고, 표의 항목은 모두 export 다', () => {
    const exported = actions.map(([k]) => k).sort();
    expect(exported).toEqual(Object.keys(ACTION_POLICY).sort());
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

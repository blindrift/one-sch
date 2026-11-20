import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionUser } from '@/server/auth/current-user';

const state = vi.hoisted(() => ({ user: null as SessionUser | null }));
const writeAudit = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('@/server/auth/current-user', () => ({ getSessionUser: async () => state.user }));
vi.mock('@/server/audit', () => ({ writeAudit }));
vi.mock('@/server/db', () => ({ prisma: {} }));
vi.mock('@/server/request-meta', () => ({ getRequestMeta: async () => ({ ip: '1.2.3.4', userAgent: null }) }));

const { requireApi, requirePage, requireRole, PASSWORD_CHANGE_REQUIRED } = await import('@/server/auth/require-role');
const { AppError } = await import('@/server/action-result');

function user(role: SessionUser['role'], extra: Partial<SessionUser> = {}): SessionUser {
  return {
    id: 'u1',
    name: 'u',
    email: 'u@example.com',
    username: null,
    role,
    mustChangePassword: false,
    hasPassword: false,
    sessionId: 's1',
    ...extra,
  };
}

async function codeOf(p: Promise<unknown>) {
  try {
    await p;
    return 'OK';
  } catch (e) {
    if (e instanceof AppError) return e.reason ? `${e.code}:${e.reason}` : e.code;
    throw e;
  }
}

/** Next 의 redirect/forbidden 예외 digest */
async function digestOf(p: Promise<unknown>) {
  try {
    await p;
    return 'OK';
  } catch (e) {
    return (e as { digest?: string }).digest ?? String(e);
  }
}

beforeEach(() => {
  state.user = null;
  writeAudit.mockClear();
});

describe('requireRole', () => {
  it('세션 없음 → UNAUTHENTICATED', async () => {
    expect(await codeOf(requireRole('VIEWER'))).toBe('UNAUTHENTICATED');
  });

  it('역할 계층대로 허용·거부', async () => {
    state.user = user('VIEWER');
    expect(await codeOf(requireRole('VIEWER'))).toBe('OK');
    expect(await codeOf(requireRole('MEMBER'))).toBe('FORBIDDEN');
    state.user = user('MEMBER');
    expect(await codeOf(requireRole('MEMBER'))).toBe('OK');
    expect(await codeOf(requireRole('ADMIN'))).toBe('FORBIDDEN');
    state.user = user('ADMIN');
    expect(await codeOf(requireRole('ADMIN'))).toBe('OK');
  });

  it('권한 부족은 authz.denied 감사', async () => {
    state.user = user('VIEWER');
    await codeOf(requireRole('ADMIN'));
    expect(writeAudit).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ actorId: 'u1', action: 'authz.denied', after: { required: 'ADMIN', role: 'VIEWER' } }),
    );
  });

  it('비밀번호 변경 필요 시 ADMIN 이라도 거부, allowPasswordChange 면 허용', async () => {
    state.user = user('ADMIN', { mustChangePassword: true });
    expect(await codeOf(requireRole('VIEWER'))).toBe(`FORBIDDEN:${PASSWORD_CHANGE_REQUIRED}`);
    expect(await codeOf(requireRole('VIEWER', { allowPasswordChange: true }))).toBe('OK');
  });
});

describe('requirePage', () => {
  it('세션 없음 → /login 리디렉션', async () => {
    expect(await digestOf(requirePage('VIEWER'))).toMatch(/^NEXT_REDIRECT;.*;\/login;/);
  });

  it('비밀번호 변경 필요 → /change-password', async () => {
    state.user = user('ADMIN', { mustChangePassword: true });
    expect(await digestOf(requirePage('VIEWER'))).toMatch(/^NEXT_REDIRECT;.*;\/change-password;/);
  });

  it('권한 부족 → 403', async () => {
    state.user = user('VIEWER');
    expect(await digestOf(requirePage('ADMIN'))).toBe('NEXT_HTTP_ERROR_FALLBACK;403');
  });

  it('충족하면 사용자 반환', async () => {
    state.user = user('ADMIN');
    await expect(requirePage('ADMIN')).resolves.toMatchObject({ id: 'u1' });
  });
});

describe('requireApi', () => {
  it('세션 없음 → 401 JSON', async () => {
    const r = await requireApi('VIEWER');
    expect(r).toBeInstanceOf(Response);
    const res = r as Response;
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ ok: false, code: 'UNAUTHENTICATED' });
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('권한 부족·비밀번호 변경 필요 → 403 JSON', async () => {
    state.user = user('VIEWER');
    expect(((await requireApi('ADMIN')) as Response).status).toBe(403);
    state.user = user('ADMIN', { mustChangePassword: true });
    expect(((await requireApi('VIEWER')) as Response).status).toBe(403);
  });

  it('충족하면 사용자', async () => {
    state.user = user('MEMBER');
    expect(await requireApi('MEMBER')).toMatchObject({ id: 'u1' });
  });
});

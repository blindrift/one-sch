import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionUser } from '@/server/auth/current-user';

const state = vi.hoisted(() => ({ user: null as SessionUser | null }));
const writeAudit = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('@/server/auth/current-user', () => ({ getSessionUser: async () => state.user }));
vi.mock('@/server/audit', () => ({ writeAudit }));
vi.mock('@/server/db', () => ({ prisma: {} }));
vi.mock('@/server/request-meta', () => ({ getRequestMeta: async () => ({ ip: '1.2.3.4', userAgent: null }) }));

const { withApi, requirePage, requireRole, PASSWORD_CHANGE_REQUIRED } = await import('@/server/auth/require-role');
const { AppError } = await import('@/server/action-result');
const { resetAuditThrottle } = await import('@/server/audit-throttle');

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
  resetAuditThrottle();
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

  it('같은 사용자의 반복 거부는 분당 1회만 감사, 세션 없음은 감사하지 않음', async () => {
    await codeOf(requireRole('ADMIN'));
    expect(writeAudit).not.toHaveBeenCalled();
    state.user = user('VIEWER');
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    for (let i = 0; i < 5; i++) await codeOf(requireRole('ADMIN'));
    spy.mockRestore();
    expect(writeAudit).toHaveBeenCalledTimes(1);
    // 요구 역할이 다르면 따로 센다
    await codeOf(requireRole('MEMBER'));
    expect(writeAudit).toHaveBeenCalledTimes(2);
  });

  it('감사 기록이 실패해도 FORBIDDEN 으로 끝난다', async () => {
    state.user = user('VIEWER');
    writeAudit.mockRejectedValueOnce(new Error('db down'));
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    expect(await codeOf(requireRole('ADMIN'))).toBe('FORBIDDEN');
    spy.mockRestore();
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

describe('withApi', () => {
  const handler = vi.fn(async (_req: Request, _ctx: unknown, u: { id: string }) => Response.json({ hello: u.id }));
  const route = withApi('MEMBER', handler);
  const call = () => route(new Request('http://localhost/api/x'), {});

  beforeEach(() => {
    handler.mockClear();
  });

  it('세션 없음 → 401 JSON(no-store), handler 미실행', async () => {
    const res = await call();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, code: 'UNAUTHENTICATED', message: '로그인이 필요합니다.' });
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(handler).not.toHaveBeenCalled();
  });

  it('역할 부족 → 403, handler 미실행', async () => {
    state.user = user('VIEWER');
    const res = await call();
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'FORBIDDEN' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('비밀번호 변경 필요 → 403(ADMIN 이라도), handler 미실행', async () => {
    state.user = user('ADMIN', { mustChangePassword: true });
    const res = await call();
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'FORBIDDEN', message: '비밀번호를 먼저 변경해야 합니다.' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('allowPasswordChange 옵션이면 변경 필요 상태도 통과', async () => {
    state.user = user('ADMIN', { mustChangePassword: true });
    const res = await withApi('VIEWER', handler, { allowPasswordChange: true })(new Request('http://localhost/'), {});
    expect(res.status).toBe(200);
  });

  it('충족하면 사용자와 함께 handler 실행', async () => {
    state.user = user('MEMBER');
    const res = await call();
    expect(await res.json()).toEqual({ hello: 'u1' });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][2]).toMatchObject({ id: 'u1', role: 'MEMBER' });
  });

  it('handler 의 AppError 는 코드별 상태로, INTERNAL 은 일반 문구 500(H8)', async () => {
    state.user = user('MEMBER');
    const cases: Array<[string, number]> = [
      ['VALIDATION', 400],
      ['UNAUTHENTICATED', 401],
      ['FORBIDDEN', 403],
      ['NOT_FOUND', 404],
      ['CONFLICT', 409],
      ['RATE_LIMITED', 429],
    ];
    for (const [code, status] of cases) {
      const r = withApi('MEMBER', async () => {
        throw new AppError(code as never, 'why', `msg-${code}`);
      });
      const res = await r(new Request('http://localhost/'), {});
      expect(res.status, code).toBe(status);
      expect(await res.json()).toEqual({ ok: false, code, message: `msg-${code}` });
      expect(res.headers.get('cache-control')).toBe('no-store');
    }
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const internal = await withApi('MEMBER', async () => {
      throw new AppError('INTERNAL', 'db', 'connect ECONNREFUSED password=hunter2');
    })(new Request('http://localhost/'), {});
    spy.mockRestore();
    expect(internal.status).toBe(500);
    expect(await internal.json()).toEqual({ ok: false, code: 'INTERNAL', message: '처리 중 오류가 발생했습니다.' });
  });

  it('handler 의 ZodError·fieldErrors 는 400 과 필드 오류', async () => {
    state.user = user('MEMBER');
    const { z } = await import('zod');
    const res = await withApi('MEMBER', async () => {
      z.object({ name: z.string().min(1) }).parse({ name: '' });
      return Response.json({});
    })(new Request('http://localhost/'), {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(body.fieldErrors.name).toHaveLength(1);
    const conflict = await withApi('MEMBER', async () => {
      throw new AppError('CONFLICT', 'dup', '이미 있음', { email: ['이미 등록된 이메일입니다.'] });
    })(new Request('http://localhost/'), {});
    expect(await conflict.json()).toEqual({ ok: false, code: 'CONFLICT', message: '이미 있음', fieldErrors: { email: ['이미 등록된 이메일입니다.'] } });
  });

  it('권한 외 오류(예: DB 오류)는 응답으로 감추지 않고 그대로 던진다', async () => {
    state.user = user('MEMBER');
    const boom = withApi('MEMBER', async () => {
      throw new Error('boom');
    });
    await expect(boom(new Request('http://localhost/'), {})).rejects.toThrow('boom');
  });
});

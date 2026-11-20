import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/server/db';
import {
  createSession,
  deleteSessionsOfUser,
  hashToken,
  loadSession,
} from '@/server/auth/session';
import { createOneschAdapter } from '@/server/auth/adapter';
import { disconnectAll, resetDb } from '../helpers/db';

const H = 60 * 60 * 1000;
const D = 24 * H;

async function makeUser(data: Partial<{ email: string; active: boolean }> = {}) {
  return prisma.user.create({ data: { email: data.email ?? 'u@example.com', name: 'u', active: data.active ?? true } });
}

beforeEach(resetDb);
afterAll(async () => {
  await prisma.$disconnect();
  await disconnectAll();
});

describe('session', () => {
  it('토큰은 해시로만 저장된다', async () => {
    const u = await makeUser();
    const { rawToken } = await createSession(prisma, { userId: u.id });
    const rows = await prisma.session.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].sessionToken).toBe(hashToken(rawToken));
    expect(rows[0].sessionToken).not.toContain(rawToken);
  });

  it('정상 세션은 사용자와 함께 돌려준다', async () => {
    const u = await makeUser();
    const { rawToken } = await createSession(prisma, { userId: u.id });
    const s = await loadSession(rawToken);
    expect(s?.user.id).toBe(u.id);
    expect(await loadSession('wrong')).toBeNull();
    expect(await loadSession('x'.repeat(300))).toBeNull();
  });

  it('유휴 8시간이 지나면 삭제', async () => {
    const u = await makeUser();
    const t0 = new Date('2026-01-01T00:00:00Z');
    const { rawToken } = await createSession(prisma, { userId: u.id, now: t0 });
    expect(await loadSession(rawToken, new Date(t0.getTime() + 8 * H + 1))).toBeNull();
    expect(await prisma.session.count()).toBe(0);
  });

  it('5분 간격으로만 갱신하고, 갱신해도 7일을 넘지 않는다', async () => {
    const u = await makeUser();
    const t0 = new Date('2026-01-01T00:00:00Z');
    const { rawToken } = await createSession(prisma, { userId: u.id, now: t0 });

    // 4분 뒤: 갱신 안 함
    await loadSession(rawToken, new Date(t0.getTime() + 4 * 60 * 1000));
    let row = await prisma.session.findFirstOrThrow();
    expect(row.lastSeenAt.getTime()).toBe(t0.getTime());

    // 6분 뒤: 갱신
    const t1 = new Date(t0.getTime() + 6 * 60 * 1000);
    await loadSession(rawToken, t1);
    row = await prisma.session.findFirstOrThrow();
    expect(row.lastSeenAt.getTime()).toBe(t1.getTime());
    expect(row.expires.getTime()).toBe(t1.getTime() + 8 * H);

    // 7시간 간격으로 계속 쓰면 7일째에 끝난다
    let t = t1.getTime();
    while (t < t0.getTime() + 7 * D - 7 * H) {
      t += 7 * H;
      expect(await loadSession(rawToken, new Date(t))).not.toBeNull();
    }
    row = await prisma.session.findFirstOrThrow();
    expect(row.expires.getTime()).toBeLessThanOrEqual(t0.getTime() + 7 * D);
    expect(await loadSession(rawToken, new Date(t0.getTime() + 7 * D))).toBeNull();
  });

  it('비활성 사용자의 세션은 삭제', async () => {
    const u = await makeUser();
    const { rawToken } = await createSession(prisma, { userId: u.id });
    await prisma.user.update({ where: { id: u.id }, data: { active: false } });
    expect(await loadSession(rawToken)).toBeNull();
    expect(await prisma.session.count()).toBe(0);
  });

  it('로컬 로그인을 끄면 로컬 전용 계정 세션은 무효, 구글 계정 세션은 유지(SEC-5)', async () => {
    const local = await prisma.user.create({ data: { username: 'admin', name: 'a', passwordHash: 'x' } });
    const google = await makeUser({ email: 'g@example.com' });
    const l = await createSession(prisma, { userId: local.id });
    const g = await createSession(prisma, { userId: google.id });
    vi.stubEnv('LOCAL_LOGIN_ENABLED', 'false');
    try {
      expect(await loadSession(l.rawToken)).toBeNull();
      expect(await prisma.session.count({ where: { userId: local.id } })).toBe(0);
      expect((await loadSession(g.rawToken))?.user.id).toBe(google.id);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('deleteSessionsOfUser 는 그 사용자 세션만 지운다', async () => {
    const a = await makeUser({ email: 'a@example.com' });
    const b = await makeUser({ email: 'b@example.com' });
    await createSession(prisma, { userId: a.id });
    await createSession(prisma, { userId: a.id });
    await createSession(prisma, { userId: b.id });
    expect(await deleteSessionsOfUser(prisma, a.id)).toBe(2);
    expect(await prisma.session.count()).toBe(1);
  });
});

describe('adapter', () => {
  const adapter = createOneschAdapter();

  it('createUser 는 항상 실패', async () => {
    await expect(adapter.createUser!({ id: 'x', email: 'n@example.com', emailVerified: null })).rejects.toThrow(
      'createUser is disabled',
    );
    expect(await prisma.user.count()).toBe(0);
  });

  it('getUserByEmail(대소문자 무시)·getUserByAccount 는 내부 필드 없이 돌려준다', async () => {
    const u = await prisma.user.create({ data: { email: 'a@example.com', name: 'a', passwordHash: 'h', role: 'MEMBER' } });
    await prisma.account.create({ data: { userId: u.id, type: 'oidc', provider: 'google', providerAccountId: 'sub-1' } });
    const byEmail = await adapter.getUserByEmail!('A@Example.com');
    expect(byEmail).toEqual({ id: u.id, email: 'a@example.com', emailVerified: null, name: 'a', image: null, role: 'MEMBER' });
    expect(await adapter.getUserByAccount!({ provider: 'google', providerAccountId: 'sub-1' })).toEqual(byEmail);
    expect(await adapter.getUserByAccount!({ provider: 'google', providerAccountId: 'nope' })).toBeNull();
    expect(await adapter.getUserByEmail!('nobody@example.com')).toBeNull();
  });

  it('updateSession 은 아무것도 바꾸지 않는다(연장은 loadSession 이 담당)', async () => {
    const u = await makeUser();
    await adapter.createSession!({ sessionToken: 'raw-token-3', userId: u.id, expires: new Date() });
    const before = await prisma.session.findFirstOrThrow();
    expect(await adapter.updateSession!({ sessionToken: 'raw-token-3', expires: new Date(Date.now() + 30 * 86400_000) })).toBeNull();
    const after = await prisma.session.findFirstOrThrow();
    expect(after.expires.getTime()).toBe(before.expires.getTime());
  });

  it('createSession 은 평문을 돌려주고 DB 에는 해시', async () => {
    const u = await makeUser();
    const s = await adapter.createSession!({ sessionToken: 'raw-token-1', userId: u.id, expires: new Date() });
    expect(s.sessionToken).toBe('raw-token-1');
    const row = await prisma.session.findFirstOrThrow();
    expect(row.sessionToken).toBe(hashToken('raw-token-1'));
    const got = await adapter.getSessionAndUser!('raw-token-1');
    expect(got?.user.id).toBe(u.id);
    expect(got?.user).not.toHaveProperty('passwordHash');
  });

  it('deleteSession 은 해시로 찾아 지운다', async () => {
    const u = await makeUser();
    await adapter.createSession!({ sessionToken: 'raw-token-2', userId: u.id, expires: new Date() });
    const deleted = await adapter.deleteSession!('raw-token-2');
    expect(deleted).toMatchObject({ userId: u.id });
    expect(await prisma.session.count()).toBe(0);
  });

  it('linkAccount 는 id_token 이메일이 사용자 이메일과 같을 때만, 토큰은 저장하지 않는다', async () => {
    const u = await makeUser({ email: 'a@example.com' });
    const idToken = (email: string) => `h.${Buffer.from(JSON.stringify({ email })).toString('base64url')}.s`;
    const base = { userId: u.id, type: 'oidc' as const, provider: 'google', providerAccountId: 'g-1' };

    await expect(adapter.linkAccount!({ ...base, id_token: idToken('other@example.com') })).rejects.toThrow('email mismatch');
    await expect(adapter.linkAccount!({ ...base })).rejects.toThrow('email mismatch');
    expect(await prisma.account.count()).toBe(0);

    await adapter.linkAccount!({ ...base, id_token: idToken('A@example.com'), access_token: 'at', refresh_token: 'rt' });
    const acc = await prisma.account.findFirstOrThrow();
    expect(acc.providerAccountId).toBe('g-1');
    expect(acc.access_token).toBeNull();
    expect(acc.refresh_token).toBeNull();
    expect(acc.id_token).toBeNull();
  });

  it('로컬 전용 계정(email 없음)에는 구글 계정을 연결하지 않는다', async () => {
    const admin = await prisma.user.create({ data: { username: 'admin', name: 'a' } });
    const idToken = `h.${Buffer.from(JSON.stringify({ email: 'a@example.com' })).toString('base64url')}.s`;
    await expect(
      adapter.linkAccount!({ userId: admin.id, type: 'oidc', provider: 'google', providerAccountId: 'g', id_token: idToken }),
    ).rejects.toThrow('email mismatch');
  });
});

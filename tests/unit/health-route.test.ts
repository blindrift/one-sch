import { describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ $queryRaw: vi.fn() }));
vi.mock('@/server/db', () => ({ prisma: db }));

const { GET } = await import('@/app/api/health/route');

describe('/api/health', () => {
  it('DB 가 응답하면 200 {"status":"ok"}', async () => {
    db.$queryRaw.mockResolvedValueOnce([{ '?column?': 1 }]);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('{"status":"ok"}');
  });

  it('DB 오류면 503 {"status":"error"}, 오류 상세는 응답에 없고 로그에만', async () => {
    db.$queryRaw.mockRejectedValueOnce(new Error('connect ECONNREFUSED 10.0.0.5:5432 password=hunter2'));
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const res = await GET();
    const logged = spy.mock.calls.map((c) => String(c[0])).join('');
    spy.mockRestore();
    expect(res.status).toBe(503);
    expect(await res.text()).toBe('{"status":"error"}');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(logged).toContain('health.db_error');
  });
});

import { describe, expect, it } from 'vitest';
import { GET } from '@/app/api/health/route';

describe('/api/health', () => {
  it('DB 가 되면 200 {"status":"ok"} 만', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('{"status":"ok"}');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});

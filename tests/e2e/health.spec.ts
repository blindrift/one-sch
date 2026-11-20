import { expect, test } from './fixtures';

test('/api/health 는 인증 없이 정확히 {"status":"ok"}', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.status()).toBe(200);
  expect(await res.text()).toBe('{"status":"ok"}');
});

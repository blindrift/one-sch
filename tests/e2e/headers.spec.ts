import { collectCspViolations, expect, formError, gotoReady, injectSession, ownerDb, resetAndSeed, test } from './fixtures';

test('CSP nonce 는 요청마다 다르고 script 태그 nonce 와 같다', async ({ request }) => {
  const nonces: string[] = [];
  for (let i = 0; i < 2; i++) {
    const res = await request.get('/login');
    const csp = res.headers()['content-security-policy'];
    expect(csp).toContain("'strict-dynamic'");
    expect(csp).not.toContain('unsafe-eval');
    const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
    expect(nonce).toBeTruthy();
    expect(await res.text()).toContain(`nonce="${nonce}"`);
    nonces.push(nonce!);

    const h = res.headers();
    expect(h['x-frame-options']).toBe('DENY');
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(h['permissions-policy']).toBe('camera=(), microphone=(), geolocation=()');
    // http 이므로 HSTS 없음
    expect(h['strict-transport-security']).toBeUndefined();
    expect(h['x-powered-by']).toBeUndefined();
  }
  expect(nonces[0]).not.toBe(nonces[1]);
});

test.beforeAll(resetAndSeed);

test('로그인 화면에서 CSP 위반이 없다', async ({ page }) => {
  const violations = collectCspViolations(page);
  await gotoReady(page, '/login');
  await expect(page.getByLabel('아이디')).toBeVisible();
  // 하이드레이션이 끝나 폼이 동작하는지(스크립트가 실행됐는지)
  await page.getByLabel('아이디').fill('x');
  await page.getByLabel('비밀번호').fill('y');
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await expect(formError(page, 'login-error')).toBeVisible();
  expect(violations).toEqual([]);
});

test('로그인한 상태의 화면(관리·타임라인)에서도 CSP 위반이 없다', async ({ page, context }) => {
  const admin = await ownerDb.user.create({ data: { email: 'csp@example.com', name: 'csp', role: 'ADMIN' } });
  await injectSession(context, admin.id);
  const violations = collectCspViolations(page);
  for (const path of ['/timeline', '/admin/users']) {
    await gotoReady(page, path);
  }
  await page.getByRole('button', { name: '사용자 등록' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(violations).toEqual([]);
});

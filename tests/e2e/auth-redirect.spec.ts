import { expect, resetAndSeed, test } from './fixtures';

test.beforeAll(resetAndSeed);

test('비로그인으로 보호 화면에 가면 callbackUrl 을 달고 로그인 화면으로 간다', async ({ page }) => {
  await page.goto('/timeline');
  await expect(page).toHaveURL(/\/login\?callbackUrl=%2Ftimeline$/);
  await page.goto('/admin/users');
  await expect(page).toHaveURL(/\/login\?callbackUrl=%2Fadmin%2Fusers$/);
  await expect(page.getByText('one-sch 로그인')).toBeVisible();
});

test('유효하지 않은 세션 쿠키로는 보호 화면을 볼 수 없다', async ({ page, context }) => {
  await context.addCookies([{ name: 'authjs.session-token', value: 'forged', domain: 'localhost', path: '/' }]);
  await page.goto('/timeline');
  await expect(page).toHaveURL(/\/login/);
});

import { auditActions, COOKIE, expect, login, NEW_PASSWORD, resetAndSeed, test } from './fixtures';

test.beforeAll(resetAndSeed);

test('admin/admin 첫 로그인 → 변경 강제 → 변경 후 정상 → 로그아웃 후 이전 쿠키 무효', async ({ page, context }) => {
  await login(page, 'admin', 'admin');
  await expect(page).toHaveURL(/\/change-password$/);

  // 변경 전에는 다른 화면으로 가도 되돌아온다
  for (const path of ['/timeline', '/admin/users']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/change-password$/);
  }

  // 정책 위반
  await page.getByLabel('현재 비밀번호').fill('admin');
  await page.getByLabel('새 비밀번호', { exact: true }).fill('my-admin-secret');
  await page.getByLabel('새 비밀번호 확인').fill('my-admin-secret');
  await page.getByRole('button', { name: '변경' }).click();
  await expect(page.getByText("'admin' 을 포함할 수 없습니다.")).toBeVisible();
  await expect(page).toHaveURL(/\/change-password$/);

  // 성공
  await page.getByLabel('현재 비밀번호').fill('admin');
  await page.getByLabel('새 비밀번호', { exact: true }).fill(NEW_PASSWORD);
  await page.getByLabel('새 비밀번호 확인').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: '변경' }).click();
  await expect(page).toHaveURL(/\/timeline$/);
  await expect(page.getByRole('heading', { name: '전체 타임라인' })).toBeVisible();
  await page.goto('/admin/users');
  await expect(page.getByRole('heading', { name: '사용자 관리' })).toBeVisible();

  // 로그아웃 후 이전 쿠키를 다시 넣어도 들어갈 수 없다
  const oldCookie = (await context.cookies()).find((c) => c.name === COOKIE);
  expect(oldCookie).toBeDefined();
  await page.getByRole('button', { name: '로그아웃' }).click();
  await expect(page).toHaveURL(/\/login/);
  await context.addCookies([oldCookie!]);
  await page.goto('/timeline');
  await expect(page).toHaveURL(/\/login/);

  // 새 비밀번호로 다시 로그인하면 바로 타임라인
  await login(page, 'admin', NEW_PASSWORD);
  await expect(page).toHaveURL(/\/timeline$/);

  const actions = await auditActions();
  expect(actions).toEqual(
    expect.arrayContaining(['user.seed_admin', 'auth.login.success', 'auth.password.change', 'auth.logout']),
  );
});

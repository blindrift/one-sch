import { INVALID, auditActions, expect, formError, login, resetAndSeed, test } from './fixtures';

test.beforeAll(resetAndSeed);

test('같은 IP 에서 1분에 10회를 넘으면 11번째는 RATE_LIMITED', async ({ page }) => {
  for (let i = 0; i < 10; i++) {
    await login(page, `nobody${i}`, 'x');
    await expect(formError(page)).toHaveText(INVALID);
  }
  await login(page, 'admin', 'admin');
  await expect(formError(page)).toHaveText('요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.');
  expect(await auditActions()).toContain('auth.login.rate_limited');
});

test('다른 IP 는 영향을 받지 않는다', async ({ page }) => {
  // fixtures 가 테스트마다 다른 X-Real-IP 를 준다
  await login(page, 'admin', 'admin');
  await expect(page).toHaveURL(/\/change-password$/);
});

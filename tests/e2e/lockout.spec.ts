import { INVALID, auditActions, expect, formError, login, ownerDb, resetAndSeed, test } from './fixtures';

test.beforeAll(resetAndSeed);

test('5회 실패 후에는 올바른 비밀번호도 같은 문구로 실패한다', async ({ page }) => {
  for (let i = 0; i < 5; i++) {
    await login(page, 'admin', `wrong-${i}`);
    await expect(formError(page, 'login-error')).toHaveText(INVALID);
  }
  await login(page, 'admin', 'admin');
  await expect(formError(page, 'login-error')).toHaveText(INVALID);
  await expect(page).toHaveURL(/\/login/);

  // 없는 계정도 같은 문구
  await login(page, 'nobody', 'admin');
  await expect(formError(page, 'login-error')).toHaveText(INVALID);

  const admin = await ownerDb.user.findUniqueOrThrow({ where: { username: 'admin' } });
  expect(admin.lockedUntil).not.toBeNull();
  expect(admin.lockedUntil!.getTime()).toBeGreaterThan(Date.now() + 14 * 60 * 1000);

  const actions = await auditActions();
  expect(actions).toEqual(expect.arrayContaining(['auth.login.failure', 'auth.lock', 'auth.login.locked']));
});

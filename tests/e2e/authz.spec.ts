import { auditActions, expect, injectSession, ownerDb, resetAndSeed, test } from './fixtures';

test.beforeAll(resetAndSeed);

test('VIEWER 는 /admin/users 에서 403', async ({ page, context }) => {
  const viewer = await ownerDb.user.create({ data: { email: 'viewer@example.com', name: '조회', role: 'VIEWER' } });
  await injectSession(context, viewer.id);

  await page.goto('/timeline');
  await expect(page.getByRole('heading', { name: '전체 타임라인' })).toBeVisible();
  await expect(page.getByRole('link', { name: '사용자 관리' })).toHaveCount(0);

  const res = await page.goto('/admin/users');
  expect(res?.status()).toBe(403);
  await expect(page.getByText('이 화면을 볼 권한이 없습니다.')).toBeVisible();
  expect(await auditActions()).toContain('authz.denied');
});

test('비활성 사용자의 세션은 즉시 무효', async ({ page, context }) => {
  const u = await ownerDb.user.create({ data: { email: 'gone@example.com', name: '퇴사', role: 'ADMIN' } });
  await injectSession(context, u.id);
  await page.goto('/timeline');
  await expect(page.getByRole('heading', { name: '전체 타임라인' })).toBeVisible();
  await ownerDb.user.update({ where: { id: u.id }, data: { active: false } });
  await page.goto('/timeline');
  await expect(page).toHaveURL(/\/login/);
});

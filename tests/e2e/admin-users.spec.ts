import { auditActions, expect, injectSession, login, ownerDb, resetAndSeed, test } from './fixtures';

test.beforeAll(resetAndSeed);

test('사용자 등록 → 역할 변경(대상 세션 무효) → 비활성화 → 잠금 해제 → admin 비밀번호 초기화', async ({
  page,
  context,
  browser,
}) => {
  // 구글 계정 ADMIN 으로 로그인한 상태를 만든다(구글 로그인은 E2E 대상 아님).
  const operator = await ownerDb.user.create({ data: { email: 'ops@example.com', name: '운영자', role: 'ADMIN' } });
  await injectSession(context, operator.id);
  await page.goto('/admin/users');
  await expect(page.getByRole('heading', { name: '사용자 관리' })).toBeVisible();

  // 1. 등록
  await page.getByRole('button', { name: '사용자 등록' }).click();
  await page.getByLabel('이메일').fill('Member@Example.com');
  await page.getByLabel('이름').fill('김멤버');
  await page.getByRole('button', { name: '등록', exact: true }).click();
  const row = page.getByTestId('user-row-member@example.com');
  await expect(row).toBeVisible();
  const member = await ownerDb.user.findUniqueOrThrow({ where: { email: 'member@example.com' } });
  expect(member.role).toBe('VIEWER');

  // 2. 역할 변경 → 대상 세션 삭제
  const memberCtx = await browser.newContext();
  await injectSession(memberCtx, member.id);
  expect(await ownerDb.session.count({ where: { userId: member.id } })).toBe(1);
  await row.getByRole('combobox', { name: '김멤버 역할' }).click();
  await page.getByRole('option', { name: '멤버' }).click();
  await expect.poll(async () => (await ownerDb.user.findUniqueOrThrow({ where: { id: member.id } })).role).toBe('MEMBER');
  expect(await ownerDb.session.count({ where: { userId: member.id } })).toBe(0);
  const memberPage = await memberCtx.newPage();
  await memberPage.goto('/timeline');
  await expect(memberPage).toHaveURL(/\/login/);
  await memberCtx.close();

  // 3. 비활성화
  await row.getByRole('button', { name: '김멤버 작업' }).click();
  await page.getByRole('menuitem', { name: '비활성화' }).click();
  await expect(row.getByText('비활성')).toBeVisible();

  // 4. 잠금 해제
  await ownerDb.user.update({
    where: { id: member.id },
    data: { failedLogins: 0, lockedUntil: new Date(Date.now() + 10 * 60 * 1000) },
  });
  await page.reload();
  await expect(row.getByText('잠김')).toBeVisible();
  await row.getByRole('button', { name: '김멤버 작업' }).click();
  await page.getByRole('menuitem', { name: '잠금 해제' }).click();
  await expect(row.getByText('잠김')).toHaveCount(0);
  expect((await ownerDb.user.findUniqueOrThrow({ where: { id: member.id } })).lockedUntil).toBeNull();

  // 5. admin(로컬) 비밀번호 초기화 → 임시 비밀번호로 로그인하면 변경 강제
  const adminRow = page.getByTestId('user-row-admin');
  await adminRow.getByRole('button', { name: '관리자 작업' }).click();
  await page.getByRole('menuitem', { name: '비밀번호 초기화' }).click();
  const temp = (await page.getByTestId('temp-password').textContent())!.trim();
  expect(temp).toHaveLength(24);
  await page.getByRole('button', { name: '닫기' }).first().click();

  const adminCtx = await browser.newContext({ extraHTTPHeaders: { 'X-Real-IP': '203.0.113.99' } });
  const adminPage = await adminCtx.newPage();
  await login(adminPage, 'admin', temp);
  await expect(adminPage).toHaveURL(/\/change-password$/);
  await adminCtx.close();

  const actions = await auditActions();
  expect(actions).toEqual(
    expect.arrayContaining([
      'user.create',
      'user.role.update',
      'user.deactivate',
      'user.unlock',
      'user.password.reset',
    ]),
  );
});

test('마지막 활성 관리자와 자기 자신은 비활성화 메뉴가 없거나 거부된다', async ({ page, context }) => {
  await resetAndSeed();
  const operator = await ownerDb.user.create({ data: { email: 'solo@example.com', name: '단독', role: 'ADMIN' } });
  await ownerDb.user.update({ where: { username: 'admin' }, data: { active: false } });
  await injectSession(context, operator.id);
  await page.goto('/admin/users');
  const row = page.getByTestId('user-row-solo@example.com');
  await row.getByRole('button', { name: '단독 작업' }).click();
  await expect(page.getByRole('menuitem', { name: '비활성화' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  // 마지막 활성 ADMIN 강등 시도 → 거부 메시지
  await row.getByRole('combobox', { name: '단독 역할' }).click();
  await page.getByRole('option', { name: '조회자' }).click();
  await expect(page.getByRole('alert')).toHaveText('마지막 활성 관리자의 역할은 바꿀 수 없습니다.');
  expect((await ownerDb.user.findUniqueOrThrow({ where: { id: operator.id } })).role).toBe('ADMIN');
});

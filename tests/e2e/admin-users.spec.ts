import { auditActions, expect, gotoReady, injectSession, login, ownerDb, resetAndSeed, test } from './fixtures';

test.beforeAll(resetAndSeed);

test('사용자 등록 → 역할 변경(대상 세션 무효) → 비활성화 → 잠금 해제 → admin 비밀번호 초기화', async ({
  page,
  context,
  browser,
}) => {
  // 구글 계정 ADMIN 으로 로그인한 상태를 만든다(구글 로그인은 E2E 대상 아님).
  const operator = await ownerDb.user.create({ data: { email: 'ops@example.com', name: '운영자', role: 'ADMIN' } });
  await injectSession(context, operator.id);
  await gotoReady(page, '/admin/users');
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
  await page.locator('html[data-hydrated="true"]').waitFor();
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

test('유일한 활성 관리자는 자기 역할·활성 상태를 바꿀 수 없다(TST-14)', async ({ page, context }) => {
  await resetAndSeed();
  const operator = await ownerDb.user.create({ data: { email: 'solo@example.com', name: '단독', role: 'ADMIN' } });
  // 로컬 admin 을 비활성화해 활성 ADMIN 이 operator 하나뿐인 상태를 만든다.
  await ownerDb.user.update({ where: { username: 'admin' }, data: { active: false } });
  await injectSession(context, operator.id);
  await gotoReady(page, '/admin/users');
  const row = page.getByTestId('user-row-solo@example.com');
  // 자기 역할 선택은 비활성(서버도 CONFLICT self 로 거부 — 통합 테스트)
  await expect(row.getByRole('combobox', { name: '단독 역할' })).toBeDisabled();
  await row.getByRole('button', { name: '단독 작업' }).click();
  await expect(page.getByRole('menuitem', { name: '비활성화' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  const me = await ownerDb.user.findUniqueOrThrow({ where: { id: operator.id } });
  expect(me).toMatchObject({ role: 'ADMIN', active: true });
  expect(await ownerDb.user.count({ where: { role: 'ADMIN', active: true } })).toBe(1);
});

test('가입 승인 대기: 역할 골라 승인 / 거부 → 거부 목록에서 삭제, 로그인 화면 안내', async ({ page, context }) => {
  const operator = await ownerDb.user.create({ data: { email: 'ops2@example.com', name: '운영자2', role: 'ADMIN' } });
  const a = await ownerDb.user.create({ data: { email: 'apply-a@example.com', name: '신청가', active: false, approval: 'PENDING' } });
  const b = await ownerDb.user.create({ data: { email: 'apply-b@example.com', name: '신청나', active: false, approval: 'PENDING' } });

  // 로그인 화면 안내(구글 콜백이 보내는 주소)
  await page.goto('/login?error=pending');
  await expect(page.getByTestId('login-pending')).toContainText('가입 신청이 접수되었습니다');
  await page.goto('/login?error=rejected');
  await expect(page.getByTestId('login-rejected')).toContainText('가입이 거부된 계정');

  await injectSession(context, operator.id);
  await gotoReady(page, '/admin/users');
  const box = page.getByTestId('pending-signups');
  await expect(box).toContainText('가입 승인 대기');
  await expect(page.getByTestId('user-row-apply-a@example.com')).toHaveCount(0); // 대기 중은 아래 표에 없다

  // 승인: 멤버로
  const rowA = page.getByTestId('pending-row-apply-a@example.com');
  await rowA.getByRole('combobox', { name: '신청가 승인 역할' }).click();
  await page.getByRole('option', { name: '멤버' }).click();
  await rowA.getByRole('button', { name: '승인' }).click();
  await expect(page.getByTestId('user-row-apply-a@example.com')).toBeVisible();
  expect(await ownerDb.user.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ approval: 'APPROVED', active: true, role: 'MEMBER' });

  // 거부 → 표에 "가입 거부" 로 남고, 삭제할 수 있다
  await page.getByTestId('pending-row-apply-b@example.com').getByRole('button', { name: '거부' }).click();
  await expect(box).toHaveCount(0);
  const rowB = page.getByTestId('user-row-apply-b@example.com');
  await expect(rowB.getByText('가입 거부')).toBeVisible();
  expect((await ownerDb.user.findUniqueOrThrow({ where: { id: b.id } })).approval).toBe('REJECTED');
  await rowB.getByRole('button', { name: '신청나 작업' }).click();
  await page.getByRole('menuitem', { name: '삭제' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '삭제' }).click();
  await expect(rowB).toHaveCount(0);
  expect(await ownerDb.user.findUnique({ where: { id: b.id } })).toBeNull();
  expect(await auditActions()).toEqual(expect.arrayContaining(['user.signup.approve', 'user.signup.reject', 'user.delete']));
});

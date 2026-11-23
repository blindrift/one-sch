import { auditActions, bar, createUser, expect, gotoReady, gotoTimeline, injectSession, ownerDb, resetAndSeed, test } from './fixtures';

test.beforeAll(resetAndSeed);

test('MEMBER: /projects 에서 생성 → 목록·타임라인에 표시 → 수정 → 보관하면 타임라인에서 사라짐', async ({ page, context }) => {
  const m = await createUser('MEMBER', '최멤버');
  await injectSession(context, m.id);
  await gotoReady(page, '/projects');

  // 생성
  await page.getByRole('button', { name: '프로젝트 만들기' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('키').fill('newp');
  await dlg.getByLabel('이름', { exact: true }).fill('신규 프로젝트');
  await dlg.getByLabel('시작일').fill('2026-11-10');
  await dlg.getByLabel('종료일').fill('2026-11-20');
  await dlg.getByRole('button', { name: '저장' }).click();
  await expect(dlg).toBeHidden();
  const row = page.getByTestId('project-row-NEWP');
  await expect(row).toContainText('신규 프로젝트');
  await expect(row).toContainText('최멤버');
  const project = await ownerDb.project.findUniqueOrThrow({ where: { key: 'NEWP' } });
  expect(project.ownerId).toBe(m.id);

  // 타임라인: 프로젝트 행(작업이 없어 프로젝트 기간으로 막대, D16)
  await gotoTimeline(page);
  await expect(page.getByTestId('gantt').getByText('[NEWP] 신규 프로젝트').first()).toBeVisible();
  await expect(page.getByTestId('gantt').getByText('11.10 ~ 11.20')).toBeVisible();
  await expect(bar(page, `p:${project.id}`)).toBeVisible();

  // 수정
  await gotoReady(page, '/projects');
  await row.getByRole('button', { name: 'NEWP 수정' }).click();
  await dlg.getByLabel('이름', { exact: true }).fill('이름 바꾼 프로젝트');
  await dlg.getByRole('button', { name: '저장' }).click();
  await expect(dlg).toBeHidden();
  await expect(row).toContainText('이름 바꾼 프로젝트');

  // 보관 → 타임라인에서 사라지고, "보관 포함"이면 다시 보인다(D6)
  await row.getByRole('button', { name: 'NEWP 보관' }).click();
  await expect(row.getByText('보관', { exact: true })).toBeVisible();
  await expect.poll(async () => (await ownerDb.project.findUniqueOrThrow({ where: { key: 'NEWP' } })).archived).toBe(true);
  await gotoReady(page, '/timeline');
  await expect(page.getByText('[NEWP] 이름 바꾼 프로젝트')).toHaveCount(0);
  await page.getByLabel('보관 포함').check();
  await expect(page).toHaveURL(/archived=1/);
  await expect(page.getByTestId('gantt').getByText('[NEWP] 이름 바꾼 프로젝트').first()).toBeVisible();

  expect(await auditActions()).toEqual(expect.arrayContaining(['project.create', 'project.update', 'project.archive']));
});

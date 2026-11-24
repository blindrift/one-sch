import { createProject, createTask, createUser, dragTo, expect, gotoReady, gotoTimeline, injectSession, ownerDb, resetAndSeed, test, watchActions } from './fixtures';

test.beforeEach(resetAndSeed);

test('프로젝트 탭: 간트·보드·목록·이슈를 링크로 오가고 현재 탭은 aria-current, 사이드바 프로젝트도 활성. 없는 키는 404', async ({ page, context }) => {
  const m = await createUser('MEMBER');
  await createProject(m.id, { key: 'TAB', name: '탭 이동' });
  await createProject(m.id, { key: 'TABX', name: '접두 같은 키' });
  await injectSession(context, m.id);

  await gotoReady(page, '/projects/TAB');
  const tabs = page.getByRole('navigation', { name: '프로젝트 탭' });
  await expect(tabs.getByRole('link', { name: '간트' })).toHaveAttribute('aria-current', 'page');
  for (const [name, path] of [
    ['보드', '/projects/TAB/board'],
    ['목록', '/projects/TAB/list'],
    ['이슈', '/projects/TAB/issues'],
    ['간트', '/projects/TAB'],
  ] as const) {
    await tabs.getByRole('link', { name }).click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(tabs.getByRole('link', { name })).toHaveAttribute('aria-current', 'page');
    const side = page.getByRole('navigation', { name: '프로젝트 바로 가기' });
    await expect(side.getByRole('link', { name: /\[TAB\] 탭 이동/ })).toHaveAttribute('aria-current', 'page');
    await expect(side.getByRole('link', { name: /\[TABX\]/ })).not.toHaveAttribute('aria-current', 'page');
  }

  for (const path of ['/projects/NOPE/board', '/projects/NOPE/list', '/projects/NOPE/issues', '/projects/bad!/list']) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(404);
  }
});

test('목록 탭: 필터·검색·정렬이 URL 에 남아 새로고침해도 유지되고, 지연 작업을 표시한다', async ({ page, context }) => {
  const m = await createUser('MEMBER', '목록 담당');
  const p = await createProject(m.id, { key: 'LST' });
  await createTask(p.id, { title: '로그인 화면', start: '2020-01-01', end: '2020-01-02', assigneeId: m.id });
  await createTask(p.id, { title: '배포 준비', start: '2099-01-01', end: '2099-01-05', status: 'DONE' });
  await createTask(p.id, { title: '알림 보내기', start: '2099-02-01', end: '2099-02-05' });
  await injectSession(context, m.id);

  await gotoReady(page, '/projects/LST/list');
  const table = page.getByTestId('task-list');
  await expect(table.locator('tbody tr')).toHaveCount(3);
  await expect(table.locator('tr', { hasText: '로그인 화면' }).getByTestId('task-late')).toBeVisible();
  await expect(table.locator('tr', { hasText: '알림 보내기' }).getByTestId('task-late')).toHaveCount(0);

  await page.getByLabel('상태 필터').selectOption('TODO');
  await expect(page).toHaveURL(/status=TODO/);
  await expect(table.locator('tbody tr')).toHaveCount(2);
  await page.getByRole('searchbox', { name: '검색' }).fill('로그인');
  await page.getByRole('searchbox', { name: '검색' }).press('Enter');
  await expect(page).toHaveURL(/q=%EB%A1%9C%EA%B7%B8%EC%9D%B8/);
  await expect(table.locator('tbody tr')).toHaveCount(1);

  await page.reload();
  await page.locator('html[data-hydrated="true"]').waitFor();
  await expect(page.getByLabel('상태 필터')).toHaveValue('TODO');
  await expect(page.getByRole('searchbox', { name: '검색' })).toHaveValue('로그인');
  await expect(table.locator('tbody tr')).toHaveCount(1);

  await page.getByRole('button', { name: '초기화' }).click();
  await expect(table.locator('tbody tr')).toHaveCount(3);
  await table.getByRole('link', { name: '종료일' }).click();
  await expect(page).toHaveURL(/sort=end/);
  await expect(table.locator('tbody tr').first()).toContainText('로그인 화면');
  await table.getByRole('link', { name: /종료일/ }).click();
  await expect(page).toHaveURL(/dir=desc/);
  await expect(table.locator('tbody tr').first()).toContainText('알림 보내기');
  await page.reload();
  await expect(table.locator('tbody tr').first()).toContainText('알림 보내기');
  // 정렬 중에는 순서 손잡이가 없다
  await expect(page.getByRole('button', { name: /순서 옮기기/ })).toHaveCount(0);
});

test('목록 탭 행 순서: 마우스·키보드로 형제 순서를 바꾸면 DB·감사에 남고, 간트는 새로고침 뒤 같은 순서. 다른 상위로는 못 옮긴다', async ({ page, context }) => {
  const m = await createUser('MEMBER');
  const p = await createProject(m.id, { key: 'ORD' });
  const a = await createTask(p.id, { title: '가 작업', start: '2026-11-10', end: '2026-11-12' });
  const b = await createTask(p.id, { title: '나 작업', start: '2026-11-10', end: '2026-11-12' });
  const c = await createTask(p.id, { title: '다 작업', start: '2026-11-10', end: '2026-11-12' });
  const child = await createTask(p.id, { title: '가의 하위', start: '2026-11-10', end: '2026-11-12', parentId: a.id });
  await injectSession(context, m.id);
  const order = async () =>
    (await ownerDb.task.findMany({ where: { projectId: p.id, parentId: null }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] })).map((t) => t.title);

  await gotoReady(page, '/projects/ORD/list');
  const handle = (title: string) => page.getByRole('button', { name: `순서 옮기기: ${title}` });
  const row = (id: string) => page.getByTestId(`task-row-${id}`);

  // 마우스: 다 → 가 앞으로
  await dragTo(page, handle('다 작업'), row(a.id), { toY: 'top' });
  await expect.poll(order).toEqual(['다 작업', '가 작업', '나 작업']);
  await expect(page.getByTestId('task-list').locator('tbody tr').first()).toContainText('다 작업');
  const log = await ownerDb.auditLog.findFirstOrThrow({ where: { action: 'task.reorder', entityId: c.id } });
  expect(log.after).toMatchObject({ order: [c.id, a.id, b.id] });

  // 키보드: 나 작업을 한 칸 위로(Space → ↑ → Space). 바로 위 행은 가의 하위라 그 상위(가 작업) 앞으로 간다
  await handle('나 작업').focus();
  await page.keyboard.press('Space');
  // dnd-kit 키보드 센서는 시작 직후 다음 틱에 화살표 처리기를 붙인다
  await page.waitForTimeout(150);
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(150);
  await page.keyboard.press('Space');
  await expect.poll(order).toEqual(['다 작업', '나 작업', '가 작업']);

  // 하위 작업을 최상위 행 위로 끌면 거부(메시지, DB 불변)
  const actions = watchActions(page);
  await dragTo(page, handle('가의 하위'), row(c.id), { toY: 'top' });
  await expect(page.getByTestId('list-message')).toContainText('같은 상위 작업 아래');
  await actions.settle();
  expect(actions.count()).toBe(0);
  expect((await ownerDb.task.findUniqueOrThrow({ where: { id: child.id } })).version).toBe(0);

  // 간트: 새로고침하면 같은 순서
  await gotoTimeline(page, '/projects/ORD');
  const y = async (title: string) => (await page.locator('.wx-row', { hasText: title }).first().boundingBox())!.y;
  const [yc, yb, ya] = [await y('다 작업'), await y('나 작업'), await y('가 작업')];
  expect(yc).toBeLessThan(yb);
  expect(yb).toBeLessThan(ya);
});

test('보관 프로젝트: 목록·보드·이슈 탭이 읽기 전용(추가·손잡이·댓글 입력 없음, 끌어도 POST 0·DB 불변)', async ({ page, context }) => {
  const m = await createUser('MEMBER');
  const p = await createProject(m.id, { key: 'ARC', archived: true });
  const t = await createTask(p.id, { title: '보관 작업', start: '2026-11-10', end: '2026-11-12' });
  const issue = await ownerDb.issue.create({ data: { projectId: p.id, number: 1, title: '보관 이슈', reporterId: m.id } });
  await ownerDb.project.update({ where: { id: p.id }, data: { issueSeq: 1 } });
  await injectSession(context, m.id);
  const actions = watchActions(page);

  await gotoReady(page, '/projects/ARC/list');
  await expect(page.getByText('보관(읽기 전용)')).toBeVisible();
  await expect(page.getByRole('button', { name: '작업 추가' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /순서 옮기기/ })).toHaveCount(0);
  await page.getByTestId(`task-row-${t.id}`).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await gotoReady(page, '/projects/ARC/board');
  await dragTo(page, page.getByTestId(`board-card-${t.id}`), page.getByTestId('board-col-DONE'));
  await page.getByTestId(`board-card-${t.id}`).focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Space');
  await expect(page.getByTestId('board-col-TODO').getByTestId(`board-card-${t.id}`)).toBeVisible();

  await gotoReady(page, '/projects/ARC/issues?issue=ARC-1');
  await expect(page.getByTestId('issue-panel')).toContainText('보관된 프로젝트의 이슈는 읽기 전용입니다.');
  await expect(page.getByRole('button', { name: '이슈 추가' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '수정' })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: '댓글' })).toHaveCount(0);

  await actions.settle();
  expect(actions.count()).toBe(0);
  expect((await ownerDb.task.findUniqueOrThrow({ where: { id: t.id } })).status).toBe('TODO');
  expect((await ownerDb.issue.findUniqueOrThrow({ where: { id: issue.id } })).version).toBe(0);
});

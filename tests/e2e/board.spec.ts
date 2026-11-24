import {
  auditActions,
  createIssue,
  createProject,
  createTask,
  createUser,
  dndAnnouncer,
  dragTo,
  expect,
  gotoReady,
  injectSession,
  keyboardPickUp,
  keyboardPickUpDenied,
  ownerDb,
  resetAndSeed,
  test,
  watchActions,
} from './fixtures';

test.beforeEach(resetAndSeed);

test('작업 보드: 마우스로 열을 옮기면 상태가 DB·감사에 남고, 키보드(Space·→·Space)로도 옮긴다. 상위 작업은 토글로만 보인다', async ({ page, context }) => {
  const m = await createUser('MEMBER');
  const p = await createProject(m.id, { key: 'BRD' });
  const a = await createTask(p.id, { title: '마우스 카드', start: '2026-11-10', end: '2026-11-12' });
  const b = await createTask(p.id, { title: '키보드 카드', start: '2026-11-10', end: '2026-11-13' });
  const parent = await createTask(p.id, { title: '상위 카드', start: '2026-11-01', end: '2026-11-20' });
  await createTask(p.id, { title: '하위 카드', start: '2026-11-01', end: '2026-11-20', parentId: parent.id });
  await createTask(p.id, { title: '마일스톤 카드', start: '2026-11-30', end: '2026-11-30', isMilestone: true });
  await injectSession(context, m.id);
  const status = async (id: string) => (await ownerDb.task.findUniqueOrThrow({ where: { id } })).status;

  await gotoReady(page, '/projects/BRD/board');
  const ok = watchActions(page);
  const board = page.getByTestId('board');
  await expect(board).toContainText('마일스톤 카드');
  await expect(board).not.toContainText('상위 카드');

  await dragTo(page, page.getByTestId(`board-card-${a.id}`), page.getByTestId('board-col-DONE'));
  await expect(page.getByTestId('board-col-DONE').getByTestId(`board-card-${a.id}`)).toBeVisible();
  await expect.poll(() => status(a.id)).toBe('DONE');

  await keyboardPickUp(page, page.getByTestId(`board-card-${b.id}`));
  await page.keyboard.press('ArrowRight');
  await expect(dndAnnouncer(page)).toContainText('진행 중 열 위');
  await page.keyboard.press('ArrowRight');
  await expect(dndAnnouncer(page)).toContainText('막힘 열 위');
  await page.keyboard.press('Space');
  await expect.poll(() => status(b.id)).toBe('BLOCKED');
  await expect(page.getByTestId('board-col-BLOCKED').getByTestId(`board-card-${b.id}`)).toBeVisible();
  expect((await auditActions()).filter((x) => x === 'task.update')).toHaveLength(2);
  // 대조: 정상 조작은 서버 요청을 만든다(VIEWER·보관 테스트의 0 과 비교)
  expect(ok.count()).toBeGreaterThanOrEqual(2);

  // 새로고침해도 서버 값
  await page.reload();
  await expect(page.getByTestId('board-col-DONE').getByTestId(`board-card-${a.id}`)).toBeVisible();

  // 상위 작업 포함
  await page.getByRole('checkbox', { name: '상위 작업 포함' }).click();
  await expect(page).toHaveURL(/parents=1/);
  await expect(board).toContainText('상위 카드');

  // 카드에서 Enter 를 누르면 작업 대화상자(끌기는 Space 만)
  await page.getByTestId(`board-card-${a.id}`).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog').getByLabel('제목')).toHaveValue('마우스 카드');
  await expect(page.getByTestId(`board-card-${a.id}`)).not.toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // 마우스로 누르기(움직임 없음)도 연다
  await page.getByTestId(`board-card-${a.id}`).click();
  await expect(page.getByRole('dialog').getByLabel('제목')).toHaveValue('마우스 카드');
});

test('작업 보드 충돌: 다른 사람이 먼저 바꾼 카드를 끌면 사유를 보이고 되돌린 뒤 최신 값을 다시 읽는다(DB·감사 불변)', async ({ page, context }) => {
  const m = await createUser('MEMBER');
  const p = await createProject(m.id, { key: 'CNF' });
  const t = await createTask(p.id, { title: '충돌 카드', start: '2026-11-10', end: '2026-11-12' });
  await injectSession(context, m.id);

  await gotoReady(page, '/projects/CNF/board');
  await ownerDb.task.update({ where: { id: t.id }, data: { status: 'IN_PROGRESS', version: { increment: 1 } } });
  await dragTo(page, page.getByTestId(`board-card-${t.id}`), page.getByTestId('board-col-DONE'));
  await expect(page.getByTestId('board-message')).toContainText('다른 사용자가 먼저 변경했습니다');
  await expect(page.getByTestId('board-col-IN_PROGRESS').getByTestId(`board-card-${t.id}`)).toBeVisible();
  await expect(page.getByTestId('board-col-DONE').getByTestId(`board-card-${t.id}`)).toHaveCount(0);
  const row = await ownerDb.task.findUniqueOrThrow({ where: { id: t.id } });
  expect([row.status, row.version]).toEqual(['IN_PROGRESS', 1]);
  expect(await auditActions()).not.toContain('task.update');
});

test('이슈 보드: 열을 옮기면 이슈 상태가 바뀌고(감사 issue.update), 카드를 누르면 상세 패널이 열린다', async ({ page, context }) => {
  const m = await createUser('MEMBER');
  const p = await createProject(m.id, { key: 'IBD' });
  const issue = await createIssue(p.id, m.id, { title: '보드 이슈', priority: 'URGENT', dueDate: '2026-12-01' });
  await injectSession(context, m.id);

  await gotoReady(page, '/projects/IBD/board');
  await page.getByRole('group', { name: '보드 종류' }).getByRole('link', { name: '이슈' }).click();
  await expect(page).toHaveURL(/kind=issue/);
  await expect(page.getByTestId('board-col-OPEN')).toContainText('IBD-1');
  await dragTo(page, page.getByTestId(`board-card-${issue.id}`), page.getByTestId('board-col-RESOLVED'));
  await expect.poll(async () => (await ownerDb.issue.findUniqueOrThrow({ where: { id: issue.id } })).status).toBe('RESOLVED');
  expect(await auditActions()).toContain('issue.update');

  await page.getByTestId(`board-card-${issue.id}`).click();
  await expect(page).toHaveURL(/issue=IBD-1/);
  await expect(page.getByTestId('issue-panel').getByRole('heading', { name: '보드 이슈' })).toBeVisible();
  await expect(page.getByTestId('board-col-RESOLVED').getByTestId(`board-card-${issue.id}`)).toBeVisible();
});

test('VIEWER: 보드는 보이지만 끌어도 서버 요청 0·DB 불변, 이슈 추가·작업 추가 단추 없음', async ({ page, context }) => {
  const m = await createUser('MEMBER');
  const v = await createUser('VIEWER');
  const p = await createProject(m.id, { key: 'VBD' });
  const t = await createTask(p.id, { title: '보기 카드', start: '2026-11-10', end: '2026-11-12' });
  const issue = await createIssue(p.id, m.id, { title: '보기 이슈' });
  await injectSession(context, v.id);
  const actions = watchActions(page);

  await gotoReady(page, '/projects/VBD/board');
  await dragTo(page, page.getByTestId(`board-card-${t.id}`), page.getByTestId('board-col-DONE'), { expectDrag: false });
  await keyboardPickUpDenied(page, page.getByTestId(`board-card-${t.id}`));
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await gotoReady(page, '/projects/VBD/board?kind=issue');
  await dragTo(page, page.getByTestId(`board-card-${issue.id}`), page.getByTestId('board-col-CLOSED'), { expectDrag: false });
  await keyboardPickUpDenied(page, page.getByTestId(`board-card-${issue.id}`));
  await gotoReady(page, '/projects/VBD/list');
  await expect(page.getByRole('button', { name: '작업 추가' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /순서 옮기기/ })).toHaveCount(0);
  await gotoReady(page, '/projects/VBD/issues');
  await expect(page.getByRole('button', { name: '이슈 추가' })).toHaveCount(0);

  await actions.settle();
  expect(actions.count()).toBe(0);
  expect((await ownerDb.task.findUniqueOrThrow({ where: { id: t.id } })).status).toBe('TODO');
  expect((await ownerDb.issue.findUniqueOrThrow({ where: { id: issue.id } })).status).toBe('OPEN');
});

test('이슈 보드 충돌·삭제: 다른 사람이 바꾼 이슈는 사유를 보이고 최신 열로, 지워진 이슈는 다시 읽어 사라진다(T-2)', async ({ page, context }) => {
  const m = await createUser('MEMBER');
  const p = await createProject(m.id, { key: 'ICF' });
  const changed = await createIssue(p.id, m.id, { title: '바뀐 이슈' });
  const gone = await createIssue(p.id, m.id, { title: '지워질 이슈' });
  await injectSession(context, m.id);

  await gotoReady(page, '/projects/ICF/board?kind=issue');
  await ownerDb.issue.update({ where: { id: changed.id }, data: { status: 'IN_PROGRESS', version: { increment: 1 } } });
  await dragTo(page, page.getByTestId(`board-card-${changed.id}`), page.getByTestId('board-col-CLOSED'));
  await expect(page.getByTestId('board-message')).toContainText('다른 사용자가 먼저 변경했습니다');
  await expect(page.getByTestId('board-col-IN_PROGRESS').getByTestId(`board-card-${changed.id}`)).toBeVisible();
  await expect(page.getByTestId('board-col-CLOSED').getByTestId(`board-card-${changed.id}`)).toHaveCount(0);
  expect(await ownerDb.issue.findUniqueOrThrow({ where: { id: changed.id } })).toMatchObject({ status: 'IN_PROGRESS', version: 1 });

  await ownerDb.issue.delete({ where: { id: gone.id } });
  await dragTo(page, page.getByTestId(`board-card-${gone.id}`), page.getByTestId('board-col-RESOLVED'));
  await expect(page.getByTestId('board-message')).toContainText('대상을 찾을 수 없습니다');
  await expect(page.getByTestId(`board-card-${gone.id}`)).toHaveCount(0);
  expect(await auditActions()).not.toContain('issue.update');
});

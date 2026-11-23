import type { Page, Request } from '@playwright/test';
import { bar, createProject, createTask, createUser, DAY_CELL, dragBar, dragEmpty, expect, formError, gotoReady, gotoTimeline, injectSession, ownerDb, resetAndSeed, test, ymdOf } from './fixtures';

test.beforeEach(resetAndSeed);

/**
 * Server Action 호출(POST + next-action 헤더)을 센다. 거부된 조작이 서버 쓰기 요청을 아예 만들지 않았는지 확인한다.
 * settle(): 늦게 나가는 요청도 잡도록 최대 ms 동안 액션 요청을 기다린다(오면 즉시 끝나고 count 로 실패가 드러난다).
 */
function watchActions(page: Page) {
  const isAction = (req: Request) => req.method() === 'POST' && req.headers()['next-action'] !== undefined;
  const seen: string[] = [];
  page.on('request', (req) => {
    if (isAction(req)) seen.push(req.url());
  });
  return {
    count: () => seen.length,
    settle: (ms = 1_000) => page.waitForRequest(isAction, { timeout: ms }).then(
      () => undefined,
      () => undefined,
    ),
  };
}

const datesOf = async (id: string) => {
  const t = await ownerDb.task.findUniqueOrThrow({ where: { id } });
  return `${ymdOf(t.startDate)}~${ymdOf(t.endDate)}:${t.version}`;
};

test('VIEWER: 타임라인·프로젝트 화면은 보이고 추가·수정 단추가 없다. 드래그·더블클릭해도 DB 불변', async ({ page, context }) => {
  const owner = await createUser('MEMBER');
  const viewer = await createUser('VIEWER', '조회자');
  const p = await createProject(owner.id, { key: 'VIEW', name: '보기 전용' });
  const t = await createTask(p.id, { title: '보기 작업', start: '2026-11-10', end: '2026-11-14' });
  await injectSession(context, viewer.id);

  await gotoTimeline(page);
  await expect(page.getByTestId('gantt').getByText('[VIEW] 보기 전용').first()).toBeVisible();
  await expect(page.getByRole('button', { name: '작업 추가' })).toHaveCount(0);
  const actions = watchActions(page);
  await dragBar(page, bar(page, t.id), 3 * DAY_CELL, 'move');
  await bar(page, t.id).dblclick();
  // 빈 곳 끌기도 대화상자를 열지 않는다
  const vb = (await bar(page, t.id).boundingBox())!;
  await dragEmpty(page, vb.y + vb.height / 2, vb.x + vb.width + 3 * DAY_CELL, vb.x + vb.width + 6 * DAY_CELL);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('gantt-range')).toHaveCount(0);
  await actions.settle();
  expect(actions.count()).toBe(0);
  expect(await datesOf(t.id)).toBe('2026-11-10~2026-11-14:0');
  // 링크 핸들도 없다(readonly)
  await expect(bar(page, t.id).locator('.wx-link')).toHaveCount(0);

  await gotoReady(page, '/projects');
  await expect(page.getByTestId('project-row-VIEW')).toBeVisible();
  await expect(page.getByRole('button', { name: '프로젝트 만들기' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'VIEW 수정' })).toHaveCount(0);

  await gotoTimeline(page, '/projects/VIEW');
  await expect(page.getByRole('heading', { name: /VIEW/ })).toBeVisible();
  await expect(page.getByRole('button', { name: '작업 추가' })).toHaveCount(0);
});

test('MEMBER: 보관 프로젝트 화면은 읽기 전용(드래그 거부·DB 불변), 하위가 있는 상위 막대는 끌 수 없다', async ({ page, context }) => {
  const m = await createUser('MEMBER');
  const archived = await createProject(m.id, { key: 'ARCH', archived: true });
  const at = await createTask(archived.id, { title: '보관 작업', start: '2026-11-10', end: '2026-11-14' });
  const live = await createProject(m.id, { key: 'LIVE' });
  const parent = await createTask(live.id, { title: '상위', start: '2026-11-10', end: '2026-11-14' });
  await createTask(live.id, { title: '하위', start: '2026-11-10', end: '2026-11-14', parentId: parent.id });
  // 대조군: 상위 계층과 무관한 최상위 잎 작업(옮겨도 parent 의 값·version 은 그대로)
  const leaf = await createTask(live.id, { title: '대조 작업', start: '2026-11-10', end: '2026-11-14' });
  await injectSession(context, m.id);

  await gotoTimeline(page, '/projects/ARCH');
  await expect(page.getByText('보관(읽기 전용)')).toBeVisible();
  await expect(page.getByRole('button', { name: '작업 추가' })).toBeDisabled();
  const archivedActions = watchActions(page);
  await dragBar(page, bar(page, at.id), 3 * DAY_CELL, 'move');
  await archivedActions.settle();
  expect(archivedActions.count()).toBe(0);
  expect(await datesOf(at.id)).toBe('2026-11-10~2026-11-14:0');

  await gotoTimeline(page, '/projects/LIVE');
  // 대조(N-1): 쓸 수 있는 잎 막대를 끌면 watchActions 가 실제 액션 요청을 센다(0 건 단언이 헛돌지 않음을 보인다).
  const controlActions = watchActions(page);
  const saved = page.waitForResponse((res) => res.request().method() === 'POST' && res.request().headers()['next-action'] !== undefined);
  await dragBar(page, bar(page, leaf.id), 3 * DAY_CELL, 'move');
  expect((await saved).ok()).toBe(true);
  expect(controlActions.count()).toBe(1);
  expect(await datesOf(leaf.id)).toBe('2026-11-13~2026-11-17:1');

  const summaryActions = watchActions(page);
  await dragBar(page, bar(page, parent.id), 3 * DAY_CELL, 'move');
  await summaryActions.settle();
  expect(summaryActions.count()).toBe(0);
  expect(await datesOf(parent.id)).toBe('2026-11-10~2026-11-14:0');
  await bar(page, parent.id).dblclick();
  await expect(page.getByRole('dialog').getByLabel('시작일')).toBeDisabled();
  await expect(formError(page, 'task-form-error')).toHaveCount(0);
});

test('없는 프로젝트 키는 404', async ({ page, context }) => {
  const m = await createUser('VIEWER');
  await injectSession(context, m.id);
  const res = await page.goto('/projects/NOPE');
  expect(res?.status()).toBe(404);
  const bad = await page.goto('/projects/..%2Fadmin');
  expect(bad?.status()).toBe(404);
});

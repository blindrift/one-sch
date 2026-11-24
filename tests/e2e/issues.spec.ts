import {
  auditActions,
  collectCspViolations,
  createIssue,
  createProject,
  createTask,
  createUser,
  expect,
  gotoReady,
  injectSession,
  ownerDb,
  resetAndSeed,
  test,
  watchActions,
} from './fixtures';

test.beforeEach(resetAndSeed);

test('이슈 CRUD: 추가하면 KEY-1 상세 패널(?issue=)이 열리고 새로고침해도 유지, 수정·삭제가 DB·감사에 남는다', async ({ page, context }) => {
  const m = await createUser('MEMBER', '이슈 담당');
  const p = await createProject(m.id, { key: 'ISS', name: '이슈 프로젝트' });
  const t = await createTask(p.id, { title: '연결할 작업', start: '2026-11-10', end: '2026-11-12' });
  await injectSession(context, m.id);
  const dlg = page.getByRole('dialog');

  await gotoReady(page, '/projects/ISS/issues');
  await page.getByRole('button', { name: '이슈 추가' }).click();
  await dlg.getByLabel('제목').fill('로그인 실패');
  await dlg.getByLabel('유형').selectOption('RISK');
  await dlg.getByLabel('우선순위').selectOption('HIGH');
  await dlg.getByLabel('담당자').selectOption({ label: '이슈 담당' });
  await dlg.getByLabel('마감일').fill('2026-12-01');
  await dlg.getByLabel('연결 작업').selectOption({ label: '연결할 작업' });
  await dlg.getByLabel('설명(마크다운)').fill('## 재현\n\n1. 로그인\n2. **실패**');
  await dlg.getByRole('button', { name: '저장' }).click();
  await expect(dlg).toBeHidden();
  await expect(page).toHaveURL(/\?issue=ISS-1$/);
  const panel = page.getByTestId('issue-panel');
  await expect(panel.getByRole('heading', { name: '로그인 실패' })).toBeVisible();
  await expect(panel.getByTestId('issue-description').locator('h2')).toHaveText('재현');
  await expect(panel.getByTestId('issue-description').locator('strong')).toHaveText('실패');
  const row = await ownerDb.issue.findFirstOrThrow({ where: { projectId: p.id } });
  expect(row).toMatchObject({ number: 1, type: 'RISK', priority: 'HIGH', assigneeId: m.id, reporterId: m.id, taskId: t.id });

  await page.reload();
  await expect(page.getByTestId('issue-panel').getByRole('heading', { name: '로그인 실패' })).toBeVisible();
  await expect(page.getByTestId('issue-row-ISS-1')).toHaveAttribute('aria-selected', 'true');

  await panel.getByRole('button', { name: '수정' }).click();
  await dlg.getByLabel('상태').selectOption('RESOLVED');
  await dlg.getByLabel('제목').fill('로그인 실패(해결)');
  await dlg.getByRole('button', { name: '저장' }).click();
  await expect(dlg).toBeHidden();
  await expect(panel.getByRole('heading', { name: '로그인 실패(해결)' })).toBeVisible();
  expect(await ownerDb.issue.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: 'RESOLVED', version: 1 });

  await panel.getByRole('button', { name: '삭제' }).click();
  await expect(panel.getByTestId('issue-delete-confirm')).toBeVisible();
  await panel.getByRole('button', { name: '삭제 확인' }).click();
  await expect(page.getByTestId('issue-panel')).toHaveCount(0);
  await expect(page).toHaveURL(/\/projects\/ISS\/issues$/);
  expect(await ownerDb.issue.count()).toBe(0);
  expect((await auditActions()).filter((a) => a.startsWith('issue.'))).toEqual(['issue.create', 'issue.update', 'issue.delete']);
});

test('마크다운 XSS: script·onerror·iframe·javascript: 링크가 실행·렌더되지 않고(대화상자 0, CSP 위반 0) 링크는 rel 이 붙는다', async ({ page, context }) => {
  const m = await createUser('MEMBER');
  const p = await createProject(m.id, { key: 'XSS' });
  const payload = [
    '<script>window.__xss = 1; alert(1)</script>',
    '<img src=x onerror="window.__xss = 2; alert(2)">',
    '<iframe src="javascript:alert(3)"></iframe>',
    '[누르기](javascript:alert(4))',
    '[데이터](data:text/html,<script>alert(5)</script>)',
    '![그림](https://evil.example/x.png)',
    '[안전](https://example.com/doc)',
  ].join('\n\n');
  const issue = await createIssue(p.id, m.id, { title: 'XSS 시험', description: payload });
  await ownerDb.comment.create({ data: { issueId: issue.id, authorId: m.id, body: `댓글 ${payload}` } });
  await injectSession(context, m.id);
  const dialogs: string[] = [];
  page.on('dialog', (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });
  const csp = collectCspViolations(page);
  const external: string[] = [];
  page.on('request', (req) => {
    if (!req.url().startsWith('http://localhost')) external.push(req.url());
  });

  await gotoReady(page, '/projects/XSS/issues?issue=XSS-1');
  const panel = page.getByTestId('issue-panel');
  await expect(panel.getByTestId('issue-description')).toContainText('누르기');
  for (const scope of [panel.getByTestId('issue-description'), panel.getByTestId('comment-list')]) {
    const html = await scope.innerHTML();
    expect(html).not.toMatch(/<script|<iframe|<img|onerror|javascript:|data:text/i);
    await expect(scope.locator('a[href="https://example.com/doc"]')).toHaveAttribute('rel', 'noopener noreferrer nofollow');
    await expect(scope.locator('a[href="https://example.com/doc"]')).toHaveAttribute('target', '_blank');
    await expect(scope.locator('a[href="https://evil.example/x.png"]')).toHaveText('[그림]');
  }
  const url = page.url();
  await panel.getByTestId('issue-description').getByText('누르기').click();
  // 걸러진 링크는 글자(span)라 눌러도 이동·실행이 없다
  expect(page.url()).toBe(url);
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  expect(dialogs).toEqual([]);
  expect(csp).toEqual([]);
  expect(external).toEqual([]);
});

test('댓글 권한: VIEWER 는 이슈 수정 단추 없이 댓글 작성·본인 댓글 수정·삭제, 남의 댓글은 삭제 못 함. ADMIN 은 남의 댓글을 지운다', async ({ page, context, browser }) => {
  const m = await createUser('MEMBER', '멤버');
  const v = await createUser('VIEWER', '조회자');
  const p = await createProject(m.id, { key: 'CMT' });
  const issue = await createIssue(p.id, m.id, { title: '댓글 시험' });
  const memberComment = await ownerDb.comment.create({ data: { issueId: issue.id, authorId: m.id, body: '멤버 댓글' } });
  await injectSession(context, v.id);
  const actions = watchActions(page);

  await gotoReady(page, '/projects/CMT/issues?issue=CMT-1');
  const panel = page.getByTestId('issue-panel');
  await expect(panel.getByRole('heading', { name: '댓글 시험' })).toBeVisible();
  await expect(page.getByRole('button', { name: '이슈 추가' })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: '수정', exact: true })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: '삭제', exact: true })).toHaveCount(0);
  const theirs = panel.getByTestId(`comment-${memberComment.id}`);
  await expect(theirs).toContainText('멤버 댓글');
  await expect(theirs.getByRole('button')).toHaveCount(0);
  await actions.settle(300);
  expect(actions.count()).toBe(0);

  await panel.getByRole('textbox', { name: '댓글' }).fill('조회자 **의견**');
  await panel.getByRole('button', { name: '댓글 등록' }).click();
  const mine = panel.locator('li', { hasText: '조회자 의견' });
  await expect(mine.locator('strong')).toHaveText('의견');
  const myRow = await ownerDb.comment.findFirstOrThrow({ where: { authorId: v.id } });
  const myItem = panel.getByTestId(`comment-${myRow.id}`);
  await myItem.getByRole('button', { name: '수정' }).click();
  await myItem.getByRole('textbox', { name: '댓글 수정' }).fill('조회자 고친 의견');
  await myItem.getByRole('button', { name: '저장' }).click();
  await expect(panel.getByTestId(`comment-${myRow.id}`)).toContainText('(수정됨)');
  await panel.getByTestId(`comment-${myRow.id}`).getByRole('button', { name: '삭제' }).click();
  await expect(panel.getByTestId(`comment-${myRow.id}`)).toContainText('삭제된 댓글입니다.');
  // 지운 댓글의 원문은 DOM 에도, 새로 읽은 페이지 응답에도 없다(T-8)
  await expect(panel.getByTestId(`comment-${myRow.id}`)).not.toContainText('고친 의견');
  const reloaded = await page.reload();
  const html = await reloaded!.text();
  expect(html).not.toContain('조회자 고친 의견');
  // 대조: 살아 있는 댓글 본문은 같은 응답에 있다(응답이 비어서 통과한 것이 아님)
  expect(html).toContain('멤버 댓글');
  await expect(page.getByTestId(`comment-${myRow.id}`)).toContainText('삭제된 댓글입니다.');
  expect((await ownerDb.comment.findUniqueOrThrow({ where: { id: myRow.id } })).deletedAt).not.toBeNull();

  // ADMIN: 남의 댓글 삭제
  const admin = await createUser('ADMIN', '관리');
  const adminContext = await browser.newContext({ extraHTTPHeaders: { 'X-Real-IP': '198.51.100.77' } });
  await injectSession(adminContext, admin.id);
  const adminPage = await adminContext.newPage();
  await gotoReady(adminPage, '/projects/CMT/issues?issue=CMT-1');
  const target = adminPage.getByTestId(`comment-${memberComment.id}`);
  await expect(target.getByRole('button', { name: '수정' })).toHaveCount(0);
  await target.getByRole('button', { name: '삭제' }).click();
  await expect(target).toContainText('삭제된 댓글입니다.');
  await adminContext.close();
  expect((await ownerDb.comment.findUniqueOrThrow({ where: { id: memberComment.id } })).deletedAt).not.toBeNull();
  expect((await auditActions()).filter((a) => a.startsWith('comment.'))).toEqual(['comment.create', 'comment.update', 'comment.delete', 'comment.delete']);
});

test('전체 이슈 /issues: 프로젝트·유형 필터와 KEY-번호 검색이 URL 에 남고, 보관 프로젝트 이슈는 기본으로 숨긴다', async ({ page, context }) => {
  const m = await createUser('MEMBER');
  const erp = await createProject(m.id, { key: 'ERP', name: '전사' });
  const ops = await createProject(m.id, { key: 'OPS', name: '운영' });
  const old = await createProject(m.id, { key: 'OLD', name: '옛날', archived: true });
  await createIssue(erp.id, m.id, { title: '전사 이슈 하나' });
  await createIssue(erp.id, m.id, { title: '전사 위험', type: 'RISK' });
  await createIssue(ops.id, m.id, { title: '운영 요청', type: 'REQUEST' });
  await createIssue(old.id, m.id, { title: '보관 이슈' });
  await injectSession(context, m.id);

  await gotoReady(page, '/issues');
  const list = page.getByTestId('issue-list');
  await expect(list.locator('tbody tr')).toHaveCount(3);
  await expect(list).not.toContainText('보관 이슈');
  await page.getByLabel('프로젝트 필터').selectOption('ERP');
  await expect(page).toHaveURL(/project=ERP/);
  await expect(list.locator('tbody tr')).toHaveCount(2);
  await page.getByLabel('유형 필터').selectOption('RISK');
  await expect(list.locator('tbody tr')).toHaveCount(1);
  await expect(list).toContainText('전사 위험');
  await page.reload();
  await expect(page.getByLabel('유형 필터')).toHaveValue('RISK');
  await expect(list.locator('tbody tr')).toHaveCount(1);

  await page.getByRole('button', { name: '초기화' }).click();
  await expect(list.locator('tbody tr')).toHaveCount(3);
  await page.getByRole('searchbox', { name: '검색' }).fill('ops-1');
  await page.getByRole('searchbox', { name: '검색' }).press('Enter');
  await expect(list.locator('tbody tr')).toHaveCount(1);
  await expect(list).toContainText('운영 요청');
  await list.getByRole('link', { name: '운영 요청' }).click();
  await expect(page).toHaveURL(/issue=OPS-1/);
  await expect(page.getByTestId('issue-panel').getByRole('heading', { name: '운영 요청' })).toBeVisible();

  await page.getByRole('button', { name: '초기화' }).click();
  await expect(page).toHaveURL(/\/issues$/);
  await page.getByLabel('프로젝트 필터').selectOption('OLD');
  await expect(list).toContainText('보관 이슈');
});

test('없는 ?issue= 는 안내 패널, 상세의 연결 작업 링크는 목록에서 그 작업을 강조한다(F5·F6)', async ({ page, context }) => {
  const m = await createUser('MEMBER');
  const p = await createProject(m.id, { key: 'LNK' });
  const other = await createProject(m.id, { key: 'OTR' });
  const tasks = [];
  for (let i = 0; i < 55; i += 1) tasks.push(await createTask(p.id, { title: `작업 ${String(i).padStart(2, '0')}`, start: '2026-11-10', end: '2026-11-12' }));
  const target = tasks[53];
  const issue = await createIssue(p.id, m.id, { title: '링크 이슈' });
  await ownerDb.issue.update({ where: { id: issue.id }, data: { taskId: target.id } });
  await createIssue(other.id, m.id, { title: '다른 프로젝트 이슈' });
  await injectSession(context, m.id);

  for (const key of ['LNK-9', 'OTR-1', 'nope']) {
    await gotoReady(page, `/projects/LNK/issues?issue=${key}`);
    await expect(page.getByTestId('issue-panel-missing')).toContainText('이슈를 찾을 수 없습니다');
    await expect(page.getByTestId('issue-panel')).toHaveCount(0);
  }

  await gotoReady(page, '/projects/LNK/issues?issue=LNK-1');
  await page.getByTestId('issue-task-link').click();
  await expect(page).toHaveURL(new RegExp(`/projects/LNK/list\\?task=${target.id}$`));
  const row = page.getByTestId(`task-row-${target.id}`);
  await expect(row).toHaveAttribute('aria-current', 'true');
  await expect(row).toBeInViewport();
  await expect(page.getByRole('navigation', { name: '페이지' })).toContainText('2 / 2쪽');
});

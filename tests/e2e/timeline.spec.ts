import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import {
  auditActions,
  bar,
  collectCspViolations,
  createProject,
  createTask,
  createUser,
  DAY_CELL,
  day,
  dragBar,
  expect,
  formError,
  gotoTimeline,
  injectSession,
  nextIp,
  ownerDb,
  resetAndSeed,
  test,
  ymdOf,
} from './fixtures';

// 각 테스트가 자기 데이터만 보도록 매번 비운다(행이 많으면 아래쪽 막대가 그려지지 않을 수 있다).
test.beforeEach(resetAndSeed);

const taskDates = async (id: string) => {
  const t = await ownerDb.task.findUniqueOrThrow({ where: { id } });
  return `${ymdOf(t.startDate)}~${ymdOf(t.endDate)}`;
};

test('작업·하위 작업·마일스톤을 대화상자로 만든다 → YYYY-MM-DD 표시, 부모 요약 막대가 하위 범위를 감싼다', async ({ page, context }) => {
  const m = await createUser('MEMBER', '김멤버');
  const p = await createProject(m.id, { key: 'DLG', name: '대화상자' });
  await injectSession(context, m.id);
  await gotoTimeline(page, '/projects/DLG');
  const dlg = page.getByRole('dialog');

  await page.getByRole('button', { name: '작업 추가' }).click();
  await dlg.getByLabel('제목').fill('부모 작업');
  await dlg.getByLabel('시작일').fill('2026-11-10');
  await dlg.getByLabel('종료일').fill('2026-11-12');
  await dlg.getByRole('button', { name: '저장' }).click();
  await expect(dlg).toBeHidden();
  const parent = await ownerDb.task.findFirstOrThrow({ where: { projectId: p.id, title: '부모 작업' } });

  await page.getByRole('button', { name: '작업 추가' }).click();
  await dlg.getByLabel('상위 작업').selectOption({ label: '부모 작업' });
  await dlg.getByLabel('제목').fill('하위 작업');
  await dlg.getByLabel('시작일').fill('2026-11-14');
  await dlg.getByLabel('종료일').fill('2026-11-20');
  await dlg.getByLabel('담당자').selectOption({ label: '김멤버' });
  await dlg.getByRole('button', { name: '저장' }).click();
  await expect(dlg).toBeHidden();
  const child = await ownerDb.task.findFirstOrThrow({ where: { projectId: p.id, title: '하위 작업' } });

  await page.getByRole('button', { name: '작업 추가' }).click();
  await dlg.getByLabel('제목').fill('오픈');
  await dlg.getByLabel('마일스톤(하루짜리 기준점)').check();
  await dlg.getByLabel('날짜').fill('2026-11-25');
  await dlg.getByRole('button', { name: '저장' }).click();
  await expect(dlg).toBeHidden();
  const ms = await ownerDb.task.findFirstOrThrow({ where: { projectId: p.id, title: '오픈' } });
  expect(ms.isMilestone).toBe(true);

  // 부모는 하위에서 다시 계산된다(D4)
  expect(await taskDates(parent.id)).toBe('2026-11-14~2026-11-20');
  const gantt = page.getByTestId('gantt');
  await expect(gantt.getByText('2026-11-14 ~ 2026-11-20')).toHaveCount(2); // 부모·하위
  await expect(gantt.getByText('2026-11-25', { exact: true })).toBeVisible(); // 마일스톤
  await expect(gantt.getByText('2026-11-14 ~ 2026-11-25')).toBeVisible(); // 프로젝트 요약
  await expect(gantt.getByText('김멤버', { exact: true })).toBeVisible();

  const pb = (await bar(page, parent.id).boundingBox())!;
  const cb = (await bar(page, child.id).boundingBox())!;
  expect(pb.x).toBeLessThanOrEqual(cb.x + 1);
  expect(pb.x + pb.width).toBeGreaterThanOrEqual(cb.x + cb.width - 1);
  await expect(bar(page, parent.id)).toHaveClass(/wx-summary/);

  // 새로고침 뒤에도 같다
  await page.reload();
  await page.locator('[data-testid="gantt"][data-ready="true"]').waitFor();
  await expect(page.getByTestId('gantt').getByText('2026-11-14 ~ 2026-11-20')).toHaveCount(2);
  expect(await auditActions()).toEqual(expect.arrayContaining(['task.create']));
});

test('막대를 +3일 끌고 오른쪽 끝을 +2일 늘린 뒤 새로고침 → DB·화면 유지, 감사 task.update', async ({ page, context }) => {
  const m = await createUser('MEMBER');
  const p = await createProject(m.id, { key: 'DRG' });
  const t = await createTask(p.id, { title: '드래그', start: '2026-11-10', end: '2026-11-14' });
  await injectSession(context, m.id);
  await gotoTimeline(page, '/projects/DRG');
  const gantt = page.getByTestId('gantt');

  await dragBar(page, bar(page, t.id), 3 * DAY_CELL, 'move');
  await expect.poll(() => taskDates(t.id)).toBe('2026-11-13~2026-11-17');
  await expect(gantt.getByText('2026-11-13 ~ 2026-11-17')).toHaveCount(2); // 작업·프로젝트 요약

  await dragBar(page, bar(page, t.id), 2 * DAY_CELL, 'end');
  await expect.poll(() => taskDates(t.id)).toBe('2026-11-13~2026-11-19');
  await expect(gantt.getByText('2026-11-13 ~ 2026-11-19')).toHaveCount(2);

  await page.reload();
  await page.locator('[data-testid="gantt"][data-ready="true"]').waitFor();
  await expect(page.getByTestId('gantt').getByText('2026-11-13 ~ 2026-11-19')).toHaveCount(2);
  const row = await ownerDb.task.findUniqueOrThrow({ where: { id: t.id } });
  expect(row.version).toBe(2);
  expect((await auditActions()).filter((a) => a === 'task.update')).toHaveLength(2);
});

test('충돌: 다른 곳에서 version 이 오른 뒤 드래그 → 저장 거부·충돌 메시지·최신 값 표시', async ({ page, context }) => {
  const m = await createUser('MEMBER');
  const p = await createProject(m.id, { key: 'CNF' });
  const t = await createTask(p.id, { title: '충돌', start: '2026-11-10', end: '2026-11-12' });
  // 막대 위치 비교용으로 움직이지 않는 기준 작업을 둔다
  const anchor = await createTask(p.id, { title: '기준', start: '2026-11-10', end: '2026-11-30' });
  await injectSession(context, m.id);
  await gotoTimeline(page, '/projects/CNF');
  const x0 = (await bar(page, anchor.id).boundingBox())!.x;

  await ownerDb.task.update({
    where: { id: t.id },
    data: { version: { increment: 1 }, startDate: day('2026-11-20'), endDate: day('2026-11-22') },
  });
  await dragBar(page, bar(page, t.id), 2 * DAY_CELL, 'move');

  await expect(formError(page, 'timeline-message')).toContainText('다른 사용자가 먼저 변경했습니다');
  // router.refresh 로 최신 값(11-20~11-22)을 다시 불러온다
  await expect(page.getByTestId('gantt').getByText('2026-11-20 ~ 2026-11-22')).toBeVisible();
  await expect.poll(async () => Math.round((await bar(page, t.id).boundingBox())!.x - x0)).toBe(10 * DAY_CELL);
  expect(await taskDates(t.id)).toBe('2026-11-20~2026-11-22');
  expect((await ownerDb.task.findUniqueOrThrow({ where: { id: t.id } })).version).toBe(1);
  expect(await auditActions()).not.toContain('task.update');
});

test('의존: 링크를 끌어 추가 → 새로고침 후 유지, 역방향(순환)은 거부·DB 불변, 대화상자에서 삭제', async ({ page, context }) => {
  const m = await createUser('MEMBER');
  const p = await createProject(m.id, { key: 'DEP' });
  const a = await createTask(p.id, { title: '선행', start: '2026-11-10', end: '2026-11-12' });
  const b = await createTask(p.id, { title: '후행', start: '2026-11-16', end: '2026-11-18' });
  await injectSession(context, m.id);
  await gotoTimeline(page, '/projects/DEP');

  await bar(page, a.id).hover();
  await bar(page, a.id).locator('.wx-link.wx-right').click();
  await bar(page, b.id).hover();
  await bar(page, b.id).locator('.wx-link.wx-left').click();
  await expect.poll(() => ownerDb.taskDependency.count({ where: { fromTaskId: a.id, toTaskId: b.id } })).toBe(1);
  const dep = await ownerDb.taskDependency.findFirstOrThrow({ where: { fromTaskId: a.id } });
  await expect(page.locator(`[data-link-id=":${dep.id}"]`)).toHaveCount(1);

  await page.reload();
  await page.locator('[data-testid="gantt"][data-ready="true"]').waitFor();
  await expect(page.locator(`[data-link-id=":${dep.id}"]`)).toHaveCount(1);

  // 역방향 b→a 는 순환
  await bar(page, b.id).hover();
  await bar(page, b.id).locator('.wx-link.wx-right').click();
  await bar(page, a.id).hover();
  await bar(page, a.id).locator('.wx-link.wx-left').click();
  await expect(formError(page, 'timeline-message')).toContainText('순환 의존');
  expect(await ownerDb.taskDependency.count()).toBe(1);
  await expect(page.locator('[data-link-id]')).toHaveCount(1);

  // 대화상자(더블클릭)에서 삭제
  await bar(page, b.id).dblclick();
  const dlg = page.getByRole('dialog');
  await expect(dlg.getByTestId('task-dependencies')).toContainText('선행: 선행');
  await dlg.getByRole('button', { name: '의존 삭제 선행' }).click();
  await expect.poll(() => ownerDb.taskDependency.count()).toBe(0);
  await expect(dlg.getByTestId('task-dependencies')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-link-id]')).toHaveCount(0);
  expect(await auditActions()).toEqual(expect.arrayContaining(['dependency.create', 'dependency.delete']));
});

test('관련 링크·메모: 대화상자에서 넣고 저장 → DB·막대 표시, 다시 열면 값 유지, javascript: 링크는 거부', async ({ page, context }) => {
  const m = await createUser('MEMBER');
  const p = await createProject(m.id, { key: 'URL' });
  await injectSession(context, m.id);
  await gotoTimeline(page, '/projects/URL');
  const dlg = page.getByRole('dialog');
  const memo = '회의록 참고\n다음 주 재검토';

  await page.getByRole('button', { name: '작업 추가' }).click();
  await dlg.getByLabel('제목').fill('링크 작업');
  await dlg.getByLabel('시작일').fill('2026-11-10');
  await dlg.getByLabel('종료일').fill('2026-11-12');
  await dlg.getByLabel('관련 링크(URL)').fill('https://example.com/browse/URL-1');
  await dlg.getByLabel('메모', { exact: true }).fill(memo);
  const open = dlg.getByTestId('task-url-open');
  await expect(open).toHaveAttribute('href', 'https://example.com/browse/URL-1');
  await expect(open).toHaveAttribute('target', '_blank');
  await expect(open).toHaveAttribute('rel', 'noopener noreferrer');
  await dlg.getByRole('button', { name: '저장' }).click();
  await expect(dlg).toBeHidden();

  const t = await ownerDb.task.findFirstOrThrow({ where: { projectId: p.id, title: '링크 작업' } });
  expect(t).toMatchObject({ url: 'https://example.com/browse/URL-1', memo });
  const marks = bar(page, t.id).getByTestId('bar-marks');
  await expect(marks).toHaveAttribute('data-has-url', 'true');
  await expect(marks).toHaveAttribute('title', /메모: 회의록 참고 다음 주 재검토/);

  // 새로고침 뒤 다시 열면 값이 그대로다
  await page.reload();
  await page.locator('[data-testid="gantt"][data-ready="true"]').waitFor();
  await bar(page, t.id).dblclick();
  await expect(dlg.getByLabel('관련 링크(URL)')).toHaveValue('https://example.com/browse/URL-1');
  await expect(dlg.getByLabel('메모', { exact: true })).toHaveValue(memo);

  // javascript: 는 저장되지 않고, 열기 링크도 나오지 않는다
  await dlg.getByLabel('관련 링크(URL)').fill('javascript:alert(1)');
  await expect(dlg.getByTestId('task-url-open')).toHaveCount(0);
  await dlg.getByRole('button', { name: '저장' }).click();
  await expect(dlg.getByText('http:// 또는 https:// 로 시작하는 주소만 쓸 수 있습니다.').first()).toBeVisible();
  const after = await ownerDb.task.findUniqueOrThrow({ where: { id: t.id } });
  expect(after).toMatchObject({ url: 'https://example.com/browse/URL-1', version: t.version });

  // 비우면 null 로 지워진다
  await dlg.getByLabel('관련 링크(URL)').fill('');
  await dlg.getByLabel('메모', { exact: true }).fill('   ');
  await dlg.getByRole('button', { name: '저장' }).click();
  await expect(dlg).toBeHidden();
  await expect.poll(async () => (await ownerDb.task.findUniqueOrThrow({ where: { id: t.id } })).url).toBeNull();
  expect((await ownerDb.task.findUniqueOrThrow({ where: { id: t.id } })).memo).toBeNull();
  await expect(bar(page, t.id).getByTestId('bar-marks')).toHaveCount(0);
});

test('줌 일/주/월, 필터(프로젝트·담당자·상태, URL 유지), 접기', async ({ page, context }) => {
  const m = await createUser('MEMBER', '박담당');
  const za = await createProject(m.id, { key: 'ZA', name: '에이' });
  const zb = await createProject(m.id, { key: 'ZB', name: '비' });
  const alpha = await createTask(za.id, { title: '알파', start: '2026-11-10', end: '2026-11-12', assigneeId: m.id });
  const beta = await createTask(zb.id, { title: '베타', start: '2026-11-10', end: '2026-11-14', status: 'DONE' });
  const betaChild = await createTask(zb.id, { title: '베타 하위', start: '2026-11-10', end: '2026-11-14', parentId: beta.id, status: 'DONE' });
  await injectSession(context, m.id);
  await gotoTimeline(page);
  const gantt = page.getByTestId('gantt');

  // 줌
  await page.getByRole('button', { name: '주', exact: true }).click();
  await expect(page.getByRole('button', { name: '주', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(gantt.getByText(/^\d{1,2}\/\d{1,2}~$/).first()).toBeVisible();
  await expect(page).toHaveURL(/zoom=week/);
  await page.getByRole('button', { name: '월', exact: true }).click();
  await expect(gantt.getByText(/^\d{1,2}월$/).first()).toBeVisible();
  await page.getByRole('button', { name: '일', exact: true }).click();
  await expect(page).not.toHaveURL(/zoom=/);

  // 프로젝트 필터 → 새로고침해도 유지
  await page.getByLabel('프로젝트 필터').selectOption('ZA');
  await expect(bar(page, beta.id)).toHaveCount(0);
  await expect(bar(page, alpha.id)).toHaveCount(1);
  await expect(page).toHaveURL(/project=ZA/);
  await page.reload();
  await page.locator('[data-testid="gantt"][data-ready="true"]').waitFor();
  await expect(page.getByLabel('프로젝트 필터')).toHaveValue('ZA');
  await expect(bar(page, beta.id)).toHaveCount(0);
  await page.getByLabel('프로젝트 필터').selectOption('');

  // 담당자 필터
  await page.getByLabel('담당자 필터').selectOption({ label: '박담당' });
  await expect(bar(page, alpha.id)).toHaveCount(1);
  await expect(bar(page, beta.id)).toHaveCount(0);
  await page.getByLabel('담당자 필터').selectOption('');

  // 상태 필터(완료) → 조상은 함께 보인다
  await page.getByLabel('상태 필터').selectOption('DONE');
  await expect(bar(page, alpha.id)).toHaveCount(0);
  await expect(bar(page, betaChild.id)).toHaveCount(1);
  await expect(page).toHaveURL(/status=DONE/);
  await page.getByLabel('상태 필터').selectOption('');

  // 접기·펼치기
  await expect(bar(page, betaChild.id)).toHaveCount(1);
  await page.getByRole('button', { name: '모두 접기' }).click();
  await expect(bar(page, betaChild.id)).toHaveCount(0);
  await expect(bar(page, alpha.id)).toHaveCount(0);
  await page.getByRole('button', { name: '모두 펼치기' }).click();
  await expect(bar(page, betaChild.id)).toHaveCount(1);
  await expect(bar(page, alpha.id)).toHaveCount(1);
});

test('/timeline 콘솔에 CSP 위반 0, 외부 글꼴 요청 없음', async ({ page, context }) => {
  const m = await createUser('MEMBER');
  const p = await createProject(m.id, { key: 'CSP' });
  await createTask(p.id, { title: '작업', start: '2026-11-10', end: '2026-11-12' });
  await injectSession(context, m.id);
  const violations = collectCspViolations(page);
  const external: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.hostname !== 'localhost' || r.resourceType() === 'font') external.push(r.url());
  });
  await gotoTimeline(page);
  await page.getByRole('button', { name: '주', exact: true }).click();
  await page.waitForLoadState('networkidle');
  expect(violations).toEqual([]);
  expect(external).toEqual([]);
});

test('브라우저 시간대 America/Los_Angeles: 표시 날짜 = DB, 드래그 후 저장 날짜도 정확', async ({ browser }) => {
  const m = await createUser('MEMBER');
  const p = await createProject(m.id, { key: 'TZLA' });
  const t = await createTask(p.id, { title: '시간대', start: '2026-11-10', end: '2026-11-14' });
  const ms = await createTask(p.id, { title: '기준점', start: '2026-11-20', end: '2026-11-20', isMilestone: true });
  const context = await browser.newContext({ timezoneId: 'America/Los_Angeles', extraHTTPHeaders: { 'X-Real-IP': nextIp(7) } });
  try {
    await injectSession(context, m.id);
    const page = await context.newPage();
    expect(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe('America/Los_Angeles');
    await gotoTimeline(page, '/projects/TZLA');
    const gantt = page.getByTestId('gantt');
    await expect(gantt.getByText('2026-11-10 ~ 2026-11-14')).toBeVisible();
    await expect(gantt.getByText('2026-11-20', { exact: true })).toBeVisible();
    // 막대 위치도 날짜와 맞는다: 마일스톤(11-20 0시) 중심 − 작업 시작(11-10 0시) = 10칸, 작업 너비(11-10~11-14 포함) = 5칸
    const tb = (await bar(page, t.id).boundingBox())!;
    const mb = (await bar(page, ms.id).boundingBox())!;
    expect(Math.round(mb.x + mb.width / 2 - tb.x)).toBe(10 * DAY_CELL);
    expect(Math.round(tb.width)).toBe(5 * DAY_CELL);

    await dragBar(page, bar(page, t.id), 3 * DAY_CELL, 'move');
    await expect.poll(() => taskDates(t.id)).toBe('2026-11-13~2026-11-17');
    await expect(gantt.getByText('2026-11-13 ~ 2026-11-17')).toBeVisible();
  } finally {
    await context.close();
  }
});

test('3,000건 첫 표시(N-01: 2초 이내, 측정값 기록)', async ({ page, context }) => {
  test.setTimeout(120_000);
  const m = await createUser('MEMBER');
  const PROJECTS = 10;
  const PARENTS = 60;
  const CHILDREN = 4; // 프로젝트마다 60 + 240 = 300건
  const tasks: Prisma.TaskCreateManyInput[] = [];
  const deps: Array<{ fromTaskId: string; toTaskId: string }> = [];
  for (let pi = 0; pi < PROJECTS; pi += 1) {
    const p = await createProject(m.id, { key: `PERF${pi}`, color: `#${(0x203040 + pi * 0x101010).toString(16)}` });
    let sort = 0;
    let prevChild: string | null = null;
    for (let i = 0; i < PARENTS; i += 1) {
      const parentId = randomUUID();
      const base = Date.UTC(2026, 8, 1) + ((i * 3) % 180) * 86_400_000;
      tasks.push({ id: parentId, projectId: p.id, title: `요약 ${pi}-${i}`, startDate: new Date(base), endDate: new Date(base + 9 * 86_400_000), progress: 40, sortOrder: (sort += 1) });
      for (let c = 0; c < CHILDREN; c += 1) {
        const id = randomUUID();
        const s = base + c * 2 * 86_400_000;
        tasks.push({
          id,
          projectId: p.id,
          parentId,
          title: `작업 ${pi}-${i}-${c}`,
          startDate: new Date(s),
          endDate: new Date(s + 3 * 86_400_000),
          progress: (c * 25) % 100,
          status: c === 3 ? 'DONE' : 'IN_PROGRESS',
          assigneeId: c % 2 ? m.id : null,
          sortOrder: (sort += 1),
        });
        if (prevChild && c === 0) deps.push({ fromTaskId: prevChild, toTaskId: id });
        prevChild = id;
      }
    }
  }
  const parents = tasks.filter((t) => !t.parentId);
  await ownerDb.task.createMany({ data: parents });
  await ownerDb.task.createMany({ data: tasks.filter((t) => t.parentId) });
  await ownerDb.taskDependency.createMany({ data: deps });
  expect(await ownerDb.task.count()).toBe(3000);

  await injectSession(context, m.id);
  await gotoTimeline(page); // 데우기(첫 요청 컴파일·캐시)
  const runs: number[] = [];
  const breakdown: string[] = [];
  for (let i = 0; i < 3; i += 1) {
    // 측정 중에는 Playwright 선택자 폴링(큰 DOM 을 반복 탐색)이 끼어들지 않게, 고정 시간 뒤 한 번만 읽는다.
    await page.goto('/timeline', { waitUntil: 'load' });
    await page.waitForTimeout(6_000);
    const gantt = page.locator('[data-testid="gantt"][data-ready="true"]');
    runs.push(Number(await gantt.getAttribute('data-ready-ms')));
    const nav = await page.evaluate(() => {
      const n = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
      const mounted = performance.getEntriesByName('gantt-mounted')[0]?.startTime ?? -1;
      return { ttfb: n.responseStart, html: n.responseEnd, dcl: n.domContentLoadedEventEnd, bytes: n.transferSize, mounted, nodes: document.getElementsByTagName('*').length, bars: document.querySelectorAll('.wx-bar').length };
    });
    breakdown.push(`ttfb ${Math.round(nav.ttfb)} / html ${Math.round(nav.html)} / dcl ${Math.round(nav.dcl)} / mount ${Math.round(nav.mounted)} / ${Math.round(nav.bytes / 1024)}KB / DOM ${nav.nodes} / bars ${nav.bars}`);
  }
  console.log(`[N-01] 구간(ms): ${breakdown.join(' | ')}`);
  await expect(page.getByTestId('timeline-count')).toContainText('3,000');
  await expect(page.locator('.wx-bar').first()).toBeVisible();
  const best = Math.min(...runs);
  test.info().annotations.push({ type: 'N-01', description: `3,000건 첫 표시(이동 시작→간트 두 번째 프레임) ${runs.join(', ')}ms` });
  console.log(`[N-01] 3,000건 첫 표시 ms: ${runs.join(', ')} (최소 ${best})`);
  expect(Math.max(...runs)).toBeLessThan(2_000);
});

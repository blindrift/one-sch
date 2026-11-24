import { createHash, randomBytes } from 'node:crypto';
import { expect, test as base, type BrowserContext, type Locator, type Page, type Request } from '@playwright/test';
import type { Role } from '@prisma/client';
import { seed } from '../../prisma/seed';
import { ownerDb, resetDb } from '../helpers/db';

export const COOKIE = 'authjs.session-token';
export const INVALID = '아이디 또는 비밀번호가 올바르지 않습니다.';
export const NEW_PASSWORD = 'e2e-Strong-pass-42';

let ipSeq = 0;
/**
 * 테스트마다 다른 클라이언트 IP(프록시가 덮어쓰는 X-Real-IP)로 IP 제한이 섞이지 않게 한다.
 * 워커 번호를 섞어 워커가 늘어도 겹치지 않게 한다.
 */
export function nextIp(workerIndex = 0) {
  ipSeq += 1;
  return `198.${18 + (workerIndex % 200)}.${Math.floor(ipSeq / 250) % 250}.${(ipSeq % 250) + 1}`;
}

export const test = base.extend<{ ip: string }>({
  // eslint 의 React hooks 규칙이 'use' 라는 이름에 반응하므로 provide 로 부른다.
  ip: async ({}, provide, testInfo) => {
    await provide(nextIp(testInfo.workerIndex));
  },
  context: async ({ browser, ip }, provide) => {
    const context = await browser.newContext({ extraHTTPHeaders: { 'X-Real-IP': ip } });
    await provide(context);
    await context.close();
  },
});

export { expect };

export async function resetAndSeed() {
  await resetDb();
  await seed(ownerDb);
}

/** 이동 후 하이드레이션까지 기다린다(그 전에 클릭하면 Server Action 이 아니라 일반 폼 제출이 된다). */
export async function gotoReady(page: Page, path: string) {
  await page.goto(path);
  await page.locator('html[data-hydrated="true"]').waitFor();
}

/** 화면별 폼 오류 영역(Next route announcer 의 role=alert 와 구분하려고 test id 로 찾는다) */
export type FormErrorId =
  | 'login-error'
  | 'change-password-error'
  | 'admin-users-error'
  | 'create-user-error'
  | 'project-form-error'
  | 'projects-error'
  | 'task-form-error'
  | 'timeline-message';
export function formError(page: Page, id: FormErrorId) {
  return page.getByTestId(id);
}

/** 로그인 폼을 제출하고 결과(이동 또는 오류 표시)가 나올 때까지 기다린다. */
export async function login(page: Page, username: string, password: string) {
  await gotoReady(page, '/login');
  await page.getByLabel('아이디').fill(username);
  await page.getByLabel('비밀번호').fill(password);
  const before = page.url();
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await expect
    .poll(async () => page.url() !== before || (await formError(page, 'login-error').isVisible()), { timeout: 15_000 })
    .toBe(true);
}

/** 브라우저 로그인 없이 세션을 만든다(구글 계정 사용자 대신). */
export async function injectSession(context: BrowserContext, userId: string) {
  const raw = randomBytes(32).toString('base64url');
  await ownerDb.session.create({
    data: {
      sessionToken: createHash('sha256').update(raw).digest('hex'),
      userId,
      expires: new Date(Date.now() + 8 * 60 * 60 * 1000),
    },
  });
  await context.addCookies([{ name: COOKIE, value: raw, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
  return raw;
}

export async function auditActions() {
  const rows = await ownerDb.auditLog.findMany({ orderBy: { id: 'asc' }, select: { action: true } });
  return rows.map((r) => r.action);
}

/** CSP 위반 콘솔 메시지를 모은다. */
export function collectCspViolations(page: Page): string[] {
  const out: string[] = [];
  page.on('console', (msg) => {
    if (/Content Security Policy|Refused to/i.test(msg.text())) out.push(msg.text());
  });
  return out;
}

export { ownerDb };

// ---- 일정(2단계) ----

/** `YYYY-MM-DD` → @db.Date 입력값(UTC 자정) */
export const day = (ymd: string) => new Date(`${ymd}T00:00:00Z`);
export const ymdOf = (d: Date) => d.toISOString().slice(0, 10);

/** 일 줌의 칸 너비(src/components/gantt/scales.ts SCALES.day.cellWidth 와 같아야 한다) */
export const DAY_CELL = 32;

let userSeq = 0;
export async function createUser(role: Role, name = `${role} 사용자`) {
  userSeq += 1;
  return ownerDb.user.create({ data: { email: `${role.toLowerCase()}${userSeq}-${Date.now()}@example.com`, name, role } });
}

export async function createProject(ownerId: string, data: { key: string; name?: string; color?: string; archived?: boolean; startDate?: string; endDate?: string }) {
  return ownerDb.project.create({
    data: {
      key: data.key,
      name: data.name ?? `${data.key} 프로젝트`,
      color: data.color ?? '#2563eb',
      ownerId,
      archived: data.archived ?? false,
      startDate: data.startDate ? day(data.startDate) : null,
      endDate: data.endDate ? day(data.endDate) : null,
    },
  });
}

let sortSeq = 0;
export async function createTask(
  projectId: string,
  data: { title: string; start: string; end: string; parentId?: string; progress?: number; assigneeId?: string; isMilestone?: boolean; status?: 'TODO' | 'IN_PROGRESS' | 'BLOCKED' | 'DONE' },
) {
  sortSeq += 1;
  return ownerDb.task.create({
    data: {
      projectId,
      title: data.title,
      startDate: day(data.start),
      endDate: day(data.end),
      parentId: data.parentId ?? null,
      progress: data.progress ?? 0,
      assigneeId: data.assigneeId ?? null,
      isMilestone: data.isMilestone ?? false,
      status: data.status ?? 'TODO',
      sortOrder: sortSeq,
    },
  });
}

/** 간트 막대(SVAR 는 data-id 에 ':' 를 붙인다) */
export function bar(page: Page, id: string): Locator {
  return page.locator(`.wx-bar[data-id=":${id}"]`);
}

/** 타임라인으로 이동해 간트가 그려질 때까지 기다린다. */
export async function gotoTimeline(page: Page, path = '/timeline') {
  await gotoReady(page, path);
  await page.locator('[data-testid="gantt"][data-ready="true"]').waitFor();
}

/** 차트의 빈 곳을 (x0,y) 에서 (x1,y) 로 끈다(빈 곳 끌기로 작업 추가). 여러 단계로 움직인다. */
export async function dragEmpty(page: Page, y: number, x0: number, x1: number) {
  await page.mouse.move(x0, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i += 1) await page.mouse.move(x0 + ((x1 - x0) * i) / 8, y, { steps: 2 });
  await page.mouse.up();
}

/**
 * 막대를 마우스로 끈다. at='move' 는 가운데, 'end' 는 오른쪽 끝(SVAR 는 너비의 마지막 20% 를 끝 늘이기로 본다).
 * 여러 단계로 움직여 SVAR 의 드래그 판정(20px 이상)을 확실히 넘긴다.
 */
export async function dragBar(page: Page, target: Locator, dx: number, at: 'move' | 'end' = 'move') {
  const box = await target.boundingBox();
  if (!box) throw new Error('막대가 보이지 않습니다.');
  const x = at === 'end' ? box.x + box.width * 0.92 : box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i += 1) await page.mouse.move(x + (dx * i) / 12, y, { steps: 2 });
  await page.mouse.up();
}

// ---- 이슈·보기(3단계) ----

/**
 * Server Action 호출(POST + next-action 헤더)을 센다. 거부된 조작이 서버 쓰기 요청을 아예 만들지 않았는지 확인한다.
 * settle(): 늦게 나가는 요청도 잡도록 최대 ms 동안 액션 요청을 기다린다(오면 즉시 끝나고 count 로 실패가 드러난다).
 */
export function watchActions(page: Page) {
  const isAction = (req: Request) => req.method() === 'POST' && req.headers()['next-action'] !== undefined;
  const seen: string[] = [];
  page.on('request', (req) => {
    if (isAction(req)) seen.push(req.url());
  });
  return {
    count: () => seen.length,
    settle: (ms = 1_000) =>
      page.waitForRequest(isAction, { timeout: ms }).then(
        () => undefined,
        () => undefined,
      ),
  };
}

/** DB 에 이슈를 바로 만든다(번호는 프로젝트 issueSeq 와 맞춘다) */
export async function createIssue(
  projectId: string,
  reporterId: string,
  data: {
    title: string;
    description?: string;
    status?: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
    type?: 'ISSUE' | 'RISK' | 'REQUEST';
    priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
    assigneeId?: string;
    dueDate?: string;
  },
) {
  const p = await ownerDb.project.update({ where: { id: projectId }, data: { issueSeq: { increment: 1 } }, select: { issueSeq: true } });
  return ownerDb.issue.create({
    data: {
      projectId,
      reporterId,
      number: p.issueSeq,
      title: data.title,
      description: data.description ?? '',
      status: data.status ?? 'OPEN',
      type: data.type ?? 'ISSUE',
      priority: data.priority ?? 'MEDIUM',
      assigneeId: data.assigneeId ?? null,
      dueDate: data.dueDate ? day(data.dueDate) : null,
    },
  });
}

/** 마우스로 요소를 다른 요소 위로 끈다(dnd-kit: 몇 px 움직여 끌기를 시작한 뒤 여러 단계로 옮긴다) */
export async function dragTo(page: Page, from: Locator, to: Locator, opts: { toY?: 'top' | 'center' } = {}) {
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  if (!a || !b) throw new Error('끌 대상이 보이지 않습니다.');
  const x0 = a.x + a.width / 2;
  const y0 = a.y + a.height / 2;
  const x1 = b.x + b.width / 2;
  const y1 = opts.toY === 'top' ? b.y + 4 : b.y + b.height / 2;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x0 + 8, y0 + 8, { steps: 2 });
  for (let i = 1; i <= 10; i += 1) await page.mouse.move(x0 + ((x1 - x0) * i) / 10, y0 + ((y1 - y0) * i) / 10, { steps: 2 });
  await page.waitForTimeout(100);
  await page.mouse.up();
}

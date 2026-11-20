import { createHash, randomBytes } from 'node:crypto';
import { expect, test as base, type BrowserContext, type Page } from '@playwright/test';
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
export type FormErrorId = 'login-error' | 'change-password-error' | 'admin-users-error' | 'create-user-error';
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

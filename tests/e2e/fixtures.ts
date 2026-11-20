import { createHash, randomBytes } from 'node:crypto';
import { expect, test as base, type BrowserContext, type Page } from '@playwright/test';
import { seed } from '../../prisma/seed';
import { ownerDb, resetDb } from '../helpers/db';

export const COOKIE = 'authjs.session-token';
export const INVALID = '아이디 또는 비밀번호가 올바르지 않습니다.';
export const NEW_PASSWORD = 'e2e-Strong-pass-42';

let ipSeq = 0;
/** 테스트마다 다른 클라이언트 IP(프록시가 붙인 XFF 가장 오른쪽 값)로 IP 제한이 섞이지 않게 한다. */
export function nextIp() {
  ipSeq += 1;
  return `198.51.100.${(ipSeq % 250) + 1}`;
}

export const test = base.extend<{ ip: string }>({
  // eslint 의 React hooks 규칙이 'use' 라는 이름에 반응하므로 provide 로 부른다.
  ip: async ({}, provide) => {
    await provide(nextIp());
  },
  context: async ({ browser, ip }, provide) => {
    const context = await browser.newContext({ extraHTTPHeaders: { 'X-Forwarded-For': ip } });
    await provide(context);
    await context.close();
  },
});

export { expect };

export async function resetAndSeed() {
  await resetDb();
  await seed(ownerDb);
}

export async function login(page: Page, username: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('아이디').fill(username);
  await page.getByLabel('비밀번호').fill(password);
  await page.getByRole('button', { name: '로그인', exact: true }).click();
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

export async function changeInitialPassword(page: Page) {
  await login(page, 'admin', 'admin');
  await page.waitForURL('**/change-password');
  await page.getByLabel('현재 비밀번호').fill('admin');
  await page.getByLabel('새 비밀번호', { exact: true }).fill(NEW_PASSWORD);
  await page.getByLabel('새 비밀번호 확인').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: '변경' }).click();
  await page.waitForURL('**/timeline');
}

export { ownerDb };

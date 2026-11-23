import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// E2E 는 통합 테스트(onesch_test)와 동시에 돌아도 섞이지 않도록 별도 DB(onesch_e2e)를 쓴다.
// 접속 정보는 TEST_* URL 의 DB 이름만 바꿔 만든다(새 env 키 없음). 각 스펙이 시작할 때 DB 를 비우고 admin 을 시드한다.
if (existsSync('.env.local')) process.loadEnvFile('.env.local');
const toE2e = (url: string | undefined) => url?.replace(/\/onesch_test(?=\?|$)/, '/onesch_e2e');
for (const key of ['TEST_DATABASE_URL', 'TEST_MIGRATE_DATABASE_URL', 'TEST_ADMIN_DATABASE_URL'] as const) {
  const url = process.env[key];
  if (!url) throw new Error(`${key} 가 필요합니다(.env.local).`);
  const e2e = url.includes('/onesch_e2e') ? url : toE2e(url);
  // 치환이 안 되면(DB 이름이 onesch_test 가 아님) 통합 테스트 DB 를 E2E 가 지우게 되므로 멈춘다.
  if (!e2e || new URL(e2e).pathname !== '/onesch_e2e') {
    throw new Error(`${key} 를 onesch_e2e 로 바꾸지 못했습니다: DB 이름이 onesch_test 여야 합니다.`);
  }
  process.env[key] = e2e;
}

const PORT = 3100;
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  globalSetup: './tests/e2e/global-setup.ts',
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run build && npx next start -p ${PORT}`,
    url: `${baseURL}/api/health`,
    timeout: 240_000,
    reuseExistingServer: false,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? '',
      AUTH_URL: baseURL,
      AUTH_SECRET: process.env.AUTH_SECRET ?? randomBytes(32).toString('base64'),
      // 비어 있으면 Auth.js 가 설정 오류를 낼 수 있어 더미 값을 준다(구글 로그인 자체는 E2E 대상 아님).
      AUTH_GOOGLE_ID: 'e2e-dummy-client-id',
      AUTH_GOOGLE_SECRET: 'e2e-dummy-client-secret',
      CLIENT_IP_HEADER: 'x-real-ip',
      LOCAL_LOGIN_ENABLED: 'true',
      TZ: 'Asia/Seoul',
    },
  },
});

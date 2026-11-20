import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// 통합 테스트와 같은 테스트 DB(onesch_test)를 쓴다. 각 스펙이 시작할 때 DB 를 비우고 admin 을 시드한다.
if (existsSync('.env.local')) process.loadEnvFile('.env.local');

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
      AUTH_GOOGLE_ID: '',
      AUTH_GOOGLE_SECRET: '',
      LOCAL_LOGIN_ENABLED: 'true',
      ENABLE_POC: 'false',
      TZ: 'Asia/Seoul',
    },
  },
});

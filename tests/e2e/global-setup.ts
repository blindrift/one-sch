import { execFileSync } from 'node:child_process';

export default function globalSetup() {
  const url = process.env.TEST_MIGRATE_DATABASE_URL;
  if (!url || !process.env.TEST_DATABASE_URL || !process.env.TEST_ADMIN_DATABASE_URL) {
    throw new Error('TEST_DATABASE_URL·TEST_MIGRATE_DATABASE_URL·TEST_ADMIN_DATABASE_URL 이 필요합니다(.env.local).');
  }
  execFileSync('node_modules/.bin/prisma', ['migrate', 'deploy'], {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url },
  });
}

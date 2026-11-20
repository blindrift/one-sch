import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

/**
 * 통합 테스트 DB(onesch_test)에 마이그레이션을 적용한다.
 * migrate reset 은 public 스키마를 지웠다 다시 만들어 db-init 의 권한 설정이 사라지므로 쓰지 않는다.
 * 테스트 사이 정리는 tests/helpers/db.ts 의 resetDb() 가 한다.
 */
export default function setup() {
  if (existsSync('.env.local')) process.loadEnvFile('.env.local');
  const url = process.env.TEST_MIGRATE_DATABASE_URL;
  if (!url || !process.env.TEST_DATABASE_URL) {
    throw new Error('TEST_DATABASE_URL·TEST_MIGRATE_DATABASE_URL 이 필요합니다(.env.local).');
  }
  execFileSync('node_modules/.bin/prisma', ['migrate', 'deploy'], {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url },
  });
}

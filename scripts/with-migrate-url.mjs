#!/usr/bin/env node
// 개발 PC 에서 마이그레이션·시드를 onesch_owner 로 실행한다.
// .env.local 을 읽고 DATABASE_URL 을 MIGRATE_DATABASE_URL 로 바꿔 명령을 실행한다.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');

const url = process.env.MIGRATE_DATABASE_URL;
if (!url) {
  console.error('MIGRATE_DATABASE_URL 이 없습니다(.env.local).');
  process.exit(1);
}

const [cmd, ...args] = process.argv.slice(2);
const result = spawnSync(`node_modules/.bin/${cmd}`, args, {
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: url },
});
process.exit(result.status ?? 1);

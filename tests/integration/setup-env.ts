import { existsSync } from 'node:fs';

// 앱 코드(@/server/db)는 DATABASE_URL 을 읽으므로 테스트 DB 의 앱 역할(onesch_app)로 바꿔 둔다.
if (existsSync('.env.local')) process.loadEnvFile('.env.local');
// 운영과 같은 연결 풀 크기(connection_limit=5)로 돌려 병렬 트랜잭션 테스트가 같은 조건에서 검증되게 하고,
// 느린 PC 에서 풀 대기로 실패하지 않도록 pool_timeout 은 넉넉히 둔다.
function withPool(url: string | undefined): string | undefined {
  if (!url) return url;
  const u = new URL(url);
  if (!u.searchParams.has('connection_limit')) u.searchParams.set('connection_limit', '5');
  if (!u.searchParams.has('pool_timeout')) u.searchParams.set('pool_timeout', '30');
  return u.toString();
}
process.env.TEST_DATABASE_URL = withPool(process.env.TEST_DATABASE_URL);
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.AUTH_URL ??= 'http://localhost:3000';
process.env.LOCAL_LOGIN_ENABLED = 'true';

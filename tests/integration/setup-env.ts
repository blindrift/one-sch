import { existsSync } from 'node:fs';

// 앱 코드(@/server/db)는 DATABASE_URL 을 읽으므로 테스트 DB 의 앱 역할(onesch_app)로 바꿔 둔다.
if (existsSync('.env.local')) process.loadEnvFile('.env.local');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.AUTH_URL ??= 'http://localhost:3000';
process.env.LOCAL_LOGIN_ENABLED = 'true';

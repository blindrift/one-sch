import { prisma } from '@/server/db';
import { log } from '@/server/log';

// 인증 없음(컨테이너 healthcheck). DB 연결만 확인하고 버전 등 내부 정보는 내보내지 않는다.
export const dynamic = 'force-dynamic';

const headers = { 'Cache-Control': 'no-store' };

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ status: 'ok' }, { headers });
  } catch (err) {
    log.error('health.db_error', { err });
    return Response.json({ status: 'error' }, { status: 503, headers });
  }
}

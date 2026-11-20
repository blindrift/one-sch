// 사용자가 한 명도 없을 때만 기본 admin(비밀번호 admin, 첫 로그인 시 변경 강제)을 만든다.
// migrate 서비스(onesch_owner)가 migrate deploy 다음에 실행한다. 여러 번 실행해도 결과가 같다.
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/server/auth/password';

export const SEED_LOCK_KEY = 74_201_120; // 임의 고정값(pg_advisory_xact_lock 키)

export async function seed(prisma: PrismaClient): Promise<'created' | 'skipped'> {
  const passwordHash = await hashPassword('admin');
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SEED_LOCK_KEY})`;
    if ((await tx.user.count()) > 0) return 'skipped';
    const admin = await tx.user.create({
      data: {
        username: 'admin',
        name: '관리자',
        role: 'ADMIN',
        passwordHash,
        mustChangePassword: true,
      },
    });
    await tx.auditLog.create({
      data: { action: 'user.seed_admin', entity: 'User', entityId: admin.id, after: { username: 'admin', role: 'ADMIN' } },
    });
    return 'created';
  });
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const result = await seed(prisma);
    console.log(
      JSON.stringify({
        level: result === 'created' ? 'warn' : 'info',
        msg: result === 'created' ? 'seed.admin_created: 즉시 admin 으로 로그인해 비밀번호를 바꾸세요' : 'seed.skipped',
      }),
    );
  } finally {
    await prisma.$disconnect();
  }
}

// tsx prisma/seed.ts 로 직접 실행할 때만 main 을 돌린다(테스트에서 import 할 때는 실행하지 않음).
if (process.argv[1]?.endsWith('seed.ts')) {
  main().catch((err) => {
    console.error(JSON.stringify({ level: 'error', msg: 'seed.failed', error: String(err) }));
    process.exit(1);
  });
}

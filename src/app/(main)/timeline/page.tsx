import { requirePage } from '@/server/auth/require-role';

export default async function TimelinePage() {
  await requirePage('VIEWER');

  return (
    <main className="p-6">
      <h1 className="text-xl font-semibold">전체 타임라인</h1>
      <p className="mt-2 text-sm text-muted-foreground">2단계에서 프로젝트 간트가 들어갈 자리입니다.</p>
    </main>
  );
}

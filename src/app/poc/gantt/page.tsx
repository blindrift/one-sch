import { notFound } from 'next/navigation';
import { requirePage } from '@/server/auth/require-role';
import { GanttPocLoader } from './gantt-poc-loader';

// 1단계 간트 라이브러리 PoC. ADMIN 만, ENABLE_POC=true 일 때만 보인다(운영 기본 false).
export default async function GanttPocPage({ searchParams }: { searchParams: Promise<{ n?: string }> }) {
  await requirePage('ADMIN');
  if (process.env.ENABLE_POC !== 'true') notFound();

  const n = Number((await searchParams).n ?? '300');
  const count = Number.isInteger(n) ? Math.min(Math.max(n, 10), 5000) : 300;

  return (
    <main className="flex flex-col gap-3 p-4">
      <h1 className="text-lg font-semibold">간트 PoC (SVAR React Gantt MIT)</h1>
      <GanttPocLoader count={count} />
    </main>
  );
}

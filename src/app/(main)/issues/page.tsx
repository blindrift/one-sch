import { CircleDot } from 'lucide-react';
import { AppShell, PageTitle } from '@/components/app-shell';
import { requirePage } from '@/server/auth/require-role';

// 전체 이슈(보관되지 않은 프로젝트)
export default async function IssuesPage() {
  const me = await requirePage('VIEWER');
  return (
    <AppShell me={me} title={<PageTitle icon={<CircleDot className="size-4" />}>전체 이슈</PageTitle>}>
      <p className="p-6 text-sm text-muted-foreground">준비 중입니다.</p>
    </AppShell>
  );
}

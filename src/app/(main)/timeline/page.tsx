import { ChartGantt } from 'lucide-react';
import { AppShell, PageTitle, ViewTabs } from '@/components/app-shell';
import { isZoom } from '@/components/gantt/scales';
import { hasRole } from '@/lib/roles';
import { requirePage } from '@/server/auth/require-role';
import { loadTimeline } from '@/server/services/timeline-service';
import { parseTimelineQuery, type TimelineSearchParams } from './query';
import { TimelineView } from './timeline-view';

export default async function TimelinePage({ searchParams }: { searchParams: Promise<TimelineSearchParams> }) {
  const me = await requirePage('VIEWER');
  const sp = await searchParams;
  const includeArchived = sp.archived === '1';
  const data = await loadTimeline({ includeArchived });

  return (
    // fill: 간트 틀이 남은 높이를 정확히 채운다(높이가 정해진 부모 — 행 가상화 조건).
    <AppShell me={me} fill projects={data.projects} title={<PageTitle icon={<ChartGantt className="size-4" />}>전체 타임라인</PageTitle>}>
      <ViewTabs label="보기 탭" tabs={[{ label: '간트', icon: <ChartGantt className="size-3.5" aria-hidden />, active: true }]} />
      <TimelineView
        data={data}
        canEdit={hasRole(me.role, 'MEMBER')}
        initialFilter={parseTimelineQuery(sp)}
        initialZoom={isZoom(sp.zoom) ? sp.zoom : 'day'}
        scope={{ kind: 'all', includeArchived }}
      />
    </AppShell>
  );
}

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
    <main className="flex h-[calc(100vh-3rem)] flex-col">
      <h1 className="sr-only">전체 타임라인</h1>
      <TimelineView
        data={data}
        canEdit={hasRole(me.role, 'MEMBER')}
        initialFilter={parseTimelineQuery(sp)}
        initialZoom={isZoom(sp.zoom) ? sp.zoom : 'day'}
        scope={{ kind: 'all', includeArchived }}
      />
    </main>
  );
}

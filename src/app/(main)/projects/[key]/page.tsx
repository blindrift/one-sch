import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { isZoom } from '@/components/gantt/scales';
import { EMPTY_FILTER } from '@/components/gantt/timeline-store';
import { hasRole } from '@/lib/roles';
import { PROJECT_STATUS_LABELS } from '@/lib/schedule/status';
import { PROJECT_KEY_RE } from '@/lib/validation/limits';
import { requirePage } from '@/server/auth/require-role';
import { findProjectByKey, loadTimeline } from '@/server/services/timeline-service';
import { parseTimelineQuery, type TimelineSearchParams } from '../../timeline/query';
import { TimelineView } from '../../timeline/timeline-view';

// 프로젝트 화면(D9): 2단계는 간트 탭만. 보드·목록·이슈 탭은 3단계에서 붙인다.
export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<TimelineSearchParams>;
}) {
  const me = await requirePage('VIEWER');
  const { key } = await params;
  const project = PROJECT_KEY_RE.test(key) ? await findProjectByKey(key) : null;
  if (!project) notFound();
  const sp = await searchParams;
  const data = await loadTimeline({ projectId: project.id });

  return (
    <main className="flex h-[calc(100vh-3rem)] flex-col">
      <div className="flex items-center gap-3 border-b px-4 py-2">
        <span className="inline-block size-3 rounded-sm" style={{ background: project.color }} aria-hidden />
        <h1 className="font-semibold">
          <span className="font-mono">{project.key}</span> {project.name}
        </h1>
        <Badge variant="outline">{PROJECT_STATUS_LABELS[project.status]}</Badge>
        {project.archived ? <Badge variant="secondary">보관(읽기 전용)</Badge> : null}
        <nav className="ml-4 flex gap-1 text-sm" aria-label="프로젝트 탭">
          <span className="rounded-md bg-muted px-2 py-1 font-medium" aria-current="page">
            간트
          </span>
        </nav>
        <Link href="/projects" className="ml-auto text-sm text-muted-foreground underline-offset-4 hover:underline">
          프로젝트 목록
        </Link>
      </div>
      <TimelineView
        data={data}
        canEdit={hasRole(me.role, 'MEMBER')}
        initialFilter={{ ...parseTimelineQuery(sp), projectKey: EMPTY_FILTER.projectKey }}
        initialZoom={isZoom(sp.zoom) ? sp.zoom : 'day'}
        scope={{ kind: 'project', projectId: project.id }}
      />
    </main>
  );
}

import { ChartGantt, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AppShell, ViewTabs } from '@/components/app-shell';
import { isZoom } from '@/components/gantt/scales';
import { EMPTY_FILTER } from '@/components/gantt/timeline-store';
import { ProjectStatusBadge } from '@/components/project-status-badge';
import { hasRole } from '@/lib/roles';
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

  const title = (
    <>
      <Link href="/projects" className="shrink-0 text-[13px] text-text-subtle transition-colors hover:text-foreground">
        프로젝트
      </Link>
      <ChevronRight className="size-3.5 shrink-0 text-text-subtle" aria-hidden />
      <span className="size-3 shrink-0 rounded-[4px]" style={{ background: project.color }} aria-hidden />
      <h1 className="truncate text-[15px] font-semibold">
        <span className="font-mono text-text-subtle">{project.key}</span> {project.name}
      </h1>
      <ProjectStatusBadge status={project.status} />
      {project.archived ? (
        <span className="inline-flex h-5 shrink-0 items-center rounded-full border border-line bg-surface-muted px-2 text-xs text-muted-foreground">
          보관(읽기 전용)
        </span>
      ) : null}
    </>
  );

  return (
    <AppShell me={me} fill title={title}>
      <ViewTabs label="프로젝트 탭" tabs={[{ label: '간트', icon: <ChartGantt className="size-3.5" aria-hidden />, active: true }]} />
      <TimelineView
        data={data}
        canEdit={hasRole(me.role, 'MEMBER')}
        initialFilter={{ ...parseTimelineQuery(sp), projectKey: EMPTY_FILTER.projectKey }}
        initialZoom={isZoom(sp.zoom) ? sp.zoom : 'day'}
        scope={{ kind: 'project', projectId: project.id }}
      />
    </AppShell>
  );
}

import { notFound } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { isZoom } from '@/components/gantt/scales';
import { EMPTY_FILTER } from '@/components/gantt/timeline-store';
import { ProjectTabs, ProjectTitle } from '@/components/project-header';
import { hasRole } from '@/lib/roles';
import { PROJECT_KEY_RE } from '@/lib/validation/limits';
import { requirePage } from '@/server/auth/require-role';
import { findProjectByKey, loadTimeline } from '@/server/services/timeline-service';
import { parseTimelineQuery, type TimelineSearchParams } from '../../timeline/query';
import { TimelineView } from '../../timeline/timeline-view';

// 프로젝트 화면(D9) 간트 탭. 보드·목록·이슈 탭은 같은 폴더의 board·list·issues.
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
    <AppShell me={me} fill title={<ProjectTitle project={project} />}>
      <ProjectTabs projectKey={project.key} active="gantt" />
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

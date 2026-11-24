import { notFound } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { IssueDetailPanel, IssueNotFoundPanel } from '@/components/issues/issue-detail-panel';
import { ProjectTabs, ProjectTitle } from '@/components/project-header';
import { todayInSeoul } from '@/lib/dates';
import type { SearchParams } from '@/lib/list-query';
import { hasRole } from '@/lib/roles';
import { PROJECT_KEY_RE } from '@/lib/validation/limits';
import { requirePage } from '@/server/auth/require-role';
import { getIssueDetail, listTaskOptions, loadIssueBoard } from '@/server/services/issue-query-service';
import { findProjectByKey, listUserOptions, loadTimeline } from '@/server/services/timeline-service';
import { BoardToolbar, IssueBoard, TaskBoard } from './board-view';

// 프로젝트 보드 탭: 상태 열 칸반(작업 | 이슈 ?kind=issue). 작업은 기본으로 하위 없는 작업·마일스톤만, ?parents=1 이면 상위도(D20).
export default async function ProjectBoardPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<SearchParams> }) {
  const me = await requirePage('VIEWER');
  const { key } = await params;
  const project = PROJECT_KEY_RE.test(key) ? await findProjectByKey(key) : null;
  if (!project) notFound();
  const sp = await searchParams;
  const kind = sp.kind === 'issue' ? 'issue' : 'task';
  const includeParents = sp.parents === '1';
  const canEdit = hasRole(me.role, 'MEMBER') && !project.archived;
  const basePath = `/projects/${project.key}/board`;

  let body: React.ReactNode;
  if (kind === 'task') {
    const data = await loadTimeline({ projectId: project.id });
    body = <TaskBoard project={project} data={data} canEdit={canEdit} includeParents={includeParents} />;
  } else {
    const issueKey = typeof sp.issue === 'string' ? sp.issue : null;
    const [board, detail, users, taskOptions] = await Promise.all([
      loadIssueBoard(project.id),
      issueKey ? getIssueDetail(issueKey, project.id) : null,
      listUserOptions(),
      listTaskOptions(project.id),
    ]);
    body = (
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <IssueBoard issues={board.items} truncated={board.truncated} canEdit={canEdit} today={todayInSeoul()} />
        {detail ? (
          <IssueDetailPanel detail={detail} me={me} users={users} taskOptions={taskOptions} closeHref={`${basePath}?kind=issue`} />
        ) : issueKey ? (
          <IssueNotFoundPanel closeHref={`${basePath}?kind=issue`} />
        ) : null}
      </div>
    );
  }

  return (
    <AppShell me={me} fill title={<ProjectTitle project={project} />}>
      <ProjectTabs projectKey={project.key} active="board" />
      <BoardToolbar basePath={basePath} kind={kind} includeParents={includeParents} />
      {body}
    </AppShell>
  );
}

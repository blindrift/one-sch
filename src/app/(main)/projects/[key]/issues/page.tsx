import { notFound } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { IssueWorkspace } from '@/components/issues/issue-workspace';
import { ProjectTabs, ProjectTitle } from '@/components/project-header';
import { todayInSeoul } from '@/lib/dates';
import { parseIssueListQuery, type SearchParams } from '@/lib/list-query';
import { hasRole } from '@/lib/roles';
import { PROJECT_KEY_RE } from '@/lib/validation/limits';
import { requirePage } from '@/server/auth/require-role';
import { getIssueDetail, listIssues, listTaskOptions } from '@/server/services/issue-query-service';
import { findProjectByKey, listUserOptions } from '@/server/services/timeline-service';

// 프로젝트 이슈 탭: 목록 + 상세 패널(?issue=KEY-n). 보관 프로젝트는 읽기 전용(D18).
export default async function ProjectIssuesPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<SearchParams> }) {
  const me = await requirePage('VIEWER');
  const { key } = await params;
  const project = PROJECT_KEY_RE.test(key) ? await findProjectByKey(key) : null;
  if (!project) notFound();
  const sp = await searchParams;
  const query = parseIssueListQuery({ ...sp, project: undefined });
  const issueKey = typeof sp.issue === 'string' ? sp.issue : null;
  const [list, detail, users, taskOptions] = await Promise.all([
    listIssues({ kind: 'project', projectId: project.id }, query),
    issueKey ? getIssueDetail(issueKey, project.id) : null,
    listUserOptions(),
    listTaskOptions(project.id),
  ]);
  const canCreate = hasRole(me.role, 'MEMBER') && !project.archived;

  return (
    <AppShell me={me} fill title={<ProjectTitle project={project} />}>
      <ProjectTabs projectKey={project.key} active="issues" />
      <IssueWorkspace
        basePath={`/projects/${project.key}/issues`}
        query={query}
        list={list}
        detail={detail}
        requestedKey={issueKey}
        detailTaskOptions={taskOptions}
        me={me}
        users={users}
        today={todayInSeoul()}
        createProjects={canCreate ? [{ id: project.id, key: project.key, name: project.name }] : null}
        createTaskOptions={taskOptions}
      />
    </AppShell>
  );
}

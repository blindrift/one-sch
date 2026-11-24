import { CircleDot } from 'lucide-react';
import { AppShell, PageTitle } from '@/components/app-shell';
import { IssueWorkspace } from '@/components/issues/issue-workspace';
import { todayInSeoul } from '@/lib/dates';
import { parseIssueListQuery, type SearchParams } from '@/lib/list-query';
import { hasRole } from '@/lib/roles';
import { requirePage } from '@/server/auth/require-role';
import { getIssueDetail, listIssues, listTaskOptions } from '@/server/services/issue-query-service';
import { listProjects, listUserOptions } from '@/server/services/timeline-service';

// 전체 이슈: 보관되지 않은 프로젝트의 이슈(프로젝트 필터로 보관 프로젝트를 고르면 읽기 전용으로 보인다).
export default async function IssuesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const me = await requirePage('VIEWER');
  const sp = await searchParams;
  const query = parseIssueListQuery(sp);
  const issueKey = typeof sp.issue === 'string' ? sp.issue : null;
  const [projects, list, detail, users] = await Promise.all([
    listProjects(),
    listIssues({ kind: 'all' }, query),
    issueKey ? getIssueDetail(issueKey) : null,
    listUserOptions(),
  ]);
  const detailTaskOptions = detail ? await listTaskOptions(detail.projectId) : [];
  const writable = projects.filter((p) => !p.archived).map((p) => ({ id: p.id, key: p.key, name: p.name }));

  return (
    <AppShell me={me} fill projects={projects} title={<PageTitle icon={<CircleDot className="size-4" />}>전체 이슈</PageTitle>}>
      <IssueWorkspace
        basePath="/issues"
        query={query}
        list={list}
        detail={detail}
        requestedKey={issueKey}
        detailTaskOptions={detailTaskOptions}
        me={me}
        users={users}
        today={todayInSeoul()}
        projectFilter={projects.map((p) => ({ key: p.key, name: p.archived ? `${p.name}(보관)` : p.name }))}
        createProjects={hasRole(me.role, 'MEMBER') ? writable : null}
      />
    </AppShell>
  );
}

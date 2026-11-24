import { notFound } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { FilterBar } from '@/components/list/filter-bar';
import { Pager, type SortLink } from '@/components/list/pager';
import { ProjectTabs, ProjectTitle } from '@/components/project-header';
import { DEFAULT_TASK_QUERY, isOrderMode, NO_ASSIGNEE, parseTaskListQuery, TASK_SORTS, toQueryString, type SearchParams, type TaskListQuery, type TaskSort } from '@/lib/list-query';
import { hasRole } from '@/lib/roles';
import { TASK_STATUSES, TASK_STATUS_LABELS } from '@/lib/schedule/status';
import { PROJECT_KEY_RE } from '@/lib/validation/limits';
import { requirePage } from '@/server/auth/require-role';
import { listTasks } from '@/server/services/task-list-service';
import { findProjectByKey } from '@/server/services/timeline-service';
import { TaskListView } from './task-list-view';

// 프로젝트 목록 탭: 작업 표. 정렬·필터·검색·페이지는 URL query(새로고침·공유 유지).
export default async function ProjectListPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<SearchParams> }) {
  const me = await requirePage('VIEWER');
  const { key } = await params;
  const project = PROJECT_KEY_RE.test(key) ? await findProjectByKey(key) : null;
  if (!project) notFound();
  const query = parseTaskListQuery(await searchParams);
  const list = await listTasks(project.id, query);

  const base = `/projects/${project.key}/list`;
  // 링크에는 강조(task)를 싣지 않는다(정렬·페이지를 바꾸면 강조는 풀린다)
  const href = (patch: Partial<TaskListQuery>) => `${base}${toQueryString({ ...query, page: list.page, task: null, ...patch }, DEFAULT_TASK_QUERY)}`;
  const sortLink = (sort: TaskSort): SortLink => {
    const active = query.sort === sort;
    return { active, dir: query.dir, href: href({ sort, dir: active && query.dir === 'asc' ? 'desc' : 'asc', page: 1 }) };
  };
  const sortLinks = Object.fromEntries(TASK_SORTS.map((s) => [s, sortLink(s)])) as Record<TaskSort, SortLink>;

  return (
    <AppShell me={me} title={<ProjectTitle project={project} />}>
      <ProjectTabs projectKey={project.key} active="list" />
      <FilterBar
        q={query.q}
        placeholder="작업 제목 검색"
        filters={[
          {
            name: 'status',
            label: '상태 필터',
            value: query.status ?? '',
            options: [{ value: '', label: '모든 상태' }, ...TASK_STATUSES.map((s) => ({ value: s, label: TASK_STATUS_LABELS[s] }))],
          },
          {
            name: 'assignee',
            label: '담당자 필터',
            value: query.assignee ?? '',
            options: [
              { value: '', label: '모든 담당자' },
              { value: NO_ASSIGNEE, label: '(담당자 없음)' },
              ...list.data.users.map((u) => ({ value: u.id, label: u.name })),
            ],
          },
        ]}
      />
      <TaskListView
        project={project}
        rows={list.rows}
        data={list.data}
        canEdit={hasRole(me.role, 'MEMBER') && !project.archived}
        sortLinks={sortLinks}
        orderLink={sortLinks.order}
        orderMode={isOrderMode(query)}
        focusId={list.focusId}
      />
      <Pager page={list.page} pageCount={list.pageCount} total={list.total} hrefFor={(page) => href({ page })} />
    </AppShell>
  );
}

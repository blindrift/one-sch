import { FilterBar, type FilterSpec } from '@/components/list/filter-bar';
import { Pager, type SortLink } from '@/components/list/pager';
import type { IssueDetail } from '@/lib/issue/dto';
import {
  ISSUE_PRIORITIES,
  ISSUE_PRIORITY_LABELS,
  ISSUE_STATUSES,
  ISSUE_STATUS_LABELS,
  ISSUE_TYPES,
  ISSUE_TYPE_LABELS,
} from '@/lib/issue/status';
import { DEFAULT_ISSUE_QUERY, ISSUE_SORTS, NO_ASSIGNEE, toQueryString, type IssueListQuery, type IssueSort } from '@/lib/list-query';
import type { UserOption } from '@/lib/schedule/dto';
import type { SessionUser } from '@/server/auth/current-user';
import type { IssueListPage } from '@/server/services/issue-query-service';
import { NewIssueButton } from './issue-client';
import { IssueDetailPanel, IssueNotFoundPanel } from './issue-detail-panel';
import type { ProjectOption, TaskOption } from './issue-form-dialog';
import { IssueList } from './issue-list';

/**
 * 이슈 화면 본문(프로젝트 이슈 탭·전체 이슈 공용, 서버 렌더): 필터 도구 모음 + 목록 + 상세 패널.
 * 필터·정렬·페이지·선택 이슈는 모두 URL query 다.
 */
export function IssueWorkspace({
  basePath,
  query,
  list,
  detail,
  requestedKey,
  detailTaskOptions,
  me,
  users,
  today,
  projectFilter,
  createProjects,
  createTaskOptions,
}: {
  basePath: string;
  query: IssueListQuery;
  list: IssueListPage;
  detail: IssueDetail | null;
  /** URL 의 ?issue= 값(없으면 null). 있는데 detail 이 없으면 '찾을 수 없음' 안내 */
  requestedKey: string | null;
  detailTaskOptions: TaskOption[];
  me: SessionUser;
  users: UserOption[];
  today: string;
  /** 전체 이슈: 프로젝트 필터 후보(없으면 프로젝트 탭) */
  projectFilter?: { key: string; name: string }[];
  /** 이슈를 만들 수 있으면 대상 프로젝트(없으면 단추 없음) */
  createProjects: ProjectOption[] | null;
  createTaskOptions?: TaskOption[];
}) {
  const href = (patch: Partial<IssueListQuery>, issue: string | null = null) =>
    `${basePath}${toQueryString({ ...query, ...patch }, DEFAULT_ISSUE_QUERY, { issue })}`;
  const sortLink = (sort: IssueSort): SortLink => {
    const active = query.sort === sort;
    return { active, dir: query.dir, href: href({ sort, dir: active && query.dir === 'desc' ? 'asc' : 'desc', page: 1 }) };
  };
  const sortLinks = Object.fromEntries(ISSUE_SORTS.map((s) => [s, sortLink(s)])) as Record<IssueSort, SortLink>;

  const filters: FilterSpec[] = [
    ...(projectFilter
      ? [
          {
            name: 'project',
            label: '프로젝트 필터',
            value: query.project ?? '',
            options: [{ value: '', label: '모든 프로젝트' }, ...projectFilter.map((p) => ({ value: p.key, label: `[${p.key}] ${p.name}` }))],
          },
        ]
      : []),
    {
      name: 'status',
      label: '상태 필터',
      value: query.status ?? '',
      options: [{ value: '', label: '모든 상태' }, ...ISSUE_STATUSES.map((s) => ({ value: s, label: ISSUE_STATUS_LABELS[s] }))],
    },
    {
      name: 'type',
      label: '유형 필터',
      value: query.type ?? '',
      options: [{ value: '', label: '모든 유형' }, ...ISSUE_TYPES.map((t) => ({ value: t, label: ISSUE_TYPE_LABELS[t] }))],
    },
    {
      name: 'priority',
      label: '우선순위 필터',
      value: query.priority ?? '',
      options: [{ value: '', label: '모든 우선순위' }, ...ISSUE_PRIORITIES.map((p) => ({ value: p, label: ISSUE_PRIORITY_LABELS[p] }))],
    },
    {
      name: 'assignee',
      label: '담당자 필터',
      value: query.assignee ?? '',
      options: [{ value: '', label: '모든 담당자' }, { value: NO_ASSIGNEE, label: '(담당자 없음)' }, ...users.map((u) => ({ value: u.id, label: u.name }))],
    },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <FilterBar filters={filters} q={query.q} placeholder="제목 또는 KEY-번호">
        {createProjects ? (
          <NewIssueButton
            projects={createProjects}
            defaultProjectId={createProjects.find((p) => p.key === query.project)?.id ?? createProjects[0]?.id} users={users} taskOptions={createTaskOptions} />
        ) : null}
      </FilterBar>
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="min-h-0 flex-1 overflow-y-auto bg-surface-sunken">
          <div className="p-4">
            <IssueList
              items={list.items}
              hrefFor={(key) => href({}, key)}
              sortLinks={sortLinks}
              selectedKey={detail?.key ?? null}
              showProject={!!projectFilter}
              today={today}
            />
          </div>
          <Pager page={list.page} pageCount={list.pageCount} total={list.total} hrefFor={(page) => href({ page }, detail?.key ?? null)} />
        </div>
        {detail ? (
          <IssueDetailPanel detail={detail} me={me} users={users} taskOptions={detailTaskOptions} closeHref={href({})} />
        ) : requestedKey ? (
          <IssueNotFoundPanel closeHref={href({})} />
        ) : null}
      </div>
    </div>
  );
}

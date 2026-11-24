import 'server-only';
import type { Prisma } from '@prisma/client';
import type { IssueDetail, IssueListItem } from '@/lib/issue/dto';
import { parseIssueKey } from '@/lib/issue/status';
import { NO_ASSIGNEE, PAGE_SIZE, type IssueListQuery } from '@/lib/list-query';
import { prisma } from '../db';
import { toCommentDto } from './comment-service';
import { toIssueDto } from './issue-dto';

export type IssueListPage = { items: IssueListItem[]; total: number; page: number; pageCount: number };

export type IssueScope =
  /** 프로젝트 이슈 탭: 그 프로젝트만(보관 여부 무관) */
  | { kind: 'project'; projectId: string }
  /** `/issues`: 보관되지 않은 프로젝트 전체. query.project 로 한 프로젝트를 고르면 보관 프로젝트도 보인다 */
  | { kind: 'all' };

/** LIKE 패턴 특수 문자(\ % _)를 글자 그대로 찾도록 이스케이프한다(Prisma contains 는 이스케이프하지 않는다) */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function whereOf(scope: IssueScope, q: IssueListQuery): Prisma.IssueWhereInput {
  const and: Prisma.IssueWhereInput[] = [];
  if (scope.kind === 'project') and.push({ projectId: scope.projectId });
  else if (q.project) and.push({ project: { key: q.project } });
  else and.push({ project: { archived: false } });
  if (q.type) and.push({ type: q.type });
  if (q.status) and.push({ status: q.status });
  if (q.priority) and.push({ priority: q.priority });
  if (q.assignee) and.push({ assigneeId: q.assignee === NO_ASSIGNEE ? null : q.assignee });
  if (q.q) {
    // 제목 부분 일치(대소문자 무시) 또는 `KEY-번호` 로 번호 찾기
    const or: Prisma.IssueWhereInput[] = [{ title: { contains: escapeLike(q.q), mode: 'insensitive' } }];
    const key = parseIssueKey(q.q);
    if (key) or.push({ number: key.number, project: { key: key.projectKey } });
    and.push({ OR: or });
  }
  return { AND: and };
}

/** 정렬(같은 값이면 id 로 고정해 페이지 경계가 흔들리지 않게) */
function orderOf(q: IssueListQuery): Prisma.IssueOrderByWithRelationInput[] {
  const dir = q.dir;
  const tie: Prisma.IssueOrderByWithRelationInput = { id: 'asc' };
  switch (q.sort) {
    case 'number':
      return [{ project: { key: dir } }, { number: dir }, tie];
    case 'title':
      return [{ title: dir }, tie];
    case 'status':
      return [{ status: dir }, { updatedAt: 'desc' }, tie];
    case 'priority':
      return [{ priority: dir }, { updatedAt: 'desc' }, tie];
    case 'due':
      return [{ dueDate: { sort: dir, nulls: 'last' } }, tie];
    case 'updated':
      return [{ updatedAt: dir }, tie];
  }
}

const LIST_SELECT = {
  id: true,
  projectId: true,
  number: true,
  taskId: true,
  title: true,
  description: false,
  type: true,
  status: true,
  priority: true,
  assigneeId: true,
  reporterId: true,
  dueDate: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  project: { select: { key: true, name: true, color: true, archived: true } },
  assignee: { select: { name: true } },
  _count: { select: { comments: { where: { deletedAt: null } } } },
} as const satisfies Prisma.IssueSelect;

/** 이슈 목록(50건 페이지). 페이지가 범위를 넘으면 마지막 페이지를 준다. 사용자는 이름만(D8) */
export async function listIssues(scope: IssueScope, query: IssueListQuery): Promise<IssueListPage> {
  const where = whereOf(scope, query);
  const total = await prisma.issue.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(query.page, pageCount);
  const rows = await prisma.issue.findMany({
    where,
    select: LIST_SELECT,
    orderBy: orderOf(query),
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
  });
  return { items: rows.map(toListItem), total, page, pageCount };
}

type ListRow = Prisma.IssueGetPayload<{ select: typeof LIST_SELECT }>;

function toListItem(r: ListRow): IssueListItem {
  const { description: _d, ...dto } = toIssueDto({ ...r, description: '' }, r.project.key);
  void _d;
  return {
    ...dto,
    projectName: r.project.name,
    projectColor: r.project.color,
    projectArchived: r.project.archived,
    assigneeName: r.assignee?.name ?? null,
    commentCount: r._count.comments,
  };
}

/** 이슈 보드: 그 프로젝트의 이슈 전체(열 배치·순서는 화면의 lib/board 가 정한다) */
export async function loadIssueBoard(projectId: string): Promise<IssueListItem[]> {
  const rows = await prisma.issue.findMany({ where: { projectId }, select: LIST_SELECT, orderBy: [{ number: 'asc' }] });
  return rows.map(toListItem);
}

/**
 * 상세 패널 데이터(`KEY-번호`). 없거나 형식이 틀리면 null. scopeProjectId 가 있으면 그 프로젝트의 이슈만.
 * 댓글은 작성 순, 지운 댓글은 본문 없이 자리만 남긴다. 사용자는 이름만(D8).
 */
export async function getIssueDetail(key: string, scopeProjectId?: string): Promise<IssueDetail | null> {
  const parsed = parseIssueKey(key);
  if (!parsed) return null;
  const row = await prisma.issue.findFirst({
    where: { number: parsed.number, project: { key: parsed.projectKey }, ...(scopeProjectId ? { projectId: scopeProjectId } : {}) },
    include: {
      project: { select: { key: true, name: true, archived: true } },
      assignee: { select: { name: true } },
      reporter: { select: { name: true } },
      task: { select: { id: true, title: true } },
      comments: {
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true, authorId: true, body: true, createdAt: true, updatedAt: true, deletedAt: true, author: { select: { name: true } } },
      },
    },
  });
  if (!row) return null;
  return {
    ...toIssueDto(row, row.project.key),
    projectName: row.project.name,
    projectArchived: row.project.archived,
    assigneeName: row.assignee?.name ?? null,
    reporterName: row.reporter.name,
    task: row.task,
    comments: row.comments.map(toCommentDto),
  };
}

/** 이슈 대화상자의 연결 작업 후보(그 프로젝트의 작업 id·제목, 간트 순서) */
export async function listTaskOptions(projectId: string): Promise<Array<{ id: string; title: string }>> {
  return prisma.task.findMany({ where: { projectId }, select: { id: true, title: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
}

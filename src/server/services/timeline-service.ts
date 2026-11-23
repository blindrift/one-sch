import 'server-only';
import { todayInSeoul } from '@/lib/dates';
import type { DependencyDto, ProjectDto, TimelineData, UserOption } from '@/lib/schedule/dto';
import { prisma } from '../db';
import { toProjectDto, toTaskDto } from './schedule-dto';

const PROJECT_SELECT = {
  id: true,
  key: true,
  name: true,
  color: true,
  status: true,
  startDate: true,
  endDate: true,
  ownerId: true,
  archived: true,
  version: true,
} as const;

/** 담당자·책임자 후보: 활성 사용자의 id·이름만(D8, 이메일 미포함) */
export async function listUserOptions(): Promise<UserOption[]> {
  return prisma.user.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
}

export type TimelineQuery = {
  /** 보관된 프로젝트도 포함(읽기 전용 표시, D6) */
  includeArchived?: boolean;
  /** 이 프로젝트만(`/projects/[key]`). 보관 여부와 무관하게 포함한다. */
  projectId?: string;
};

/**
 * 타임라인 화면 데이터. 필요한 필드만 읽는다(N-01: 수천 건). 의존은 양 끝 작업이 모두 보이는 것만.
 * "오늘"은 서버가 Asia/Seoul 로 계산한다.
 */
export async function loadTimeline(query: TimelineQuery = {}): Promise<TimelineData> {
  const where = query.projectId ? { id: query.projectId } : query.includeArchived ? {} : { archived: false };
  const projectRows = await prisma.project.findMany({ where, select: PROJECT_SELECT, orderBy: { key: 'asc' } });
  const projectIds = projectRows.map((p) => p.id);
  const [taskRows, depRows, users] = await Promise.all([
    prisma.task.findMany({
      where: { projectId: { in: projectIds } },
      select: {
        id: true,
        projectId: true,
        parentId: true,
        title: true,
        startDate: true,
        endDate: true,
        progress: true,
        status: true,
        assigneeId: true,
        isMilestone: true,
        sortOrder: true,
        version: true,
        url: true,
        memo: true,
      },
      orderBy: [{ projectId: 'asc' }, { sortOrder: 'asc' }],
    }),
    prisma.taskDependency.findMany({
      where: { fromTask: { projectId: { in: projectIds } }, toTask: { projectId: { in: projectIds } } },
      select: { id: true, fromTaskId: true, toTaskId: true },
    }),
    listUserOptions(),
  ]);
  const parents = new Set(taskRows.map((t) => t.parentId).filter((id): id is string => id !== null));
  return {
    projects: projectRows.map(toProjectDto),
    tasks: taskRows.map((t) => toTaskDto(t, parents.has(t.id))),
    dependencies: depRows satisfies DependencyDto[],
    users,
    today: todayInSeoul(),
  };
}

export type ProjectListItem = ProjectDto & { ownerName: string; taskCount: number };

/** `/projects` 목록: 보관 포함 전체(보관은 뒤로) */
export async function listProjects(): Promise<ProjectListItem[]> {
  const rows = await prisma.project.findMany({
    select: { ...PROJECT_SELECT, owner: { select: { name: true } }, _count: { select: { tasks: true } } },
    orderBy: [{ archived: 'asc' }, { key: 'asc' }],
  });
  return rows.map((r) => ({ ...toProjectDto(r), ownerName: r.owner.name, taskCount: r._count.tasks }));
}

export async function findProjectByKey(key: string): Promise<ProjectDto | null> {
  const row = await prisma.project.findUnique({ where: { key }, select: PROJECT_SELECT });
  return row ? toProjectDto(row) : null;
}

import 'server-only';
import type { ProjectStatus as PrismaProjectStatus, TaskStatus as PrismaTaskStatus } from '@prisma/client';
import { toYmd } from '@/lib/dates';
import type { ProjectDto, TaskDto } from '@/lib/schedule/dto';
import type { ProjectStatus, TaskStatus } from '@/lib/schedule/status';
import { AppError } from '../action-result';
import type { Tx } from '../db';

// lib/schedule/status.ts 의 값과 Prisma enum 이 어긋나면 컴파일 오류가 나게 한다.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const projectStatusMatch: Same<ProjectStatus, PrismaProjectStatus> = true;
const taskStatusMatch: Same<TaskStatus, PrismaTaskStatus> = true;
void projectStatusMatch;
void taskStatusMatch;

export type Actor = { id: string };

export type { DependencyDto, ProjectDto, TaskDto, UserOption } from '@/lib/schedule/dto';

type ProjectRow = {
  id: string;
  key: string;
  name: string;
  color: string;
  status: PrismaProjectStatus;
  startDate: Date | null;
  endDate: Date | null;
  ownerId: string;
  archived: boolean;
  version: number;
};

export function toProjectDto(p: ProjectRow): ProjectDto {
  return {
    id: p.id,
    key: p.key,
    name: p.name,
    color: p.color,
    status: p.status,
    startDate: p.startDate ? toYmd(p.startDate) : null,
    endDate: p.endDate ? toYmd(p.endDate) : null,
    ownerId: p.ownerId,
    archived: p.archived,
    version: p.version,
  };
}

export type TaskRow = {
  id: string;
  projectId: string;
  parentId: string | null;
  title: string;
  startDate: Date;
  endDate: Date;
  progress: number;
  status: PrismaTaskStatus;
  assigneeId: string | null;
  isMilestone: boolean;
  sortOrder: number;
  version: number;
  url: string | null;
  memo: string | null;
};

export function toTaskDto(t: TaskRow, hasChildren: boolean): TaskDto {
  return {
    id: t.id,
    projectId: t.projectId,
    parentId: t.parentId,
    title: t.title,
    startDate: toYmd(t.startDate),
    endDate: toYmd(t.endDate),
    progress: t.progress,
    status: t.status,
    assigneeId: t.assigneeId,
    isMilestone: t.isMilestone,
    sortOrder: t.sortOrder,
    version: t.version,
    // 3,000건 전송량: 빈 값은 null 로만 보낸다(DB 는 빈 문자열을 허용하지 않지만 방어적으로).
    url: t.url || null,
    memo: t.memo || null,
    hasChildren,
  };
}

/** 담당자·책임자는 활성 사용자만(없거나 비활성이면 VALIDATION). */
export async function ensureActiveUser(tx: Tx, userId: string, field: string): Promise<void> {
  const u = await tx.user.findUnique({ where: { id: userId }, select: { active: true } });
  if (!u || !u.active) {
    const message = '활성 사용자만 지정할 수 있습니다.';
    throw new AppError('VALIDATION', 'inactive_user', message, { [field]: [message] });
  }
}

export function conflict(reason: 'version' | 'archived' | string, message?: string): AppError {
  const messages: Record<string, string> = {
    archived: '보관된 프로젝트는 수정할 수 없습니다. 보관을 해제한 뒤 다시 시도해 주세요.',
  };
  return new AppError('CONFLICT', reason, message ?? messages[reason]);
}

export function validation(field: string, message: string, reason = field): AppError {
  return new AppError('VALIDATION', reason, message, { [field]: [message] });
}

import 'server-only';
import { Prisma } from '@prisma/client';
import { createsCycle, isAncestor } from '@/lib/schedule/graph';
import type { AddDependencyInput } from '@/lib/validation/task';
import { AppError } from '../action-result';
import { writeAudit } from '../audit';
import { prisma, type Tx } from '../db';
import type { RequestMeta } from '../request-meta';
import { conflict, validation, type Actor, type DependencyDto } from './schedule-dto';
import { lockDependencies, lockProjects, SCHEDULE_TX } from './schedule-lock';

/** 잠금 전에 작업들의 프로젝트를 알아낸다(projectId 는 바뀌지 않는다). 하나라도 없으면 NOT_FOUND. */
async function projectsOf(taskIds: string[]): Promise<string[]> {
  const rows = await prisma.task.findMany({ where: { id: { in: taskIds } }, select: { id: true, projectId: true } });
  if (rows.length !== new Set(taskIds).size) throw new AppError('NOT_FOUND');
  return rows.map((r) => r.projectId);
}

async function ensureWritable(tx: Tx, projectIds: string[]): Promise<void> {
  const rows = await tx.project.findMany({ where: { id: { in: projectIds } }, select: { archived: true } });
  if (rows.some((r) => r.archived)) throw conflict('archived');
}

export async function addDependency(actor: Actor, input: AddDependencyInput, meta: RequestMeta): Promise<DependencyDto> {
  const { fromTaskId, toTaskId } = input;
  if (fromTaskId === toTaskId) throw validation('toTaskId', '자기 자신에 의존할 수 없습니다.', 'self');
  const projectIds = await projectsOf([fromTaskId, toTaskId]);
  try {
    return await prisma.$transaction(async (tx) => {
      // 잠금 순서: 프로젝트(정렬) → 의존(전역). 작업 쓰기·삭제와 같은 프로젝트 잠금을 써서 검사 중 계층이 바뀌지 않게 한다.
      await lockProjects(tx, projectIds);
      await lockDependencies(tx);
      const tasks = await tx.task.findMany({ where: { id: { in: [fromTaskId, toTaskId] } }, select: { id: true, projectId: true } });
      if (tasks.length !== 2) throw new AppError('NOT_FOUND');
      await ensureWritable(tx, [...new Set(tasks.map((t) => t.projectId))]);

      // D14: 조상·후손 사이의 의존은 거부(같은 프로젝트일 때만 가능)
      if (tasks[0].projectId === tasks[1].projectId) {
        const rows = await tx.task.findMany({ where: { projectId: tasks[0].projectId }, select: { id: true, parentId: true } });
        const parentOf = new Map(rows.map((r) => [r.id, r.parentId]));
        if (isAncestor(parentOf, fromTaskId, toTaskId) || isAncestor(parentOf, toTaskId, fromTaskId)) {
          throw validation('toTaskId', '상위·하위 작업 사이에는 의존을 둘 수 없습니다.', 'hierarchy');
        }
      }
      const existing = await tx.taskDependency.findUnique({ where: { fromTaskId_toTaskId: { fromTaskId, toTaskId } } });
      if (existing) throw conflict('duplicate', '이미 있는 의존 관계입니다.');
      const edges = await tx.taskDependency.findMany({ select: { fromTaskId: true, toTaskId: true } });
      if (createsCycle(edges.map((e) => ({ from: e.fromTaskId, to: e.toTaskId })), fromTaskId, toTaskId)) {
        throw conflict('cycle', '순환 의존이 생겨 추가할 수 없습니다.');
      }
      const dep = await tx.taskDependency.create({ data: { fromTaskId, toTaskId, type: 'FS' } });
      await writeAudit(tx, {
        actorId: actor.id,
        action: 'dependency.create',
        entity: 'TaskDependency',
        entityId: dep.id,
        after: { fromTaskId, toTaskId, type: 'FS' },
        meta,
      });
      return { id: dep.id, fromTaskId, toTaskId };
    }, SCHEDULE_TX);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw conflict('duplicate', '이미 있는 의존 관계입니다.');
    }
    throw err;
  }
}

export async function removeDependency(actor: Actor, id: string, meta: RequestMeta): Promise<{ id: string }> {
  const dep = await prisma.taskDependency.findUnique({ where: { id }, select: { fromTaskId: true, toTaskId: true } });
  if (!dep) throw new AppError('NOT_FOUND');
  const projectIds = await projectsOf([dep.fromTaskId, dep.toTaskId]);
  return prisma.$transaction(async (tx) => {
    await lockProjects(tx, projectIds);
    const current = await tx.taskDependency.findUnique({ where: { id } });
    if (!current) throw new AppError('NOT_FOUND');
    await ensureWritable(tx, projectIds);
    await tx.taskDependency.delete({ where: { id } });
    await writeAudit(tx, {
      actorId: actor.id,
      action: 'dependency.delete',
      entity: 'TaskDependency',
      entityId: id,
      before: { fromTaskId: current.fromTaskId, toTaskId: current.toTaskId, type: current.type },
      meta,
    });
    return { id };
  }, SCHEDULE_TX);
}

import 'server-only';
import type { Prisma } from '@prisma/client';
import { parseYmd, toYmd } from '@/lib/dates';
import { depthOf, isAncestor, moveCreatesHierarchyDependency, subtreeHeight, type ParentMap } from '@/lib/schedule/graph';
import { summarize } from '@/lib/schedule/rollup';
import type { TaskDeleteResult, TaskReorderResult, TaskWriteResult } from '@/lib/schedule/dto';
import { reorderIds, sortOrdersFor } from '@/lib/schedule/reorder';
import { MAX_TASK_DEPTH } from '@/lib/schedule/status';
import type { CreateTaskInput, DeleteTaskInput, ReorderTaskInput, UpdateTaskInput } from '@/lib/validation/task';
import { AppError } from '../action-result';
import { diffFields, writeAudit } from '../audit';
import { prisma, type Tx } from '../db';
import type { RequestMeta } from '../request-meta';
import { conflict, ensureActiveUser, ensureWritableProject, toTaskDto, validation, type Actor, type TaskDto } from './schedule-dto';
import { lockProject, SCHEDULE_TX } from './schedule-lock';

export type { TaskDeleteResult, TaskReorderResult, TaskWriteResult };

/** 감사·비교용 스냅샷(날짜는 ymd) */
function snapshot(t: TaskDto) {
  return {
    projectId: t.projectId,
    parentId: t.parentId,
    title: t.title,
    startDate: t.startDate,
    endDate: t.endDate,
    progress: t.progress,
    status: t.status,
    assigneeId: t.assigneeId,
    isMilestone: t.isMilestone,
    url: t.url,
    memo: t.memo,
  };
}
type Snapshot = ReturnType<typeof snapshot>;

/** 잠금 전에 대상이 속한 프로젝트를 알아낸다(projectId 는 바뀌지 않는 값이라 잠금 밖에서 읽어도 안전). */
async function projectIdOf(taskId: string): Promise<string> {
  const t = await prisma.task.findUnique({ where: { id: taskId }, select: { projectId: true } });
  if (!t) throw new AppError('NOT_FOUND');
  return t.projectId;
}

/** 프로젝트 안 작업의 상위 관계(잠금 안에서 읽는다) */
async function loadParentMap(tx: Tx, projectId: string): Promise<Map<string, string | null>> {
  const rows = await tx.task.findMany({ where: { projectId }, select: { id: true, parentId: true } });
  return new Map(rows.map((r) => [r.id, r.parentId]));
}

function childrenMap(parentOf: ParentMap): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [id, parent] of parentOf) {
    if (!parent) continue;
    const list = out.get(parent);
    if (list) list.push(id);
    else out.set(parent, [id]);
  }
  return out;
}

async function hasChildren(tx: Tx, id: string): Promise<boolean> {
  return (await tx.task.count({ where: { parentId: id } })) > 0;
}

/**
 * 상위 작업이 될 수 있는지: 같은 프로젝트, 마일스톤 아님, 자기 자신·후손 아님, 깊이 제한(D13).
 * movingId 가 있으면 그 작업(과 하위 트리)을 옮기는 경우다.
 */
async function checkParent(
  tx: Tx,
  parentOf: ParentMap,
  projectId: string,
  parentId: string,
  movingId?: string,
): Promise<void> {
  const parent = await tx.task.findUnique({ where: { id: parentId }, select: { projectId: true, isMilestone: true } });
  if (!parent || parent.projectId !== projectId) {
    throw validation('parentId', '같은 프로젝트의 작업만 상위 작업으로 지정할 수 있습니다.', 'parent_project');
  }
  if (parent.isMilestone) throw validation('parentId', '마일스톤은 상위 작업이 될 수 없습니다.', 'parent_milestone');
  if (movingId && (parentId === movingId || isAncestor(parentOf, movingId, parentId))) {
    throw validation('parentId', '자기 자신이나 하위 작업 밑으로 옮길 수 없습니다.', 'parent_cycle');
  }
  const height = movingId ? subtreeHeight(childrenMap(parentOf), movingId) : 1;
  if (depthOf(parentOf, parentId) + height > MAX_TASK_DEPTH) {
    throw validation('parentId', `작업 계층은 최대 ${MAX_TASK_DEPTH}단계입니다.`, 'depth');
  }
}

/**
 * D14 를 계층 변경에도 적용: 옮기는 작업(과 후손)과 새 상위(와 그 조상) 사이에 의존이 있으면 거부한다.
 * 프로젝트 잠금 안에서 읽으므로(의존 추가도 같은 잠금을 잡는다) 검사 뒤에 의존이 끼어들지 않는다.
 * 두 끝이 모두 이 프로젝트 안이어야 해당되므로 그런 의존만 읽는다.
 */
async function checkMoveDependencies(tx: Tx, parentOf: ParentMap, projectId: string, movingId: string, newParentId: string): Promise<void> {
  const deps = await tx.taskDependency.findMany({
    where: { fromTask: { projectId }, toTask: { projectId } },
    select: { fromTaskId: true, toTaskId: true },
  });
  const edges = deps.map((d) => ({ from: d.fromTaskId, to: d.toTaskId }));
  if (moveCreatesHierarchyDependency(parentOf, edges, movingId, newParentId)) {
    throw validation('parentId', '의존 관계가 있는 작업 밑으로는 옮길 수 없습니다(상위·하위 작업 사이에는 의존을 둘 수 없습니다).', 'hierarchy');
  }
}

/**
 * startId 부터 조상 방향으로 요약 값(기간·진행률)을 다시 계산해 저장한다(D4). 잠금 안에서 자식을 다시 읽으므로
 * 형제를 동시에 고쳐도 틀어지지 않는다. 값이 그대로인 조상에서 멈춘다. 바뀐 조상의 DTO 를 가까운 순으로 돌려준다.
 */
async function recalcAncestors(tx: Tx, startId: string | null): Promise<TaskDto[]> {
  const out: TaskDto[] = [];
  const seen = new Set<string>();
  let cur = startId;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const node = await tx.task.findUnique({ where: { id: cur } });
    if (!node) break;
    const kids = await tx.task.findMany({
      where: { parentId: cur },
      select: { startDate: true, endDate: true, progress: true, isMilestone: true },
    });
    const value = summarize(
      kids.map((k) => ({ startDate: toYmd(k.startDate), endDate: toYmd(k.endDate), progress: k.progress, isMilestone: k.isMilestone })),
    );
    // 마지막 하위가 빠진 작업은 잎이 되어 마지막 요약 값을 그대로 가진다(조상도 바뀌지 않음).
    if (!value) break;
    if (value.startDate === toYmd(node.startDate) && value.endDate === toYmd(node.endDate) && value.progress === node.progress) break;
    const updated = await tx.task.update({
      where: { id: cur },
      data: {
        startDate: parseYmd(value.startDate),
        endDate: parseYmd(value.endDate),
        progress: value.progress,
        version: { increment: 1 },
      },
    });
    out.push(toTaskDto(updated, true));
    cur = node.parentId;
  }
  return out;
}

const rollupAudit = (ancestors: TaskDto[]) =>
  ancestors.map((a) => ({ id: a.id, startDate: a.startDate, endDate: a.endDate, progress: a.progress }));

export async function createTask(actor: Actor, input: CreateTaskInput, meta: RequestMeta): Promise<TaskWriteResult> {
  return prisma.$transaction(async (tx) => {
    await lockProject(tx, input.projectId);
    await ensureWritableProject(tx, input.projectId);
    const parentId = input.parentId ?? null;
    if (parentId) await checkParent(tx, await loadParentMap(tx, input.projectId), input.projectId, parentId);
    if (input.assigneeId) await ensureActiveUser(tx, input.assigneeId, 'assigneeId');

    const { _max } = await tx.task.aggregate({ where: { projectId: input.projectId }, _max: { sortOrder: true } });
    const created = await tx.task.create({
      data: {
        projectId: input.projectId,
        parentId,
        title: input.title,
        startDate: parseYmd(input.startDate),
        endDate: parseYmd(input.endDate),
        progress: input.progress,
        status: input.status,
        assigneeId: input.assigneeId ?? null,
        isMilestone: input.isMilestone,
        url: input.url ?? null,
        memo: input.memo ?? null,
        sortOrder: (_max.sortOrder ?? 0) + 1,
      },
    });
    const ancestors = await recalcAncestors(tx, parentId);
    const task = toTaskDto(created, false);
    await writeAudit(tx, {
      actorId: actor.id,
      action: 'task.create',
      entity: 'Task',
      entityId: task.id,
      after: { ...snapshot(task), ...(ancestors.length ? { rollup: rollupAudit(ancestors) } : {}) },
      meta,
    });
    return { task, ancestors };
  }, SCHEDULE_TX);
}

export async function updateTask(actor: Actor, input: UpdateTaskInput, meta: RequestMeta): Promise<TaskWriteResult> {
  const projectId = await projectIdOf(input.id);
  return prisma.$transaction(async (tx) => {
    await lockProject(tx, projectId);
    const row = await tx.task.findUnique({ where: { id: input.id } });
    if (!row) throw new AppError('NOT_FOUND');
    if (row.version !== input.version) throw conflict('version');
    await ensureWritableProject(tx, projectId);
    const summary = await hasChildren(tx, row.id);
    const before = toTaskDto(row, summary);

    const patch: Partial<Snapshot> = {};
    for (const k of ['title', 'startDate', 'endDate', 'progress', 'status', 'assigneeId', 'isMilestone', 'parentId', 'url', 'memo'] as const) {
      if (input[k] !== undefined) (patch as Record<string, unknown>)[k] = input[k];
    }
    const diff = diffFields(snapshot(before), patch);
    if (!diff) return { task: before, ancestors: [] };
    const changed = (k: keyof Snapshot) => k in diff.after;

    if (summary && (changed('startDate') || changed('endDate') || changed('progress'))) {
      throw conflict('summary', '하위 작업이 있는 작업의 기간·진행률은 하위 작업에서 자동으로 계산됩니다.');
    }
    if (summary && changed('isMilestone') && patch.isMilestone) {
      throw validation('isMilestone', '하위 작업이 있는 작업은 마일스톤이 될 수 없습니다.', 'milestone_has_children');
    }
    const start = patch.startDate ?? before.startDate;
    const end = patch.endDate ?? before.endDate;
    const milestone = patch.isMilestone ?? before.isMilestone;
    if (end < start) throw validation('endDate', '종료일은 시작일보다 빠를 수 없습니다.');
    if (milestone && start !== end) throw validation('endDate', '마일스톤은 시작일과 종료일이 같아야 합니다.', 'milestone_dates');
    if (changed('parentId') && patch.parentId) {
      const parentOf = await loadParentMap(tx, projectId);
      await checkParent(tx, parentOf, projectId, patch.parentId, row.id);
      await checkMoveDependencies(tx, parentOf, projectId, row.id, patch.parentId);
    }
    if (changed('assigneeId') && patch.assigneeId) await ensureActiveUser(tx, patch.assigneeId, 'assigneeId');

    const data: Prisma.TaskUncheckedUpdateManyInput = { version: { increment: 1 } };
    if (changed('title')) data.title = patch.title;
    if (changed('startDate')) data.startDate = parseYmd(start);
    if (changed('endDate')) data.endDate = parseYmd(end);
    if (changed('progress')) data.progress = patch.progress;
    if (changed('status')) data.status = patch.status;
    if (changed('assigneeId')) data.assigneeId = patch.assigneeId ?? null;
    if (changed('isMilestone')) data.isMilestone = patch.isMilestone;
    if (changed('parentId')) data.parentId = patch.parentId ?? null;
    if (changed('url')) data.url = patch.url ?? null;
    if (changed('memo')) data.memo = patch.memo ?? null;
    const { count } = await tx.task.updateMany({ where: { id: row.id, version: row.version }, data });
    if (count !== 1) throw conflict('version');

    let ancestors: TaskDto[] = [];
    if (changed('parentId')) {
      ancestors = [...(await recalcAncestors(tx, row.parentId)), ...(await recalcAncestors(tx, patch.parentId ?? null))];
    } else if (changed('startDate') || changed('endDate') || changed('progress') || changed('isMilestone')) {
      ancestors = await recalcAncestors(tx, row.parentId);
    }
    const task = toTaskDto(await tx.task.findUniqueOrThrow({ where: { id: row.id } }), summary);
    await writeAudit(tx, {
      actorId: actor.id,
      action: 'task.update',
      entity: 'Task',
      entityId: row.id,
      before: diff.before,
      after: { ...diff.after, ...(ancestors.length ? { rollup: rollupAudit(ancestors) } : {}) },
      meta,
    });
    return { task, ancestors };
  }, SCHEDULE_TX);
}

/** 실제 삭제(5.2). 하위 작업·의존은 DB cascade 로 함께 지워지고(D7), 감사에 스냅샷을 남긴다. */
export async function deleteTask(actor: Actor, input: DeleteTaskInput, meta: RequestMeta): Promise<TaskDeleteResult> {
  const projectId = await projectIdOf(input.id);
  return prisma.$transaction(async (tx) => {
    await lockProject(tx, projectId);
    const row = await tx.task.findUnique({ where: { id: input.id } });
    if (!row) throw new AppError('NOT_FOUND');
    if (row.version !== input.version) throw conflict('version');
    await ensureWritableProject(tx, projectId);

    const children = childrenMap(await loadParentMap(tx, projectId));
    const descendantIds: string[] = [];
    const stack = [...(children.get(row.id) ?? [])];
    while (stack.length) {
      const id = stack.pop()!;
      descendantIds.push(id);
      stack.push(...(children.get(id) ?? []));
    }
    const allIds = [row.id, ...descendantIds];
    const descendants = descendantIds.length
      ? (await tx.task.findMany({ where: { id: { in: descendantIds } }, orderBy: { sortOrder: 'asc' } })).map((t) => ({
          id: t.id,
          ...snapshot(toTaskDto(t, children.has(t.id))),
        }))
      : [];
    const dependencies = await tx.taskDependency.findMany({
      where: { OR: [{ fromTaskId: { in: allIds } }, { toTaskId: { in: allIds } }] },
      select: { id: true, fromTaskId: true, toTaskId: true },
    });

    const { count } = await tx.task.deleteMany({ where: { id: row.id, version: row.version } });
    if (count !== 1) throw conflict('version');
    const ancestors = await recalcAncestors(tx, row.parentId);
    await writeAudit(tx, {
      actorId: actor.id,
      action: 'task.delete',
      entity: 'Task',
      entityId: row.id,
      before: {
        ...snapshot(toTaskDto(row, descendantIds.length > 0)),
        descendants,
        dependencies,
      },
      after: ancestors.length ? { rollup: rollupAudit(ancestors) } : null,
      meta,
    });
    return { deletedIds: allIds, ancestors };
  }, SCHEDULE_TX);
}

/**
 * 형제 순서 바꾸기(D17). 같은 상위 아래 형제끼리만 옮긴다(기준 작업이 다른 상위면 VALIDATION `sibling`).
 * 프로젝트 잠금 안에서 형제를 다시 읽어 순서를 매기므로 동시에 옮겨도 형제 sortOrder 가 겹치지 않는다.
 * 옮긴 작업만 version 을 올리고(낙관적 잠금), 감사 task.reorder 에 전후 형제 순서를 남긴다. 순서가 그대로면 아무것도 쓰지 않는다.
 */
export async function reorderTask(actor: Actor, input: ReorderTaskInput, meta: RequestMeta): Promise<TaskReorderResult> {
  const projectId = await projectIdOf(input.id);
  const anchorId = (input.beforeId ?? input.afterId)!;
  return prisma.$transaction(async (tx) => {
    await lockProject(tx, projectId);
    const row = await tx.task.findUnique({ where: { id: input.id } });
    if (!row) throw new AppError('NOT_FOUND');
    if (row.version !== input.version) throw conflict('version');
    await ensureWritableProject(tx, projectId);
    const anchor = await tx.task.findUnique({ where: { id: anchorId }, select: { projectId: true, parentId: true } });
    if (!anchor || anchor.projectId !== projectId || anchor.parentId !== row.parentId) {
      throw validation('beforeId', '같은 상위 작업 아래의 작업끼리만 순서를 바꿀 수 있습니다.', 'sibling');
    }
    const siblings = await tx.task.findMany({
      where: { projectId, parentId: row.parentId },
      select: { id: true, sortOrder: true },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    const before = siblings.map((t) => t.id);
    const after = reorderIds(before, row.id, input.beforeId ? { beforeId: input.beforeId } : { afterId: input.afterId! });
    if (!after) throw validation('beforeId', '같은 상위 작업 아래의 작업끼리만 순서를 바꿀 수 있습니다.', 'sibling');
    const summary = await hasChildren(tx, row.id);
    if (after.every((id, i) => id === before[i])) return { task: toTaskDto(row, summary), siblings: [] };

    const values = sortOrdersFor(siblings.map((t) => t.sortOrder));
    const old = new Map(siblings.map((t) => [t.id, t.sortOrder]));
    const changed: Array<{ id: string; sortOrder: number }> = [];
    for (const [i, id] of after.entries()) {
      if (old.get(id) === values[i] && id !== row.id) continue;
      if (id === row.id) {
        const { count } = await tx.task.updateMany({ where: { id, version: row.version }, data: { sortOrder: values[i], version: { increment: 1 } } });
        if (count !== 1) throw conflict('version');
      } else {
        await tx.task.update({ where: { id }, data: { sortOrder: values[i] } });
      }
      changed.push({ id, sortOrder: values[i] });
    }
    await writeAudit(tx, {
      actorId: actor.id,
      action: 'task.reorder',
      entity: 'Task',
      entityId: row.id,
      before: { parentId: row.parentId, order: before },
      after: { parentId: row.parentId, order: after },
      meta,
    });
    const task = toTaskDto(await tx.task.findUniqueOrThrow({ where: { id: row.id } }), summary);
    return { task, siblings: changed };
  }, SCHEDULE_TX);
}

import 'server-only';
import type { Prisma } from '@prisma/client';
import { parseYmd } from '@/lib/dates';
import type { IssueDeleteResult, IssueDto } from '@/lib/issue/dto';
import type { CreateIssueInput, DeleteIssueInput, UpdateIssueInput } from '@/lib/validation/issue';
import { AppError } from '../action-result';
import { diffFields, writeAudit } from '../audit';
import { prisma, type Tx } from '../db';
import type { RequestMeta } from '../request-meta';
import { issueSnapshot, toIssueDto } from './issue-dto';
import { conflict, ensureActiveUser, ensureWritableProject, validation, type Actor } from './schedule-dto';
import { lockProject, SCHEDULE_TX } from './schedule-lock';

// 이슈 쓰기는 작업과 같은 프로젝트 잠금으로 줄을 선다: 번호 발급(issueSeq)·보관 확인·연결 작업 확인이
// 같은 프로젝트의 보관 처리·작업 삭제와 엇갈리지 않게 한다.

type Snapshot = ReturnType<typeof issueSnapshot>;

/** 잠금 전에 대상 이슈의 프로젝트를 알아낸다(projectId 는 바뀌지 않는 값이라 잠금 밖에서 읽어도 안전). */
async function projectOfIssue(issueId: string): Promise<{ projectId: string; projectKey: string }> {
  const i = await prisma.issue.findUnique({ where: { id: issueId }, select: { projectId: true, project: { select: { key: true } } } });
  if (!i) throw new AppError('NOT_FOUND');
  return { projectId: i.projectId, projectKey: i.project.key };
}

/** 연결 작업은 같은 프로젝트의 작업만(다른 프로젝트 id 를 넣어 남의 작업을 엮는 것을 막는다). 잠금 안에서 부른다 */
async function ensureTaskInProject(tx: Tx, taskId: string, projectId: string): Promise<void> {
  const t = await tx.task.findUnique({ where: { id: taskId }, select: { projectId: true } });
  if (!t || t.projectId !== projectId) throw validation('taskId', '같은 프로젝트의 작업만 연결할 수 있습니다.', 'task_project');
}

/**
 * 프로젝트 이슈 번호를 하나 발급한다(D22). 프로젝트 잠금 안에서만 부른다.
 * Project.version·updatedAt 은 건드리지 않는다(프로젝트 편집이 아니므로, 편집 대화상자의 version 충돌을 만들지 않게).
 */
async function nextIssueNumber(tx: Tx, projectId: string): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ issueSeq: number }>>`
    UPDATE "Project" SET "issueSeq" = "issueSeq" + 1 WHERE "id" = ${projectId}::uuid RETURNING "issueSeq"`;
  if (rows.length !== 1) throw new AppError('NOT_FOUND');
  return rows[0].issueSeq;
}

export async function createIssue(actor: Actor, input: CreateIssueInput, meta: RequestMeta): Promise<IssueDto> {
  return prisma.$transaction(async (tx) => {
    await lockProject(tx, input.projectId);
    await ensureWritableProject(tx, input.projectId);
    if (input.assigneeId) await ensureActiveUser(tx, input.assigneeId, 'assigneeId');
    if (input.taskId) await ensureTaskInProject(tx, input.taskId, input.projectId);
    const number = await nextIssueNumber(tx, input.projectId);
    const created = await tx.issue.create({
      data: {
        projectId: input.projectId,
        number,
        taskId: input.taskId ?? null,
        title: input.title,
        description: input.description,
        type: input.type,
        status: input.status,
        priority: input.priority,
        assigneeId: input.assigneeId ?? null,
        reporterId: actor.id,
        dueDate: input.dueDate ? parseYmd(input.dueDate) : null,
      },
      include: { project: { select: { key: true } } },
    });
    const issue = toIssueDto(created, created.project.key);
    await writeAudit(tx, {
      actorId: actor.id,
      action: 'issue.create',
      entity: 'Issue',
      entityId: issue.id,
      after: { key: issue.key, ...issueSnapshot(issue) },
      meta,
    });
    return issue;
  }, SCHEDULE_TX);
}

export async function updateIssue(actor: Actor, input: UpdateIssueInput, meta: RequestMeta): Promise<IssueDto> {
  const { projectId, projectKey } = await projectOfIssue(input.id);
  return prisma.$transaction(async (tx) => {
    await lockProject(tx, projectId);
    const row = await tx.issue.findUnique({ where: { id: input.id } });
    if (!row) throw new AppError('NOT_FOUND');
    if (row.version !== input.version) throw conflict('version');
    await ensureWritableProject(tx, projectId);
    const before = toIssueDto(row, projectKey);

    const patch: Partial<Snapshot> = {};
    for (const k of ['title', 'description', 'type', 'status', 'priority', 'assigneeId', 'taskId', 'dueDate'] as const) {
      if (input[k] !== undefined) (patch as Record<string, unknown>)[k] = input[k];
    }
    const diff = diffFields(issueSnapshot(before), patch);
    if (!diff) return before;
    const changed = (k: keyof Snapshot) => k in diff.after;

    if (changed('assigneeId') && patch.assigneeId) await ensureActiveUser(tx, patch.assigneeId, 'assigneeId');
    if (changed('taskId') && patch.taskId) await ensureTaskInProject(tx, patch.taskId, projectId);

    const data: Prisma.IssueUncheckedUpdateManyInput = { version: { increment: 1 } };
    if (changed('title')) data.title = patch.title;
    if (changed('description')) data.description = patch.description;
    if (changed('type')) data.type = patch.type;
    if (changed('status')) data.status = patch.status;
    if (changed('priority')) data.priority = patch.priority;
    if (changed('assigneeId')) data.assigneeId = patch.assigneeId ?? null;
    if (changed('taskId')) data.taskId = patch.taskId ?? null;
    if (changed('dueDate')) data.dueDate = patch.dueDate ? parseYmd(patch.dueDate) : null;
    const { count } = await tx.issue.updateMany({ where: { id: row.id, version: row.version }, data });
    if (count !== 1) throw conflict('version');

    const issue = toIssueDto(await tx.issue.findUniqueOrThrow({ where: { id: row.id } }), projectKey);
    await writeAudit(tx, {
      actorId: actor.id,
      action: 'issue.update',
      entity: 'Issue',
      entityId: row.id,
      before: diff.before,
      after: diff.after,
      meta,
    });
    return issue;
  }, SCHEDULE_TX);
}

/** 실제 삭제(5.2, D21). 댓글은 DB cascade 로 함께 지워지고, 감사에 스냅샷과 댓글 수를 남긴다. */
export async function deleteIssue(actor: Actor, input: DeleteIssueInput, meta: RequestMeta): Promise<IssueDeleteResult> {
  const { projectId, projectKey } = await projectOfIssue(input.id);
  return prisma.$transaction(async (tx) => {
    await lockProject(tx, projectId);
    const row = await tx.issue.findUnique({ where: { id: input.id } });
    if (!row) throw new AppError('NOT_FOUND');
    if (row.version !== input.version) throw conflict('version');
    await ensureWritableProject(tx, projectId);
    const [commentCount, deletedComments] = await Promise.all([
      tx.comment.count({ where: { issueId: row.id } }),
      tx.comment.count({ where: { issueId: row.id, deletedAt: { not: null } } }),
    ]);
    const { count } = await tx.issue.deleteMany({ where: { id: row.id, version: row.version } });
    if (count !== 1) throw conflict('version');
    const issue = toIssueDto(row, projectKey);
    await writeAudit(tx, {
      actorId: actor.id,
      action: 'issue.delete',
      entity: 'Issue',
      entityId: row.id,
      before: { key: issue.key, ...issueSnapshot(issue), commentCount, deletedCommentCount: deletedComments },
      meta,
    });
    return { id: row.id };
  }, SCHEDULE_TX);
}

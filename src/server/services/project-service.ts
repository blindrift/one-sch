import 'server-only';
import { Prisma } from '@prisma/client';
import { parseYmd } from '@/lib/dates';
import type { CreateProjectInput, SetProjectArchivedInput, UpdateProjectInput } from '@/lib/validation/project';
import { AppError } from '../action-result';
import { diffFields, writeAudit } from '../audit';
import { prisma, type Tx } from '../db';
import type { RequestMeta } from '../request-meta';
import { conflict, ensureActiveUser, toProjectDto, validation, type Actor, type ProjectDto } from './schedule-dto';
import { lockProject } from './schedule-lock';

const ymdOrNull = (v: string | null | undefined) => (v ? parseYmd(v) : null);

/** 감사 기록용 스냅샷(날짜는 ymd) */
function snapshot(p: ProjectDto) {
  return {
    key: p.key,
    name: p.name,
    color: p.color,
    status: p.status,
    startDate: p.startDate,
    endDate: p.endDate,
    ownerId: p.ownerId,
  };
}

async function findForWrite(tx: Tx, id: string) {
  const p = await tx.project.findUnique({ where: { id } });
  if (!p) throw new AppError('NOT_FOUND');
  return p;
}

export async function createProject(actor: Actor, input: CreateProjectInput, meta: RequestMeta): Promise<ProjectDto> {
  try {
    return await prisma.$transaction(async (tx) => {
      const ownerId = input.ownerId ?? actor.id;
      await ensureActiveUser(tx, ownerId, 'ownerId');
      const created = await tx.project.create({
        data: {
          key: input.key,
          name: input.name,
          color: input.color,
          status: input.status,
          startDate: ymdOrNull(input.startDate),
          endDate: ymdOrNull(input.endDate),
          ownerId,
        },
      });
      const dto = toProjectDto(created);
      await writeAudit(tx, {
        actorId: actor.id,
        action: 'project.create',
        entity: 'Project',
        entityId: dto.id,
        after: snapshot(dto),
        meta,
      });
      return dto;
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const message = '이미 쓰고 있는 키입니다.';
      throw new AppError('CONFLICT', 'key_taken', message, { key: [message] });
    }
    throw err;
  }
}

export async function updateProject(actor: Actor, input: UpdateProjectInput, meta: RequestMeta): Promise<ProjectDto> {
  return prisma.$transaction(async (tx) => {
    await lockProject(tx, input.id);
    const current = await findForWrite(tx, input.id);
    if (current.version !== input.version) throw conflict('version');
    if (current.archived) throw conflict('archived');
    const before = toProjectDto(current);

    const patch: Partial<ReturnType<typeof snapshot>> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.color !== undefined) patch.color = input.color;
    if (input.status !== undefined) patch.status = input.status;
    if (input.startDate !== undefined) patch.startDate = input.startDate;
    if (input.endDate !== undefined) patch.endDate = input.endDate;
    if (input.ownerId !== undefined) patch.ownerId = input.ownerId;

    const start = patch.startDate !== undefined ? patch.startDate : before.startDate;
    const end = patch.endDate !== undefined ? patch.endDate : before.endDate;
    if (start && end && end < start) throw validation('endDate', '종료일은 시작일보다 빠를 수 없습니다.');

    const diff = diffFields(snapshot(before), patch);
    if (!diff) return before;
    if ('ownerId' in diff.after) await ensureActiveUser(tx, patch.ownerId!, 'ownerId');

    const data: Prisma.ProjectUncheckedUpdateManyInput = { version: { increment: 1 } };
    if ('name' in diff.after) data.name = patch.name;
    if ('color' in diff.after) data.color = patch.color;
    if ('status' in diff.after) data.status = patch.status;
    if ('startDate' in diff.after) data.startDate = ymdOrNull(patch.startDate);
    if ('endDate' in diff.after) data.endDate = ymdOrNull(patch.endDate);
    if ('ownerId' in diff.after) data.ownerId = patch.ownerId;
    const { count } = await tx.project.updateMany({ where: { id: current.id, version: current.version }, data });
    if (count !== 1) throw conflict('version');

    await writeAudit(tx, {
      actorId: actor.id,
      action: 'project.update',
      entity: 'Project',
      entityId: current.id,
      before: diff.before,
      after: diff.after,
      meta,
    });
    return toProjectDto(await tx.project.findUniqueOrThrow({ where: { id: current.id } }));
  });
}

/** 보관/보관 해제(D1: 프로젝트는 실제로 지우지 않는다). */
export async function setProjectArchived(actor: Actor, input: SetProjectArchivedInput, meta: RequestMeta): Promise<ProjectDto> {
  return prisma.$transaction(async (tx) => {
    await lockProject(tx, input.id);
    const current = await findForWrite(tx, input.id);
    if (current.version !== input.version) throw conflict('version');
    if (current.archived === input.archived) return toProjectDto(current);
    const { count } = await tx.project.updateMany({
      where: { id: current.id, version: current.version },
      data: { archived: input.archived, version: { increment: 1 } },
    });
    if (count !== 1) throw conflict('version');
    await writeAudit(tx, {
      actorId: actor.id,
      action: input.archived ? 'project.archive' : 'project.unarchive',
      entity: 'Project',
      entityId: current.id,
      before: { archived: current.archived },
      after: { archived: input.archived },
      meta,
    });
    return toProjectDto(await tx.project.findUniqueOrThrow({ where: { id: current.id } }));
  });
}

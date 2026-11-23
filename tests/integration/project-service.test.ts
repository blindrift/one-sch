import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const audit = vi.hoisted(() => ({ failNext: false }));
vi.mock('@/server/audit', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/server/audit')>();
  return {
    ...real,
    writeAudit: async (...args: Parameters<typeof real.writeAudit>) => {
      if (audit.failNext) {
        audit.failNext = false;
        throw new Error('audit down');
      }
      return real.writeAudit(...args);
    },
  };
});
import { prisma } from '@/server/db';
import { AppError } from '@/server/action-result';
import * as projects from '@/server/services/project-service';
import { disconnectAll, resetDb } from '../helpers/db';

const meta = { ip: '127.0.0.1', userAgent: 'vitest' };

async function makeUser(email: string, active = true) {
  return prisma.user.create({ data: { email, name: email.split('@')[0], role: 'MEMBER', active } });
}

async function reasonOf(p: Promise<unknown>) {
  try {
    await p;
    return 'OK';
  } catch (e) {
    if (e instanceof AppError) return `${e.code}:${e.reason ?? ''}`;
    throw e;
  }
}

const base = { key: 'ERP', name: 'ERP 개편', color: '#2563eb', status: 'PLANNED' as const };

beforeEach(resetDb);
afterAll(async () => {
  await prisma.$disconnect();
  await disconnectAll();
});

describe('project-service', () => {
  it('createProject: 생성·감사, 책임자 기본값은 요청자, 날짜는 ymd', async () => {
    const me = await makeUser('me@example.com');
    const p = await projects.createProject(me, { ...base, startDate: '2026-11-01', endDate: '2026-12-31' }, meta);
    expect(p).toMatchObject({ key: 'ERP', ownerId: me.id, startDate: '2026-11-01', endDate: '2026-12-31', version: 0, archived: false });
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'project.create', entityId: p.id } });
    expect(log.actorId).toBe(me.id);
    expect(log.after).toMatchObject({ key: 'ERP', startDate: '2026-11-01', ownerId: me.id });
  });

  it('키 중복은 CONFLICT(key_taken) + 필드 오류', async () => {
    const me = await makeUser('me@example.com');
    await projects.createProject(me, base, meta);
    const err = await projects.createProject(me, { ...base, name: 'x' }, meta).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ code: 'CONFLICT', reason: 'key_taken', fieldErrors: { key: expect.any(Array) } });
  });

  it('없는·비활성 책임자는 VALIDATION', async () => {
    const me = await makeUser('me@example.com');
    const off = await makeUser('off@example.com', false);
    expect(await reasonOf(projects.createProject(me, { ...base, ownerId: off.id }, meta))).toBe('VALIDATION:inactive_user');
    expect(await reasonOf(projects.createProject(me, { ...base, ownerId: '3f1c2b9e-8d4a-4c3b-9a2e-1f0e5d6c7b8a' }, meta))).toBe(
      'VALIDATION:inactive_user',
    );
    expect(await prisma.project.count()).toBe(0);
  });

  it('updateProject: 바뀐 필드만 감사, version +1, 키는 그대로', async () => {
    const me = await makeUser('me@example.com');
    const other = await makeUser('o@example.com');
    const p = await projects.createProject(me, base, meta);
    const u = await projects.updateProject(me, { id: p.id, version: 0, name: '새 이름', color: base.color, ownerId: other.id }, meta);
    expect(u).toMatchObject({ name: '새 이름', key: 'ERP', ownerId: other.id, version: 1 });
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'project.update' } });
    expect(log.before).toEqual({ name: 'ERP 개편', ownerId: me.id });
    expect(log.after).toEqual({ name: '새 이름', ownerId: other.id });
  });

  it('바뀐 것이 없으면 감사·version 불변', async () => {
    const me = await makeUser('me@example.com');
    const p = await projects.createProject(me, base, meta);
    const u = await projects.updateProject(me, { id: p.id, version: 0, name: base.name }, meta);
    expect(u.version).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: 'project.update' } })).toBe(0);
  });

  it('낡은 version 은 CONFLICT 이고 DB·감사 불변', async () => {
    const me = await makeUser('me@example.com');
    const p = await projects.createProject(me, base, meta);
    await projects.updateProject(me, { id: p.id, version: 0, name: 'a' }, meta);
    expect(await reasonOf(projects.updateProject(me, { id: p.id, version: 0, name: 'b' }, meta))).toBe('CONFLICT:version');
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p.id } })).name).toBe('a');
    expect(await prisma.auditLog.count({ where: { action: 'project.update' } })).toBe(1);
  });

  it('합친 결과의 종료 < 시작은 VALIDATION', async () => {
    const me = await makeUser('me@example.com');
    const p = await projects.createProject(me, { ...base, startDate: '2026-11-10' }, meta);
    expect(await reasonOf(projects.updateProject(me, { id: p.id, version: 0, endDate: '2026-11-01' }, meta))).toBe('VALIDATION:endDate');
  });

  it('없는 id 는 NOT_FOUND', async () => {
    const me = await makeUser('me@example.com');
    const id = '3f1c2b9e-8d4a-4c3b-9a2e-1f0e5d6c7b8a';
    expect(await reasonOf(projects.updateProject(me, { id, version: 0, name: 'x' }, meta))).toBe('NOT_FOUND:');
    expect(await reasonOf(projects.setProjectArchived(me, { id, version: 0, archived: true }, meta))).toBe('NOT_FOUND:');
  });

  it('보관/해제 감사, 보관 중에는 수정 CONFLICT(archived)', async () => {
    const me = await makeUser('me@example.com');
    const p = await projects.createProject(me, base, meta);
    const a = await projects.setProjectArchived(me, { id: p.id, version: 0, archived: true }, meta);
    expect(a).toMatchObject({ archived: true, version: 1 });
    expect(await reasonOf(projects.updateProject(me, { id: p.id, version: 1, name: 'x' }, meta))).toBe('CONFLICT:archived');
    const u = await projects.setProjectArchived(me, { id: p.id, version: 1, archived: false }, meta);
    expect(u).toMatchObject({ archived: false, version: 2 });
    const actions = (await prisma.auditLog.findMany({ orderBy: { id: 'asc' } })).map((l) => l.action);
    expect(actions).toEqual(['project.create', 'project.archive', 'project.unarchive']);
  });

  it('감사 쓰기가 실패하면 변경도 롤백', async () => {
    const me = await makeUser('me@example.com');
    audit.failNext = true;
    await expect(projects.createProject(me, base, meta)).rejects.toThrow('audit down');
    expect(await prisma.project.count()).toBe(0);
    const p = await projects.createProject(me, base, meta);
    audit.failNext = true;
    await expect(projects.updateProject(me, { id: p.id, version: 0, name: 'x' }, meta)).rejects.toThrow('audit down');
    expect(await prisma.project.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ name: base.name, version: 0 });
  });
});

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/server/db';
import { AppError } from '@/server/action-result';
import * as deps from '@/server/services/dependency-service';
import { disconnectAll, resetDb } from '../helpers/db';

const meta = { ip: '127.0.0.1', userAgent: 'vitest' };
const MISSING = '3f1c2b9e-8d4a-4c3b-9a2e-1f0e5d6c7b8a';
const D = new Date('2026-11-01T00:00:00Z');

async function reasonOf(p: Promise<unknown>) {
  try {
    await p;
    return 'OK';
  } catch (e) {
    if (e instanceof AppError) return `${e.code}:${e.reason ?? ''}`;
    throw e;
  }
}

let me: { id: string };
let p1: string;
let p2: string;

async function task(projectId: string, title: string, parentId: string | null = null) {
  return (await prisma.task.create({ data: { projectId, title, parentId, startDate: D, endDate: D } })).id;
}

async function setup() {
  await resetDb();
  me = await prisma.user.create({ data: { email: 'me@example.com', name: 'me', role: 'MEMBER' } });
  p1 = (await prisma.project.create({ data: { key: 'AA', name: 'a', color: '#111111', ownerId: me.id } })).id;
  p2 = (await prisma.project.create({ data: { key: 'BB', name: 'b', color: '#222222', ownerId: me.id } })).id;
}

beforeEach(setup);
afterAll(async () => {
  await prisma.$disconnect();
  await disconnectAll();
});

describe('dependency-service', () => {
  it('추가·감사, 중복은 CONFLICT(duplicate)', async () => {
    const a = await task(p1, 'a');
    const b = await task(p1, 'b');
    const d = await deps.addDependency(me, { fromTaskId: a, toTaskId: b }, meta);
    expect(d).toMatchObject({ fromTaskId: a, toTaskId: b });
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'dependency.create' } });
    expect(log).toMatchObject({ entityId: d.id, after: { fromTaskId: a, toTaskId: b, type: 'FS' } });
    expect(await reasonOf(deps.addDependency(me, { fromTaskId: a, toTaskId: b }, meta))).toBe('CONFLICT:duplicate');
  });

  it('자기 자신·조상·후손은 거부, 없는 작업은 NOT_FOUND', async () => {
    const a = await task(p1, 'a');
    const b = await task(p1, 'b', a);
    const c = await task(p1, 'c', b);
    expect(await reasonOf(deps.addDependency(me, { fromTaskId: a, toTaskId: a }, meta))).toBe('VALIDATION:self');
    expect(await reasonOf(deps.addDependency(me, { fromTaskId: a, toTaskId: c }, meta))).toBe('VALIDATION:hierarchy');
    expect(await reasonOf(deps.addDependency(me, { fromTaskId: c, toTaskId: a }, meta))).toBe('VALIDATION:hierarchy');
    expect(await reasonOf(deps.addDependency(me, { fromTaskId: a, toTaskId: MISSING }, meta))).toBe('NOT_FOUND:');
    expect(await prisma.taskDependency.count()).toBe(0);
  });

  it('직접·간접 순환은 CONFLICT(cycle), 프로젝트 사이 의존은 허용', async () => {
    const a = await task(p1, 'a');
    const b = await task(p1, 'b');
    const x = await task(p2, 'x');
    await deps.addDependency(me, { fromTaskId: a, toTaskId: b }, meta);
    expect(await reasonOf(deps.addDependency(me, { fromTaskId: b, toTaskId: a }, meta))).toBe('CONFLICT:cycle');
    await deps.addDependency(me, { fromTaskId: b, toTaskId: x }, meta);
    expect(await reasonOf(deps.addDependency(me, { fromTaskId: x, toTaskId: a }, meta))).toBe('CONFLICT:cycle');
    expect(await prisma.taskDependency.count()).toBe(2);
  });

  it('보관 프로젝트가 끼면 CONFLICT(archived)', async () => {
    const a = await task(p1, 'a');
    const x = await task(p2, 'x');
    await prisma.project.update({ where: { id: p2 }, data: { archived: true } });
    expect(await reasonOf(deps.addDependency(me, { fromTaskId: a, toTaskId: x }, meta))).toBe('CONFLICT:archived');
  });

  it('A→B 와 B→A 동시 추가 시 정확히 하나만 성공(10회 반복)', async () => {
    for (let round = 0; round < 10; round++) {
      await setup();
      const a = await task(p1, 'a');
      const b = await task(round % 2 ? p2 : p1, 'b');
      const results = await Promise.all([
        reasonOf(deps.addDependency(me, { fromTaskId: a, toTaskId: b }, meta)),
        reasonOf(deps.addDependency(me, { fromTaskId: b, toTaskId: a }, meta)),
      ]);
      expect(results.sort()).toEqual(['CONFLICT:cycle', 'OK']);
      expect(await prisma.taskDependency.count()).toBe(1);
    }
  });

  it('삭제 감사, 없는 id 는 NOT_FOUND, 보관 프로젝트면 CONFLICT', async () => {
    const a = await task(p1, 'a');
    const b = await task(p1, 'b');
    const d = await deps.addDependency(me, { fromTaskId: a, toTaskId: b }, meta);
    await deps.removeDependency(me, d.id, meta);
    expect(await prisma.taskDependency.count()).toBe(0);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'dependency.delete' } });
    expect(log).toMatchObject({ entityId: d.id, before: { fromTaskId: a, toTaskId: b } });
    expect(await reasonOf(deps.removeDependency(me, d.id, meta))).toBe('NOT_FOUND:');
    const d2 = await deps.addDependency(me, { fromTaskId: a, toTaskId: b }, meta);
    await prisma.project.update({ where: { id: p1 }, data: { archived: true } });
    expect(await reasonOf(deps.removeDependency(me, d2.id, meta))).toBe('CONFLICT:archived');
  });
});

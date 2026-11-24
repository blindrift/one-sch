import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/server/db';
import { AppError } from '@/server/action-result';
import { DEFAULT_TASK_QUERY } from '@/lib/list-query';
import * as tasks from '@/server/services/task-service';
import { listTasks } from '@/server/services/task-list-service';
import { loadTimeline } from '@/server/services/timeline-service';
import { disconnectAll, resetDb } from '../helpers/db';

const meta = { ip: '127.0.0.1', userAgent: 'vitest' };

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
let projectId: string;

async function add(title: string, parentId?: string, pid = projectId) {
  const r = await tasks.createTask(
    me,
    { projectId: pid, parentId, title, startDate: '2026-11-01', endDate: '2026-11-05', progress: 0, status: 'TODO', isMilestone: false },
    meta,
  );
  return r.task;
}
const version = async (id: string) => (await prisma.task.findUniqueOrThrow({ where: { id } })).version;
const order = async (parentId: string | null) =>
  (await prisma.task.findMany({ where: { projectId, parentId }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] })).map((t) => t.title);

beforeEach(async () => {
  await resetDb();
  me = await prisma.user.create({ data: { email: 'me@example.com', name: 'me', role: 'MEMBER' } });
  projectId = (await prisma.project.create({ data: { key: 'ERP', name: 'ERP', color: '#2563eb', ownerId: me.id } })).id;
});
afterAll(async () => {
  await prisma.$disconnect();
  await disconnectAll();
});

describe('reorderTask', () => {
  it('형제끼리 옮기고 옮긴 작업만 version+1, 감사 task.reorder 에 전후 순서', async () => {
    const a = await add('a');
    const b = await add('b');
    const c = await add('c');
    const r = await tasks.reorderTask(me, { id: c.id, version: 0, beforeId: a.id }, meta);
    expect(await order(null)).toEqual(['c', 'a', 'b']);
    expect(r.task.version).toBe(1);
    expect(r.siblings.map((s) => s.id).sort()).toEqual([a.id, b.id, c.id].sort());
    expect([await version(a.id), await version(b.id)]).toEqual([0, 0]);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'task.reorder' } });
    expect(log).toMatchObject({ entityId: c.id, before: { parentId: null, order: [a.id, b.id, c.id] }, after: { parentId: null, order: [c.id, a.id, b.id] } });
    // 형제가 쓰던 sortOrder 값만 다시 쓴다(다른 묶음과 섞이지 않음)
    const values = (await prisma.task.findMany({ where: { projectId }, orderBy: { sortOrder: 'asc' } })).map((t) => t.sortOrder);
    expect(values).toEqual([a.sortOrder, b.sortOrder, c.sortOrder]);
  });

  it('하위 형제끼리도 되고, 간트·목록 순서에 반영된다', async () => {
    const p = await add('p');
    const x = await add('x', p.id);
    const y = await add('y', p.id);
    await add('q');
    await tasks.reorderTask(me, { id: x.id, version: 0, afterId: y.id }, meta);
    expect(await order(p.id)).toEqual(['y', 'x']);
    const list = await listTasks(projectId, DEFAULT_TASK_QUERY);
    expect(list.rows.map((t) => t.title)).toEqual(['p', 'y', 'x', 'q']);
    const timeline = await loadTimeline({ projectId });
    const kids = timeline.tasks.filter((t) => t.parentId === p.id).map((t) => t.title);
    expect(kids).toEqual(['y', 'x']);
  });

  it('다른 상위의 작업·다른 프로젝트 작업을 기준으로 주면 VALIDATION(sibling), DB 불변', async () => {
    const p = await add('p');
    const x = await add('x', p.id);
    const top = await add('top');
    expect(await reasonOf(tasks.reorderTask(me, { id: x.id, version: 0, beforeId: top.id }, meta))).toBe('VALIDATION:sibling');
    const other = (await prisma.project.create({ data: { key: 'OTH', name: 'o', color: '#000000', ownerId: me.id } })).id;
    const foreign = await add('f', undefined, other);
    expect(await reasonOf(tasks.reorderTask(me, { id: top.id, version: 0, beforeId: foreign.id }, meta))).toBe('VALIDATION:sibling');
    expect(await reasonOf(tasks.reorderTask(me, { id: top.id, version: 0, beforeId: '3f1c2b9e-8d4a-4c3b-9a2e-1f0e5d6c7b8a' }, meta))).toBe(
      'VALIDATION:sibling',
    );
    expect(await prisma.auditLog.count({ where: { action: 'task.reorder' } })).toBe(0);
    expect(await version(x.id)).toBe(0);
  });

  it('제자리면 아무것도 쓰지 않는다, version 충돌은 CONFLICT, 보관은 CONFLICT(archived)', async () => {
    const a = await add('a');
    const b = await add('b');
    const r = await tasks.reorderTask(me, { id: a.id, version: 0, beforeId: b.id }, meta);
    expect([r.task.version, r.siblings.length]).toEqual([0, 0]);
    expect(await prisma.auditLog.count({ where: { action: 'task.reorder' } })).toBe(0);
    expect(await reasonOf(tasks.reorderTask(me, { id: a.id, version: 5, afterId: b.id }, meta))).toBe('CONFLICT:version');
    await prisma.project.update({ where: { id: projectId }, data: { archived: true } });
    expect(await reasonOf(tasks.reorderTask(me, { id: a.id, version: 0, afterId: b.id }, meta))).toBe('CONFLICT:archived');
    expect(await order(null)).toEqual(['a', 'b']);
  });

  it('동시에 여러 형제를 옮겨도 sortOrder 가 겹치지 않고 모든 형제가 남는다', async () => {
    const list = [];
    for (const t of ['a', 'b', 'c', 'd', 'e']) list.push(await add(t));
    const [a, b, c, d, e] = list;
    const results = await Promise.all([
      reasonOf(tasks.reorderTask(me, { id: e.id, version: 0, beforeId: a.id }, meta)),
      reasonOf(tasks.reorderTask(me, { id: a.id, version: 0, afterId: d.id }, meta)),
      reasonOf(tasks.reorderTask(me, { id: c.id, version: 0, beforeId: b.id }, meta)),
    ]);
    expect(results).toEqual(['OK', 'OK', 'OK']);
    const rows = await prisma.task.findMany({ where: { projectId } });
    expect(new Set(rows.map((t) => t.sortOrder)).size).toBe(5);
    expect((await order(null)).sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(await prisma.auditLog.count({ where: { action: 'task.reorder' } })).toBe(3);
  });

  it('하위가 있는 작업을 옮기면 하위도 따라가고(간트·목록 순서), 형제 sortOrder 값 집합은 그대로(T-7)', async () => {
    const a = await add('a');
    const a1 = await add('a1', a.id);
    const b = await add('b');
    const c = await add('c');
    const before = (await prisma.task.findMany({ where: { projectId, parentId: null } })).map((t) => t.sortOrder).sort((x, y) => x - y);
    await tasks.reorderTask(me, { id: a.id, version: (await prisma.task.findUniqueOrThrow({ where: { id: a.id } })).version, afterId: c.id }, meta);
    const after = (await prisma.task.findMany({ where: { projectId, parentId: null } })).map((t) => t.sortOrder).sort((x, y) => x - y);
    expect(after).toEqual(before);
    expect((await listTasks(projectId, DEFAULT_TASK_QUERY)).rows.map((t) => t.title)).toEqual(['b', 'c', 'a', 'a1']);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: a1.id } })).parentId).toBe(a.id);
    expect(b.id && a1.id).toBeTruthy();
  });

  it('같은 version 으로 동시에 두 번 옮기면 하나만 성공(OK 1·CONFLICT 1)', async () => {
    const a = await add('a');
    const b = await add('b');
    const c = await add('c');
    const results = await Promise.all([
      reasonOf(tasks.reorderTask(me, { id: c.id, version: 0, beforeId: a.id }, meta)),
      reasonOf(tasks.reorderTask(me, { id: c.id, version: 0, beforeId: b.id }, meta)),
    ]);
    expect(results.sort()).toEqual(['CONFLICT:version', 'OK']);
    expect(await version(c.id)).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'task.reorder' } })).toBe(1);
  });

  it('없는 작업은 NOT_FOUND', async () => {
    const a = await add('a');
    expect(await reasonOf(tasks.reorderTask(me, { id: '3f1c2b9e-8d4a-4c3b-9a2e-1f0e5d6c7b8a', version: 0, beforeId: a.id }, meta))).toBe('NOT_FOUND:');
  });

  it('형제 sortOrder 가 겹친 옛 데이터도 옮긴 뒤에는 겹치지 않는다', async () => {
    const a = await add('a');
    const b = await add('b');
    const c = await add('c');
    await prisma.task.updateMany({ where: { id: { in: [a.id, b.id, c.id] } }, data: { sortOrder: 5 } });
    // 겹친 값은 id 순으로 읽힌다. 그 순서의 첫 작업을 마지막 뒤로 옮긴다(반드시 순서가 바뀌는 이동)
    const [first, , last] = [a, b, c].sort((x, y) => (x.id < y.id ? -1 : 1));
    await tasks.reorderTask(me, { id: first.id, version: 0, afterId: last.id }, meta);
    const rows = await prisma.task.findMany({ where: { projectId }, orderBy: { sortOrder: 'asc' } });
    expect(rows.map((t) => t.sortOrder)).toEqual([5, 6, 7]);
    expect(rows[2].id).toBe(first.id);
  });
});

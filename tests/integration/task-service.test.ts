import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/server/db';
import { AppError } from '@/server/action-result';
import { summarize } from '@/lib/schedule/rollup';
import { toYmd } from '@/lib/dates';
import * as tasks from '@/server/services/task-service';
import { disconnectAll, ownerDb, resetDb } from '../helpers/db';

const meta = { ip: '127.0.0.1', userAgent: 'vitest' };
const MISSING = '3f1c2b9e-8d4a-4c3b-9a2e-1f0e5d6c7b8a';

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

async function makeProject(key: string, archived = false) {
  const p = await prisma.project.create({ data: { key, name: key, color: '#2563eb', ownerId: me.id, archived } });
  return p.id;
}

type NewTask = Partial<Parameters<typeof tasks.createTask>[1]>;
async function add(t: NewTask = {}) {
  const r = await tasks.createTask(
    me,
    {
      projectId,
      title: 't',
      startDate: '2026-11-01',
      endDate: '2026-11-05',
      progress: 0,
      status: 'TODO',
      isMilestone: false,
      ...t,
    },
    meta,
  );
  return r.task;
}

async function row(id: string) {
  return prisma.task.findUniqueOrThrow({ where: { id } });
}

beforeEach(async () => {
  await resetDb();
  me = await prisma.user.create({ data: { email: 'me@example.com', name: 'me', role: 'MEMBER' } });
  projectId = await makeProject('ERP');
});
afterAll(async () => {
  await prisma.$disconnect();
  await disconnectAll();
});

describe('createTask', () => {
  it('생성·감사·sortOrder max+1', async () => {
    const a = await add({ title: 'a' });
    const b = await add({ title: 'b' });
    expect(a).toMatchObject({ title: 'a', startDate: '2026-11-01', endDate: '2026-11-05', version: 0, hasChildren: false });
    expect(b.sortOrder).toBe(a.sortOrder + 1);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'task.create', entityId: a.id } });
    expect(log.after).toMatchObject({ title: 'a', startDate: '2026-11-01', projectId });
  });

  it('없는 프로젝트 NOT_FOUND, 보관 프로젝트 CONFLICT(archived)', async () => {
    expect(await reasonOf(add({ projectId: MISSING }))).toBe('NOT_FOUND:');
    const archived = await makeProject('OLD', true);
    expect(await reasonOf(add({ projectId: archived }))).toBe('CONFLICT:archived');
  });

  it('다른 프로젝트의 상위, 마일스톤 상위, 깊이 6, 비활성 담당자는 거부', async () => {
    const other = await makeProject('OTH');
    const foreign = await add({ projectId: other });
    expect(await reasonOf(add({ parentId: foreign.id }))).toBe('VALIDATION:parent_project');
    expect(await reasonOf(add({ parentId: MISSING }))).toBe('VALIDATION:parent_project');
    const ms = await add({ isMilestone: true, endDate: '2026-11-01' });
    expect(await reasonOf(add({ parentId: ms.id }))).toBe('VALIDATION:parent_milestone');
    let parent = await add({ title: 'd1' });
    for (let d = 2; d <= 5; d++) parent = await add({ title: `d${d}`, parentId: parent.id });
    expect(await reasonOf(add({ title: 'd6', parentId: parent.id }))).toBe('VALIDATION:depth');
    const off = await prisma.user.create({ data: { email: 'off@example.com', name: 'off', active: false } });
    expect(await reasonOf(add({ assigneeId: off.id }))).toBe('VALIDATION:inactive_user');
  });

  it('하위를 만들면 부모·조부모가 재계산되고 version 이 오른다', async () => {
    const gp = await add({ title: 'gp' });
    const p = await add({ title: 'p', parentId: gp.id });
    const r = await tasks.createTask(
      me,
      { projectId, parentId: p.id, title: 'c', startDate: '2026-12-01', endDate: '2026-12-10', progress: 50, status: 'TODO', isMilestone: false },
      meta,
    );
    expect(r.ancestors.map((a) => a.id)).toEqual([p.id, gp.id]);
    expect(await row(p.id)).toMatchObject({ progress: 50 });
    expect(toYmd((await row(gp.id)).endDate)).toBe('2026-12-10');
    expect(toYmd((await row(gp.id)).startDate)).toBe('2026-12-01');
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'task.create', entityId: r.task.id } });
    expect((log.after as { rollup: unknown[] }).rollup).toHaveLength(2);
  });
});

describe('updateTask', () => {
  it('바뀐 필드만 감사, 바뀐 것이 없으면 감사·version 불변', async () => {
    const a = await add();
    const r = await tasks.updateTask(me, { id: a.id, version: 0, title: 't', progress: 30 }, meta);
    expect(r.task).toMatchObject({ progress: 30, version: 1 });
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'task.update' } });
    expect(log.before).toEqual({ progress: 0 });
    expect(log.after).toEqual({ progress: 30 });
    const same = await tasks.updateTask(me, { id: a.id, version: 1, title: 't', progress: 30 }, meta);
    expect(same.task.version).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'task.update' } })).toBe(1);
  });

  it('낡은 version 은 CONFLICT, 없는 id 는 NOT_FOUND, 보관 프로젝트는 CONFLICT(archived)', async () => {
    const a = await add();
    await tasks.updateTask(me, { id: a.id, version: 0, title: 'x' }, meta);
    expect(await reasonOf(tasks.updateTask(me, { id: a.id, version: 0, title: 'y' }, meta))).toBe('CONFLICT:version');
    expect((await row(a.id)).title).toBe('x');
    expect(await reasonOf(tasks.updateTask(me, { id: MISSING, version: 0, title: 'y' }, meta))).toBe('NOT_FOUND:');
    await prisma.project.update({ where: { id: projectId }, data: { archived: true } });
    expect(await reasonOf(tasks.updateTask(me, { id: a.id, version: 1, title: 'y' }, meta))).toBe('CONFLICT:archived');
  });

  it('합친 결과로 날짜 순서·마일스톤을 검사', async () => {
    const a = await add();
    expect(await reasonOf(tasks.updateTask(me, { id: a.id, version: 0, endDate: '2026-10-01' }, meta))).toBe('VALIDATION:endDate');
    expect(await reasonOf(tasks.updateTask(me, { id: a.id, version: 0, isMilestone: true }, meta))).toBe('VALIDATION:milestone_dates');
  });

  it('하위가 있는 상위의 기간·진행률 변경은 거부(D4), 제목은 가능', async () => {
    const p = await add({ title: 'p' });
    await add({ title: 'c', parentId: p.id });
    const cur = await row(p.id);
    expect(await reasonOf(tasks.updateTask(me, { id: p.id, version: cur.version, startDate: '2026-10-01' }, meta))).toBe(
      'CONFLICT:summary',
    );
    expect(await reasonOf(tasks.updateTask(me, { id: p.id, version: cur.version, progress: 99 }, meta))).toBe('CONFLICT:summary');
    expect(await reasonOf(tasks.updateTask(me, { id: p.id, version: cur.version, isMilestone: true }, meta))).toBe(
      'VALIDATION:milestone_has_children',
    );
    // 폼이 현재 값 그대로 보내는 경우는 허용
    const r = await tasks.updateTask(
      me,
      { id: p.id, version: cur.version, title: '새 제목', startDate: toYmd(cur.startDate), endDate: toYmd(cur.endDate), progress: cur.progress },
      meta,
    );
    expect(r.task).toMatchObject({ title: '새 제목', hasChildren: true });
  });

  it('상위 변경: 자기 후손 밑으로 거부, 옮기면 이전·새 상위 모두 재계산', async () => {
    const a = await add({ title: 'a' });
    const b = await add({ title: 'b', parentId: a.id });
    const c = await add({ title: 'c', parentId: b.id, startDate: '2026-12-01', endDate: '2026-12-31', progress: 100 });
    const av = (await row(a.id)).version;
    expect(await reasonOf(tasks.updateTask(me, { id: a.id, version: av, parentId: c.id }, meta))).toBe('VALIDATION:parent_cycle');
    expect(await reasonOf(tasks.updateTask(me, { id: a.id, version: av, parentId: a.id }, meta))).toBe('VALIDATION:parent_cycle');
    const other = await makeProject('OTH');
    const foreign = await add({ projectId: other });
    expect(await reasonOf(tasks.updateTask(me, { id: a.id, version: av, parentId: foreign.id }, meta))).toBe(
      'VALIDATION:parent_project',
    );
    const x = await add({ title: 'x', startDate: '2027-01-01', endDate: '2027-01-02' });
    const r = await tasks.updateTask(me, { id: c.id, version: 0, parentId: x.id }, meta);
    expect(r.ancestors.map((t) => t.id)).toContain(x.id);
    expect(toYmd((await row(x.id)).startDate)).toBe('2026-12-01');
    expect((await row(x.id)).progress).toBe(100);
  });

  it('상위 변경의 깊이 제한은 옮기는 하위 트리 높이까지 센다', async () => {
    let chain = await add({ title: 'd1' });
    for (let d = 2; d <= 4; d++) chain = await add({ title: `d${d}`, parentId: chain.id });
    const top = await add({ title: 'top' });
    await add({ title: 'kid', parentId: top.id });
    const v = (await row(top.id)).version;
    // d4(깊이 4) 밑에 높이 2 트리 → 6 단계
    expect(await reasonOf(tasks.updateTask(me, { id: top.id, version: v, parentId: chain.id }, meta))).toBe('VALIDATION:depth');
  });

  it('자식 수정 시 부모·조부모의 기간·진행률·version 재계산과 audit.rollup', async () => {
    const gp = await add({ title: 'gp' });
    const p = await add({ title: 'p', parentId: gp.id });
    const c = await add({ title: 'c', parentId: p.id });
    const before = { p: (await row(p.id)).version, gp: (await row(gp.id)).version };
    const r = await tasks.updateTask(me, { id: c.id, version: 0, startDate: '2026-11-04', endDate: '2026-11-20', progress: 40 }, meta);
    expect(r.ancestors.map((t) => t.id)).toEqual([p.id, gp.id]);
    for (const id of [p.id, gp.id]) {
      const t = await row(id);
      expect([toYmd(t.startDate), toYmd(t.endDate), t.progress]).toEqual(['2026-11-04', '2026-11-20', 40]);
    }
    expect((await row(p.id)).version).toBe(before.p + 1);
    expect((await row(gp.id)).version).toBe(before.gp + 1);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'task.update', entityId: c.id } });
    expect((log.after as { rollup: Array<{ id: string }> }).rollup.map((x) => x.id)).toEqual([p.id, gp.id]);
  });

  it('형제 10건을 동시에 고쳐도 부모 값 = 다시 계산한 값(10회 반복)', async () => {
    for (let round = 0; round < 10; round++) {
      await resetDb();
      me = await prisma.user.create({ data: { email: 'me@example.com', name: 'me', role: 'MEMBER' } });
      projectId = await makeProject('ERP');
      const p = await add({ title: 'p' });
      const kids = [];
      for (let i = 0; i < 10; i++) kids.push(await add({ title: `k${i}`, parentId: p.id }));
      const results = await Promise.all(
        kids.map((k, i) =>
          reasonOf(
            tasks.updateTask(
              me,
              { id: k.id, version: 0, startDate: `2026-11-${String(i + 1).padStart(2, '0')}`, endDate: `2026-11-${String(i + 11).padStart(2, '0')}`, progress: i * 10 },
              meta,
            ),
          ),
        ),
      );
      expect(results).toEqual(Array(10).fill('OK'));
      const children = await prisma.task.findMany({ where: { parentId: p.id } });
      const expected = summarize(
        children.map((k) => ({ startDate: toYmd(k.startDate), endDate: toYmd(k.endDate), progress: k.progress, isMilestone: k.isMilestone })),
      )!;
      const parent = await row(p.id);
      expect({ startDate: toYmd(parent.startDate), endDate: toYmd(parent.endDate), progress: parent.progress }).toEqual(expected);
    }
  });

  it('DB 세션 시간대가 Asia/Seoul 이어도 2026-11-23 은 그대로 2026-11-23', async () => {
    await ownerDb.$executeRaw`ALTER DATABASE "onesch_test" SET timezone TO 'Asia/Seoul'`;
    try {
      await prisma.$disconnect();
      const [{ tz }] = await prisma.$queryRaw<Array<{ tz: string }>>`SELECT current_setting('TimeZone') AS tz`;
      expect(tz).toBe('Asia/Seoul');
      const a = await add({ startDate: '2026-11-23', endDate: '2026-11-23' });
      expect([a.startDate, a.endDate]).toEqual(['2026-11-23', '2026-11-23']);
      const [raw] = await prisma.$queryRaw<Array<{ s: string }>>`SELECT "startDate"::text AS s FROM "Task" WHERE id = ${a.id}::uuid`;
      expect(raw.s).toBe('2026-11-23');
      const r = await tasks.updateTask(me, { id: a.id, version: 0, title: 'x' }, meta);
      expect(r.task.startDate).toBe('2026-11-23');
    } finally {
      await ownerDb.$executeRaw`ALTER DATABASE "onesch_test" RESET timezone`;
      await prisma.$disconnect();
    }
  });
});

describe('deleteTask', () => {
  it('연쇄 삭제: 하위·의존 삭제, Issue.taskId 는 null, 감사 스냅샷, 부모 재계산', async () => {
    const root = await add({ title: 'root' });
    const p = await add({ title: 'p', parentId: root.id });
    const c = await add({ title: 'c', parentId: p.id, startDate: '2026-12-01', endDate: '2026-12-31' });
    const sib = await add({ title: 'sib', parentId: root.id });
    const other = await add({ title: 'other' });
    await prisma.taskDependency.create({ data: { fromTaskId: c.id, toTaskId: other.id } });
    await prisma.taskDependency.create({ data: { fromTaskId: other.id, toTaskId: sib.id } });
    const issue = await prisma.issue.create({ data: { projectId, number: 1, title: 'i', reporterId: me.id, taskId: c.id } });

    const pv = (await row(p.id)).version;
    expect(await reasonOf(tasks.deleteTask(me, { id: p.id, version: pv + 1 }, meta))).toBe('CONFLICT:version');
    const r = await tasks.deleteTask(me, { id: p.id, version: pv }, meta);
    expect(r.deletedIds.sort()).toEqual([p.id, c.id].sort());
    expect(await prisma.task.count({ where: { id: { in: [p.id, c.id] } } })).toBe(0);
    expect(await prisma.taskDependency.count()).toBe(1);
    expect((await prisma.issue.findUniqueOrThrow({ where: { id: issue.id } })).taskId).toBeNull();
    // root 는 sib 만 남아 sib 기간으로
    expect(toYmd((await row(root.id)).endDate)).toBe('2026-11-05');
    expect(r.ancestors.map((t) => t.id)).toEqual([root.id]);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'task.delete' } });
    expect(log.before).toMatchObject({ title: 'p', descendants: [{ id: c.id, title: 'c' }], dependencies: [{ fromTaskId: c.id, toTaskId: other.id }] });
  });

  it('없는 id NOT_FOUND, 보관 프로젝트 CONFLICT(archived)', async () => {
    expect(await reasonOf(tasks.deleteTask(me, { id: MISSING, version: 0 }, meta))).toBe('NOT_FOUND:');
    const a = await add();
    await prisma.project.update({ where: { id: projectId }, data: { archived: true } });
    expect(await reasonOf(tasks.deleteTask(me, { id: a.id, version: 0 }, meta))).toBe('CONFLICT:archived');
    expect(await prisma.task.count()).toBe(1);
  });
});

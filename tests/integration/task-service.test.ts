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

  it('상위 변경 재계산(T-1): 옛 조상 P·G 와 새 상위 X 의 값·version+1, ancestors·감사 rollup 에 P·G·X', async () => {
    const g = await add({ title: 'G' });
    const p = await add({ title: 'P', parentId: g.id });
    await add({ title: 'c1', parentId: p.id, startDate: '2026-11-01', endDate: '2026-11-05', progress: 0 });
    const c2 = await add({ title: 'c2', parentId: p.id, startDate: '2026-12-01', endDate: '2026-12-31', progress: 100 });
    const x = await add({ title: 'X', startDate: '2027-01-01', endDate: '2027-01-02' });
    const v = { p: (await row(p.id)).version, g: (await row(g.id)).version, x: (await row(x.id)).version };
    const pBefore = await row(p.id);
    expect([toYmd(pBefore.startDate), toYmd(pBefore.endDate)]).toEqual(['2026-11-01', '2026-12-31']);

    const r = await tasks.updateTask(me, { id: c2.id, version: (await row(c2.id)).version, parentId: x.id }, meta);
    expect(r.task.parentId).toBe(x.id);
    expect(r.ancestors.map((t) => t.id)).toEqual([p.id, g.id, x.id]);
    for (const id of [p.id, g.id]) {
      const t = await row(id);
      expect([toYmd(t.startDate), toYmd(t.endDate), t.progress]).toEqual(['2026-11-01', '2026-11-05', 0]);
    }
    const xr = await row(x.id);
    expect([toYmd(xr.startDate), toYmd(xr.endDate), xr.progress]).toEqual(['2026-12-01', '2026-12-31', 100]);
    expect((await row(p.id)).version).toBe(v.p + 1);
    expect((await row(g.id)).version).toBe(v.g + 1);
    expect(xr.version).toBe(v.x + 1);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'task.update', entityId: c2.id } });
    expect(log.before).toEqual({ parentId: p.id });
    const after = log.after as { parentId: string; rollup: Array<{ id: string }> };
    expect(after.parentId).toBe(x.id);
    expect(after.rollup.map((a) => a.id)).toEqual([p.id, g.id, x.id]);
  });

  it('상위 변경 재계산(T-1): 최상위로(parentId:null) 옮기면 옛 조상만 재계산', async () => {
    const g = await add({ title: 'G' });
    const p = await add({ title: 'P', parentId: g.id });
    await add({ title: 'c1', parentId: p.id, startDate: '2026-11-01', endDate: '2026-11-05', progress: 0 });
    const c2 = await add({ title: 'c2', parentId: p.id, startDate: '2026-12-01', endDate: '2026-12-31', progress: 100 });
    const v = { p: (await row(p.id)).version, g: (await row(g.id)).version };

    const r = await tasks.updateTask(me, { id: c2.id, version: (await row(c2.id)).version, parentId: null }, meta);
    expect(r.task.parentId).toBeNull();
    expect(r.ancestors.map((t) => t.id)).toEqual([p.id, g.id]);
    for (const id of [p.id, g.id]) {
      const t = await row(id);
      expect([toYmd(t.startDate), toYmd(t.endDate), t.progress]).toEqual(['2026-11-01', '2026-11-05', 0]);
    }
    expect((await row(p.id)).version).toBe(v.p + 1);
    expect((await row(g.id)).version).toBe(v.g + 1);
    const c2r = await row(c2.id);
    expect([c2r.parentId, toYmd(c2r.startDate), toYmd(c2r.endDate), c2r.progress]).toEqual([null, '2026-12-01', '2026-12-31', 100]);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'task.update', entityId: c2.id } });
    expect(log.before).toEqual({ parentId: p.id });
    const after = log.after as { parentId: string | null; rollup: Array<{ id: string }> };
    expect(after.parentId).toBeNull();
    expect(after.rollup.map((a) => a.id)).toEqual([p.id, g.id]);
  });

  it('상위 변경과 의존(L-1): 형제 A→B 의존이 있으면 B 를 A 밑으로 옮길 수 없고 DB·감사 불변', async () => {
    const a = await add({ title: 'A' });
    const b = await add({ title: 'B' });
    await prisma.taskDependency.create({ data: { fromTaskId: a.id, toTaskId: b.id } });
    const before = { a: await row(a.id), b: await row(b.id), audits: await prisma.auditLog.count() };
    expect(await reasonOf(tasks.updateTask(me, { id: b.id, version: before.b.version, parentId: a.id }, meta))).toBe(
      'VALIDATION:hierarchy',
    );
    // 반대 방향(A 를 B 밑으로)도 같다
    expect(await reasonOf(tasks.updateTask(me, { id: a.id, version: before.a.version, parentId: b.id }, meta))).toBe(
      'VALIDATION:hierarchy',
    );
    expect(await row(a.id)).toEqual(before.a);
    expect(await row(b.id)).toEqual(before.b);
    expect(await prisma.auditLog.count()).toBe(before.audits);
    expect(await prisma.taskDependency.count()).toBe(1);
  });

  it('상위 변경과 의존(L-1): 하위 트리의 후손과 새 상위의 조상 사이 의존도 거부, 관계없는 의존이면 허용', async () => {
    // G > T,  S > s1,  s1 → G 의존. S 를 T 밑으로 옮기면 s1 이 G 의 후손이 된다.
    const g = await add({ title: 'G' });
    const t = await add({ title: 'T', parentId: g.id });
    const sTop = await add({ title: 'S' });
    const s1 = await add({ title: 's1', parentId: sTop.id });
    await prisma.taskDependency.create({ data: { fromTaskId: s1.id, toTaskId: g.id } });
    const sv = (await row(sTop.id)).version;
    const err = await tasks.updateTask(me, { id: sTop.id, version: sv, parentId: t.id }, meta).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ code: 'VALIDATION', reason: 'hierarchy', fieldErrors: { parentId: expect.any(Array) } });
    expect((await row(sTop.id)).parentId).toBeNull();
    expect((await row(sTop.id)).version).toBe(sv);
    // 관계없는 곳(X) 밑으로는 옮길 수 있다
    const x = await add({ title: 'X' });
    const r = await tasks.updateTask(me, { id: sTop.id, version: sv, parentId: x.id }, meta);
    expect(r.task.parentId).toBe(x.id);
  });

  it('계층 동시 변경(T-2): A→B 밑, B→A 밑을 동시에 — 하나만 OK, 하나는 parent_cycle, 순환 없음(10회)', async () => {
    for (let round = 0; round < 10; round++) {
      await resetDb();
      me = await prisma.user.create({ data: { email: 'me@example.com', name: 'me', role: 'MEMBER' } });
      projectId = await makeProject('ERP');
      const a = await add({ title: 'A' });
      const b = await add({ title: 'B' });
      const results = await Promise.all([
        reasonOf(tasks.updateTask(me, { id: a.id, version: 0, parentId: b.id }, meta)),
        reasonOf(tasks.updateTask(me, { id: b.id, version: 0, parentId: a.id }, meta)),
      ]);
      expect([...results].sort()).toEqual(['OK', 'VALIDATION:parent_cycle']);
      const rows = await prisma.task.findMany({ where: { projectId }, select: { id: true, parentId: true } });
      const parentOf = new Map(rows.map((r) => [r.id, r.parentId]));
      for (const start of parentOf.keys()) {
        const seen = new Set<string>();
        for (let cur: string | null | undefined = start; cur; cur = parentOf.get(cur)) {
          expect(seen.has(cur)).toBe(false);
          seen.add(cur);
        }
      }
      expect(rows.filter((r) => r.parentId === null)).toHaveLength(1);
    }
  });

  // 시작=종료인 작업은 마일스톤 여부와 관계없이 가중치가 1 이라 요약 값이 같다. 그래서 부모를 일부러 틀린 값으로
  // 만들어 두고, 재계산 경로를 탔는지(바로잡혔는지)로 확인한다.
  async function staleParentFixture() {
    const g = await add({ title: 'g' });
    const p = await add({ title: 'p', parentId: g.id });
    const c = await add({ title: 'c', parentId: p.id, startDate: '2026-11-03', endDate: '2026-11-03', progress: 40 });
    await prisma.task.update({ where: { id: p.id }, data: { startDate: new Date('2026-10-01T00:00:00Z'), progress: 7 } });
    return { g, p, c, pv: (await row(p.id)).version, gv: (await row(g.id)).version };
  }

  it('isMilestone 만 바꿔도 부모 재계산(T-6)', async () => {
    const { p, c, pv } = await staleParentFixture();
    const r = await tasks.updateTask(me, { id: c.id, version: (await row(c.id)).version, isMilestone: true }, meta);
    expect(r.task.isMilestone).toBe(true);
    expect(r.ancestors.map((t) => t.id)).toContain(p.id);
    const after = await row(p.id);
    expect([toYmd(after.startDate), toYmd(after.endDate), after.progress]).toEqual(['2026-11-03', '2026-11-03', 40]);
    expect(after.version).toBe(pv + 1);
  });

  it('status 만 바꾸면 조상은 건드리지 않는다 — 값·version 불변(T-6)', async () => {
    const { g, p, c, pv, gv } = await staleParentFixture();
    const pBefore = await row(p.id);
    const r = await tasks.updateTask(me, { id: c.id, version: (await row(c.id)).version, status: 'DONE' }, meta);
    expect(r.task.status).toBe('DONE');
    expect(r.ancestors).toEqual([]);
    expect(await row(p.id)).toEqual(pBefore);
    expect((await row(p.id)).version).toBe(pv);
    expect((await row(g.id)).version).toBe(gv);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'task.update', entityId: c.id } });
    expect(log.after).toEqual({ status: 'DONE' });
  });

  it('url·memo: 생성 시 저장·감사, 수정 시 바뀐 것만 감사, null 로 지우기', async () => {
    const memo = '첫 줄\n\t둘째 줄';
    const a = await add({ url: 'https://example.com/ERP-1', memo });
    expect(a).toMatchObject({ url: 'https://example.com/ERP-1', memo });
    expect(await row(a.id)).toMatchObject({ url: 'https://example.com/ERP-1', memo });
    const created = await prisma.auditLog.findFirstOrThrow({ where: { action: 'task.create', entityId: a.id } });
    expect(created.after).toMatchObject({ url: 'https://example.com/ERP-1', memo });

    const plain = await add({ title: 'plain' });
    expect(plain).toMatchObject({ url: null, memo: null });

    const r = await tasks.updateTask(me, { id: a.id, version: 0, url: 'https://example.com/ERP-2' }, meta);
    expect(r.task).toMatchObject({ url: 'https://example.com/ERP-2', memo, version: 1 });
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'task.update', entityId: a.id } });
    expect(log.before).toEqual({ url: 'https://example.com/ERP-1' });
    expect(log.after).toEqual({ url: 'https://example.com/ERP-2' });

    const cleared = await tasks.updateTask(me, { id: a.id, version: 1, url: null, memo: null }, meta);
    expect(cleared.task).toMatchObject({ url: null, memo: null, version: 2 });
    expect(await row(a.id)).toMatchObject({ url: null, memo: null });
    const last = await prisma.auditLog.findFirstOrThrow({ where: { action: 'task.update', entityId: a.id }, orderBy: { id: 'desc' } });
    expect(last.before).toEqual({ url: 'https://example.com/ERP-2', memo });
    expect(last.after).toEqual({ url: null, memo: null });

    // 같은 값(이미 null)이면 감사·version 불변
    const same = await tasks.updateTask(me, { id: a.id, version: 2, url: null, memo: null }, meta);
    expect(same.task.version).toBe(2);
    expect(await prisma.auditLog.count({ where: { action: 'task.update', entityId: a.id } })).toBe(2);
  });

  it('url·memo 만 바꾸면 조상은 건드리지 않는다 — 값·version 불변', async () => {
    const { g, p, c, pv, gv } = await staleParentFixture();
    const pBefore = await row(p.id);
    const r = await tasks.updateTask(
      me,
      { id: c.id, version: (await row(c.id)).version, url: 'https://example.com/x', memo: '메모' },
      meta,
    );
    expect(r.task).toMatchObject({ url: 'https://example.com/x', memo: '메모' });
    expect(r.ancestors).toEqual([]);
    expect(await row(p.id)).toEqual(pBefore);
    expect((await row(p.id)).version).toBe(pv);
    expect((await row(g.id)).version).toBe(gv);
  });

  it('DB CHECK: 빈 문자열·한도 초과 url·memo 는 DB 에서도 거부', async () => {
    const a = await add();
    await expect(prisma.task.update({ where: { id: a.id }, data: { url: '' } })).rejects.toThrow();
    await expect(prisma.task.update({ where: { id: a.id }, data: { url: 'x'.repeat(2001) } })).rejects.toThrow();
    await expect(prisma.task.update({ where: { id: a.id }, data: { memo: '' } })).rejects.toThrow();
    await expect(prisma.task.update({ where: { id: a.id }, data: { memo: 'x'.repeat(5001) } })).rejects.toThrow();
    await prisma.task.update({ where: { id: a.id }, data: { url: 'x'.repeat(2000), memo: 'x'.repeat(5000) } });
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
    expect(log.before).toMatchObject({ title: 'p', dependencies: [{ fromTaskId: c.id, toTaskId: other.id }] });
    // 하위 스냅샷은 snapshot() 과 같은 필드(parentId 포함)라 감사만으로 하위 트리를 다시 세울 수 있다(L-3)
    expect((log.before as { descendants: unknown[] }).descendants).toEqual([
      {
        id: c.id,
        projectId,
        parentId: p.id,
        title: 'c',
        startDate: '2026-12-01',
        endDate: '2026-12-31',
        progress: 0,
        status: 'TODO',
        assigneeId: null,
        isMilestone: false,
        url: null,
        memo: null,
      },
    ]);
  });

  it('없는 id NOT_FOUND, 보관 프로젝트 CONFLICT(archived)', async () => {
    expect(await reasonOf(tasks.deleteTask(me, { id: MISSING, version: 0 }, meta))).toBe('NOT_FOUND:');
    const a = await add();
    await prisma.project.update({ where: { id: projectId }, data: { archived: true } });
    expect(await reasonOf(tasks.deleteTask(me, { id: a.id, version: 0 }, meta))).toBe('CONFLICT:archived');
    expect(await prisma.task.count()).toBe(1);
  });
});

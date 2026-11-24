import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/server/db';
import { AppError } from '@/server/action-result';
import * as issues from '@/server/services/issue-service';
import * as tasks from '@/server/services/task-service';
import { disconnectAll, resetDb } from '../helpers/db';

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

type NewIssue = Partial<Parameters<typeof issues.createIssue>[1]>;
async function add(i: NewIssue = {}) {
  return issues.createIssue(me, { projectId, title: '이슈', description: '', type: 'ISSUE', status: 'OPEN', priority: 'MEDIUM', ...i }, meta);
}

async function addTask(pid = projectId) {
  const r = await tasks.createTask(
    me,
    { projectId: pid, title: 't', startDate: '2026-11-01', endDate: '2026-11-05', progress: 0, status: 'TODO', isMilestone: false },
    meta,
  );
  return r.task;
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

describe('createIssue', () => {
  it('번호는 프로젝트별 1부터 연속, 보고자는 만든 사람, 감사 issue.create', async () => {
    const a = await add({ title: 'a' });
    const b = await add({ title: 'b' });
    const other = await makeProject('OPS');
    const c = await add({ projectId: other, title: 'c' });
    expect([a.key, b.key, c.key]).toEqual(['ERP-1', 'ERP-2', 'OPS-1']);
    expect(a).toMatchObject({ reporterId: me.id, version: 0, status: 'OPEN', dueDate: null });
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'issue.create', entityId: a.id } });
    expect(log.after).toMatchObject({ key: 'ERP-1', title: 'a', number: 1, projectId });
    expect(log.actorId).toBe(me.id);
  });

  it('번호 발급은 Project.version·updatedAt 을 바꾸지 않는다', async () => {
    const before = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    await add();
    const after = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    expect(after.version).toBe(before.version);
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    expect(after.issueSeq).toBe(1);
  });

  it('동시 10건도 번호가 겹치지 않는다(1–10)', async () => {
    const created = await Promise.all(Array.from({ length: 10 }, (_, i) => add({ title: `동시 ${i}` })));
    expect(created.map((c) => c.number).sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: projectId } })).issueSeq).toBe(10);
  });

  it('지운 번호는 다시 쓰지 않는다', async () => {
    const a = await add();
    await issues.deleteIssue(me, { id: a.id, version: 0 }, meta);
    expect((await add()).number).toBe(2);
  });

  it('없는 프로젝트 NOT_FOUND, 보관 프로젝트 CONFLICT(archived), 번호도 발급하지 않음', async () => {
    expect(await reasonOf(add({ projectId: MISSING }))).toBe('NOT_FOUND:');
    const old = await makeProject('OLD', true);
    expect(await reasonOf(add({ projectId: old }))).toBe('CONFLICT:archived');
    expect((await prisma.project.findUniqueOrThrow({ where: { id: old } })).issueSeq).toBe(0);
  });

  it('다른 프로젝트·없는 작업 연결은 VALIDATION(task_project), 같은 프로젝트 작업은 연결', async () => {
    const foreign = await addTask(await makeProject('OTH'));
    expect(await reasonOf(add({ taskId: foreign.id }))).toBe('VALIDATION:task_project');
    expect(await reasonOf(add({ taskId: MISSING }))).toBe('VALIDATION:task_project');
    const mine = await addTask();
    expect((await add({ taskId: mine.id })).taskId).toBe(mine.id);
  });

  it('비활성 담당자 거부, 활성 담당자 지정', async () => {
    const off = await prisma.user.create({ data: { email: 'off@example.com', name: 'off', active: false } });
    expect(await reasonOf(add({ assigneeId: off.id }))).toBe('VALIDATION:inactive_user');
    expect(await reasonOf(add({ assigneeId: MISSING }))).toBe('VALIDATION:inactive_user');
    expect((await add({ assigneeId: me.id, dueDate: '2026-12-31' })).dueDate).toBe('2026-12-31');
  });
});

describe('updateIssue', () => {
  it('바뀐 필드만 감사, version+1. 바뀐 것이 없으면 감사·version 불변', async () => {
    const a = await add({ title: 'a' });
    const r = await issues.updateIssue(me, { id: a.id, version: 0, title: 'a', status: 'RESOLVED', dueDate: '2026-12-01' }, meta);
    expect(r).toMatchObject({ status: 'RESOLVED', dueDate: '2026-12-01', version: 1 });
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'issue.update' } });
    expect(log.before).toEqual({ status: 'OPEN', dueDate: null });
    expect(log.after).toEqual({ status: 'RESOLVED', dueDate: '2026-12-01' });
    const same = await issues.updateIssue(me, { id: a.id, version: 1, status: 'RESOLVED', dueDate: '2026-12-01' }, meta);
    expect(same.version).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'issue.update' } })).toBe(1);
  });

  it('version 이 다르면 CONFLICT(version), DB 불변', async () => {
    const a = await add();
    await issues.updateIssue(me, { id: a.id, version: 0, priority: 'HIGH' }, meta);
    expect(await reasonOf(issues.updateIssue(me, { id: a.id, version: 0, priority: 'LOW' }, meta))).toBe('CONFLICT:version');
    expect((await prisma.issue.findUniqueOrThrow({ where: { id: a.id } })).priority).toBe('HIGH');
  });

  it('같은 version 으로 동시에 두 번 고치면 하나만 성공한다', async () => {
    const a = await add();
    const results = await Promise.all(
      (['HIGH', 'LOW'] as const).map((priority) => reasonOf(issues.updateIssue(me, { id: a.id, version: 0, priority }, meta))),
    );
    expect(results.sort()).toEqual(['CONFLICT:version', 'OK']);
  });

  it('보관 프로젝트의 이슈는 CONFLICT(archived), 없는 이슈 NOT_FOUND', async () => {
    const a = await add();
    await prisma.project.update({ where: { id: projectId }, data: { archived: true } });
    expect(await reasonOf(issues.updateIssue(me, { id: a.id, version: 0, title: 'x' }, meta))).toBe('CONFLICT:archived');
    expect(await reasonOf(issues.updateIssue(me, { id: MISSING, version: 0, title: 'x' }, meta))).toBe('NOT_FOUND:');
  });

  it('작업 연결 변경: 다른 프로젝트 작업 거부, null 로 해제', async () => {
    const mine = await addTask();
    const a = await add({ taskId: mine.id });
    const foreign = await addTask(await makeProject('OTH'));
    expect(await reasonOf(issues.updateIssue(me, { id: a.id, version: 0, taskId: foreign.id }, meta))).toBe('VALIDATION:task_project');
    expect((await issues.updateIssue(me, { id: a.id, version: 0, taskId: null }, meta)).taskId).toBeNull();
  });

  it('비활성 담당자로 바꾸기 거부', async () => {
    const a = await add();
    const off = await prisma.user.create({ data: { email: 'off@example.com', name: 'off', active: false } });
    expect(await reasonOf(issues.updateIssue(me, { id: a.id, version: 0, assigneeId: off.id }, meta))).toBe('VALIDATION:inactive_user');
  });
});

describe('deleteIssue', () => {
  it('실제 삭제, 댓글 cascade, 감사 before 에 스냅샷·댓글 수', async () => {
    const a = await add({ title: '지울 이슈', description: '설명' });
    await prisma.comment.createMany({
      data: [
        { issueId: a.id, authorId: me.id, body: '하나' },
        { issueId: a.id, authorId: me.id, body: '둘', deletedAt: new Date() },
      ],
    });
    expect(await issues.deleteIssue(me, { id: a.id, version: 0 }, meta)).toEqual({ id: a.id });
    expect(await prisma.issue.count()).toBe(0);
    expect(await prisma.comment.count()).toBe(0);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'issue.delete', entityId: a.id } });
    expect(log.before).toMatchObject({ key: 'ERP-1', title: '지울 이슈', description: '설명', commentCount: 2, deletedCommentCount: 1 });
    expect(log.after).toBeNull();
  });

  it('version 충돌·보관·없음', async () => {
    const a = await add();
    expect(await reasonOf(issues.deleteIssue(me, { id: a.id, version: 3 }, meta))).toBe('CONFLICT:version');
    await prisma.project.update({ where: { id: projectId }, data: { archived: true } });
    expect(await reasonOf(issues.deleteIssue(me, { id: a.id, version: 0 }, meta))).toBe('CONFLICT:archived');
    expect(await prisma.issue.count()).toBe(1);
    expect(await reasonOf(issues.deleteIssue(me, { id: MISSING, version: 0 }, meta))).toBe('NOT_FOUND:');
  });

  it('연결된 작업을 지우면 이슈는 남고 taskId 만 NULL', async () => {
    const t = await addTask();
    const a = await add({ taskId: t.id });
    await tasks.deleteTask(me, { id: t.id, version: 0 }, meta);
    const row = await prisma.issue.findUniqueOrThrow({ where: { id: a.id } });
    expect(row.taskId).toBeNull();
    expect(row.version).toBe(0);
  });
});

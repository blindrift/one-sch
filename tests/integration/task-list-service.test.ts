import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/server/db';
import { DEFAULT_TASK_QUERY, type TaskListQuery } from '@/lib/list-query';
import * as tasks from '@/server/services/task-service';
import { listTasks } from '@/server/services/task-list-service';
import { disconnectAll, resetDb } from '../helpers/db';

const meta = { ip: '127.0.0.1', userAgent: 'vitest' };

let me: { id: string };
let projectId: string;
const q = (patch: Partial<TaskListQuery> = {}): TaskListQuery => ({ ...DEFAULT_TASK_QUERY, ...patch });

async function add(title: string, extra: Partial<Parameters<typeof tasks.createTask>[1]> = {}) {
  const r = await tasks.createTask(
    me,
    { projectId, title, startDate: '2020-01-01', endDate: '2020-01-05', progress: 0, status: 'TODO', isMilestone: false, ...extra },
    meta,
  );
  return r.task;
}

beforeEach(async () => {
  await resetDb();
  me = await prisma.user.create({ data: { email: 'me@example.com', name: '나', role: 'MEMBER' } });
  projectId = (await prisma.project.create({ data: { key: 'ERP', name: 'ERP', color: '#2563eb', ownerId: me.id } })).id;
});
afterAll(async () => {
  await prisma.$disconnect();
  await disconnectAll();
});

describe('listTasks', () => {
  it('순서: 간트와 같은 계층 순서, 상위 경로·깊이, 다른 프로젝트 작업 제외', async () => {
    const a = await add('A');
    const b = await add('B');
    const a1 = await add('A-1', { parentId: a.id });
    await add('A-1-x', { parentId: a1.id });
    const other = (await prisma.project.create({ data: { key: 'OTH', name: 'o', color: '#000000', ownerId: me.id } })).id;
    await tasks.createTask(me, { projectId: other, title: '남', startDate: '2026-01-01', endDate: '2026-01-01', progress: 0, status: 'TODO', isMilestone: false }, meta);
    const r = await listTasks(projectId, q());
    expect(r.rows.map((t) => [t.title, t.depth, t.path.join('/')])).toEqual([
      ['A', 0, ''],
      ['A-1', 1, 'A'],
      ['A-1-x', 2, 'A/A-1'],
      ['B', 0, ''],
    ]);
    expect(r.total).toBe(4);
    expect(r.data.tasks).toHaveLength(4);
    expect(b.id).toBeTruthy();
  });

  it('필터·검색(대소문자 무시)·지연·담당자 이름', async () => {
    await add('Login 화면', { assigneeId: me.id });
    await add('배포', { status: 'DONE' });
    await add('미래 작업', { startDate: '2099-01-01', endDate: '2099-01-02' });
    const titles = async (patch: Partial<TaskListQuery>) => (await listTasks(projectId, q(patch))).rows.map((t) => t.title);
    expect(await titles({ status: 'DONE' })).toEqual(['배포']);
    expect(await titles({ assignee: me.id })).toEqual(['Login 화면']);
    expect(await titles({ assignee: 'none' })).toEqual(['배포', '미래 작업']);
    expect(await titles({ q: 'login' })).toEqual(['Login 화면']);
    expect(await titles({ q: '%' })).toEqual([]);
    const rows = (await listTasks(projectId, q())).rows;
    expect(rows.map((t) => [t.title, t.late, t.assigneeName])).toEqual([
      ['Login 화면', true, '나'],
      ['배포', false, null],
      ['미래 작업', false, null],
    ]);
  });

  it('정렬(종료일·진행률 내림차순), 같은 값은 간트 순서로 고정, 페이지', async () => {
    for (let i = 0; i < 55; i += 1) await add(`t${String(i).padStart(2, '0')}`, { endDate: i % 2 ? '2020-02-01' : '2020-01-05' });
    const p1 = await listTasks(projectId, q({ sort: 'end', dir: 'desc' }));
    const p2 = await listTasks(projectId, q({ sort: 'end', dir: 'desc', page: 2 }));
    expect([p1.rows.length, p2.rows.length, p1.pageCount]).toEqual([50, 5, 2]);
    const all = [...p1.rows, ...p2.rows];
    expect(new Set(all.map((t) => t.id)).size).toBe(55);
    expect(all.slice(0, 27).every((t) => t.endDate === '2020-02-01')).toBe(true);
    expect(all.slice(0, 27).map((t) => t.title)).toEqual([...all.slice(0, 27).map((t) => t.title)].sort());
    expect((await listTasks(projectId, q({ page: 7 }))).page).toBe(2);
  });
});

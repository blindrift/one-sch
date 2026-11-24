import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/server/db';
import { findProjectByKey, listProjects, loadTimeline } from '@/server/services/timeline-service';
import { disconnectAll, resetDb } from '../helpers/db';

const D = new Date('2026-11-01T00:00:00Z');

beforeEach(resetDb);
afterAll(async () => {
  await prisma.$disconnect();
  await disconnectAll();
});

describe('timeline-service', () => {
  it('보관 제외, 이메일 미포함, 숨긴 프로젝트에 걸친 의존 제외, hasChildren', async () => {
    const me = await prisma.user.create({ data: { email: 'me@example.com', name: '나', role: 'MEMBER' } });
    await prisma.user.create({ data: { email: 'off@example.com', name: '꺼짐', active: false } });
    const live = await prisma.project.create({ data: { key: 'LIVE', name: 'l', color: '#111111', ownerId: me.id } });
    const old = await prisma.project.create({ data: { key: 'OLD', name: 'o', color: '#222222', ownerId: me.id, archived: true } });
    // sortOrder 가 같으면 id 순(F2)이므로 순서를 단언하려고 sortOrder 를 준다
    const a = await prisma.task.create({ data: { projectId: live.id, title: 'a', startDate: D, endDate: D, sortOrder: 1 } });
    const b = await prisma.task.create({ data: { projectId: live.id, title: 'b', startDate: D, endDate: D, parentId: a.id, sortOrder: 2 } });
    const x = await prisma.task.create({ data: { projectId: old.id, title: 'x', startDate: D, endDate: D } });
    await prisma.taskDependency.create({ data: { fromTaskId: b.id, toTaskId: x.id } });
    const inner = await prisma.taskDependency.create({ data: { fromTaskId: a.id, toTaskId: b.id } });

    const data = await loadTimeline();
    expect(data.projects.map((p) => p.key)).toEqual(['LIVE']);
    expect(data.tasks.map((t) => [t.title, t.hasChildren, t.startDate])).toEqual([
      ['a', true, '2026-11-01'],
      ['b', false, '2026-11-01'],
    ]);
    expect(data.dependencies).toEqual([{ id: inner.id, fromTaskId: a.id, toTaskId: b.id }]);
    expect(data.users).toEqual([{ id: me.id, name: '나' }]);
    expect(JSON.stringify(data)).not.toContain('@example.com');
    expect(data.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const all = await loadTimeline({ includeArchived: true });
    expect(all.projects.map((p) => p.key)).toEqual(['LIVE', 'OLD']);
    expect(all.dependencies).toHaveLength(2);

    const one = await loadTimeline({ projectId: old.id });
    expect(one.projects.map((p) => p.key)).toEqual(['OLD']);
    expect(one.tasks.map((t) => t.title)).toEqual(['x']);
  });

  it('listProjects·findProjectByKey', async () => {
    const me = await prisma.user.create({ data: { email: 'me@example.com', name: '나', role: 'MEMBER' } });
    const p = await prisma.project.create({ data: { key: 'ERP', name: 'e', color: '#111111', ownerId: me.id } });
    await prisma.task.create({ data: { projectId: p.id, title: 'a', startDate: D, endDate: D } });
    expect(await listProjects()).toEqual([expect.objectContaining({ key: 'ERP', ownerName: '나', taskCount: 1 })]);
    expect((await findProjectByKey('ERP'))?.id).toBe(p.id);
    expect(await findProjectByKey('NONE')).toBeNull();
  });
});

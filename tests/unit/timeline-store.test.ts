import { describe, expect, it } from 'vitest';
import { projectRowId } from '@/components/gantt/adapter';
import { EMPTY_FILTER, TimelineStore } from '@/components/gantt/timeline-store';
import type { ProjectDto, TaskDto, TimelineData } from '@/lib/schedule/dto';
import { parseTimelineQuery } from '@/app/(main)/timeline/query';

const project = (id: string, key: string, archived = false): ProjectDto => ({
  id,
  key,
  name: key,
  color: '#2563eb',
  status: 'ACTIVE',
  startDate: null,
  endDate: null,
  ownerId: 'u1',
  archived,
  version: 0,
});

const task = (over: Partial<TaskDto> & { id: string }): TaskDto => ({
  projectId: 'p1',
  parentId: null,
  title: over.id,
  startDate: '2026-11-01',
  endDate: '2026-11-05',
  progress: 0,
  status: 'TODO',
  assigneeId: null,
  isMilestone: false,
  sortOrder: 1,
  version: 0,
  hasChildren: false,
  ...over,
});

function data(): TimelineData {
  return {
    projects: [project('p1', 'ERP'), project('p2', 'WEB', true)],
    tasks: [
      task({ id: 'a', hasChildren: true, sortOrder: 1 }),
      task({ id: 'b', parentId: 'a', assigneeId: 'u1', status: 'DONE', sortOrder: 2 }),
      task({ id: 'c', parentId: 'a', sortOrder: 3 }),
      task({ id: 'w', projectId: 'p2', sortOrder: 1 }),
    ],
    dependencies: [
      { id: 'd1', fromTaskId: 'b', toTaskId: 'c' },
      { id: 'd2', fromTaskId: 'c', toTaskId: 'w' },
    ],
    users: [{ id: 'u1', name: '김' }],
    today: '2026-11-23',
  };
}

describe('TimelineStore', () => {
  it('필터 없음: 모든 프로젝트·작업·의존', () => {
    const v = new TimelineStore(data()).view(EMPTY_FILTER);
    expect(v.rows.map((r) => r.id)).toEqual([projectRowId('p1'), 'a', 'b', 'c', projectRowId('p2'), 'w']);
    expect(v.links.map((l) => l.id)).toEqual(['d1', 'd2']);
  });

  it('프로젝트 필터: 그 프로젝트만, 숨은 작업에 걸친 의존 제외', () => {
    const v = new TimelineStore(data()).view({ ...EMPTY_FILTER, projectKey: 'ERP' });
    expect(v.rows.map((r) => r.id)).toEqual([projectRowId('p1'), 'a', 'b', 'c']);
    expect(v.links.map((l) => l.id)).toEqual(['d1']);
  });

  it('담당자·상태 필터: 맞는 작업과 조상만, 맞는 작업이 없는 프로젝트는 숨김', () => {
    const s = new TimelineStore(data());
    expect(s.view({ ...EMPTY_FILTER, assigneeId: 'u1' }).rows.map((r) => r.id)).toEqual([projectRowId('p1'), 'a', 'b']);
    expect(s.view({ ...EMPTY_FILTER, status: 'DONE' }).rows.map((r) => r.id)).toEqual([projectRowId('p1'), 'a', 'b']);
    expect(s.view({ ...EMPTY_FILTER, assigneeId: 'none' }).visibleTaskIds).toEqual(new Set(['a', 'c', 'w']));
  });

  it('쓰기 결과 반영: 하위가 생기면 요약, 지우면 하위·의존도 사라짐', () => {
    const s = new TimelineStore(data());
    expect(s.hasChildren('c')).toBe(false);
    s.applyWrite({ task: task({ id: 'n', parentId: 'c', sortOrder: 9 }), ancestors: [task({ id: 'c', parentId: 'a', version: 1, endDate: '2026-11-09' })] });
    expect(s.hasChildren('c')).toBe(true);
    expect(s.task('c')).toMatchObject({ hasChildren: true, version: 1, endDate: '2026-11-09' });
    expect(s.descendantsOf('a').sort()).toEqual(['b', 'c', 'n']);
    expect(s.view(EMPTY_FILTER).rows.find((r) => r.id === 'c')?.type).toBe('summary');

    s.applyDelete({ deletedIds: ['c', 'n'], ancestors: [] });
    expect(s.tasks.has('n')).toBe(false);
    expect(s.deps.map((d) => d.id)).toEqual([]);
    expect(s.hasChildren('c')).toBe(false);
  });

  it('보관 프로젝트는 읽기 전용, 접힘 상태는 다시 그려도 유지', () => {
    const s = new TimelineStore(data(), [projectRowId('p1')]);
    expect(s.isReadonlyProject('p2')).toBe(true);
    expect(s.isReadonlyProject('p1')).toBe(false);
    expect(s.view(EMPTY_FILTER).rows[0].open).toBe(false);
    expect(s.projectRow('p1')).toMatchObject({ id: projectRowId('p1'), startYmd: '2026-11-01', endYmd: '2026-11-05' });
  });

  it('의존 추가·삭제(중복 없이)', () => {
    const s = new TimelineStore(data());
    s.addDependency({ id: 'd3', fromTaskId: 'a', toTaskId: 'w' });
    s.addDependency({ id: 'd3', fromTaskId: 'a', toTaskId: 'w' });
    expect(s.deps.map((d) => d.id)).toEqual(['d1', 'd2', 'd3']);
    s.removeDependency('d1');
    expect(s.deps.map((d) => d.id)).toEqual(['d2', 'd3']);
  });
});

describe('parseTimelineQuery', () => {
  it('형식이 맞는 값만 받는다', () => {
    expect(
      parseTimelineQuery({ project: 'ERP', assignee: '0f8fad5b-d9cb-469f-a165-70867728950e', status: 'DONE' }),
    ).toEqual({ projectKey: 'ERP', assigneeId: '0f8fad5b-d9cb-469f-a165-70867728950e', status: 'DONE' });
    expect(parseTimelineQuery({ project: 'erp<script>', assignee: 'x', status: 'NOPE' })).toEqual(EMPTY_FILTER);
    expect(parseTimelineQuery({ project: ['WEB', 'ERP'], assignee: 'none' })).toEqual({ projectKey: 'WEB', assigneeId: 'none', status: null });
  });
});

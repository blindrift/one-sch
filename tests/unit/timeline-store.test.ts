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
  url: null,
  memo: null,
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

  it('상위 변경 결과 반영(T-9): 옛 부모는 하위가 없어지면 일반 작업, 옮긴 작업의 type·parent 갱신', () => {
    const s = new TimelineStore(data());
    // b 를 c 밑으로: a 는 아직 c 가 있어 요약, c 는 요약이 된다
    s.applyWrite({
      task: task({ id: 'b', parentId: 'c', assigneeId: 'u1', status: 'DONE', sortOrder: 2, version: 1 }),
      ancestors: [task({ id: 'c', parentId: 'a', sortOrder: 3, version: 1 })],
    });
    expect(s.hasChildren('a')).toBe(true);
    expect(s.hasChildren('c')).toBe(true);
    // c(와 b) 를 최상위로: a 는 하위가 없어진다
    s.applyWrite({ task: task({ id: 'c', parentId: null, sortOrder: 3, version: 2 }), ancestors: [] });
    expect(s.hasChildren('a')).toBe(false);
    expect(s.task('a')).toMatchObject({ hasChildren: false });
    const rows = new Map(s.view(EMPTY_FILTER).rows.map((r) => [r.id, r]));
    expect(rows.get('a')).toMatchObject({ type: 'task', parent: projectRowId('p1') });
    expect(rows.get('c')).toMatchObject({ type: 'summary', parent: projectRowId('p1') });
    expect(rows.get('b')).toMatchObject({ type: 'task', parent: 'c' });
    expect(s.descendantsOf('c')).toEqual(['b']);
    expect(s.descendantsOf('a')).toEqual([]);
  });

  it('projectRow 는 view() 와 같은 기준(현재 필터 결과의 최상위 작업)으로 계산한다(L-2)', () => {
    const d = data();
    d.tasks.push(task({ id: 'z', startDate: '2026-12-01', endDate: '2026-12-20', progress: 100, sortOrder: 4 }));
    const s = new TimelineStore(d);
    const pick = (r: { startYmd: string | null; endYmd: string | null; progress: number } | null | undefined) =>
      r && { startYmd: r.startYmd, endYmd: r.endYmd, progress: r.progress };
    const filters = [
      EMPTY_FILTER,
      { ...EMPTY_FILTER, assigneeId: 'u1' },
      { ...EMPTY_FILTER, status: 'DONE' as const },
      { ...EMPTY_FILTER, projectKey: 'ERP' },
      { ...EMPTY_FILTER, assigneeId: 'none' },
    ];
    for (const f of filters) {
      const viewRow = s.view(f).rows.find((r) => r.id === projectRowId('p1'));
      expect(pick(s.projectRow('p1', f))).toEqual(pick(viewRow));
    }
    // 필터 없음이면 z 까지, 담당자 u1 이면 a(b) 만
    expect(s.projectRow('p1')).toMatchObject({ startYmd: '2026-11-01', endYmd: '2026-12-20' });
    expect(s.projectRow('p1', { ...EMPTY_FILTER, assigneeId: 'u1' })).toMatchObject({ startYmd: '2026-11-01', endYmd: '2026-11-05' });
    // 필터로 숨은 프로젝트는 null
    expect(s.projectRow('p1', { ...EMPTY_FILTER, projectKey: 'WEB' })).toBeNull();
    expect(s.projectRow('p2', { ...EMPTY_FILTER, assigneeId: 'u1' })).toBeNull();
  });

  it('의존 추가·삭제(중복 없이)', () => {
    const s = new TimelineStore(data());
    s.addDependency({ id: 'd3', fromTaskId: 'a', toTaskId: 'w' });
    s.addDependency({ id: 'd3', fromTaskId: 'a', toTaskId: 'w' });
    expect(s.deps.map((d) => d.id)).toEqual(['d1', 'd2', 'd3']);
    s.removeDependency('d1');
    expect(s.deps.map((d) => d.id)).toEqual(['d2', 'd3']);
  });

  it('폼 저장 결과의 url·memo 가 사본과 막대 행에 반영되고, null 로 지우면 표시가 사라진다', () => {
    const s = new TimelineStore(data());
    s.applyWrite({ task: task({ id: 'c', parentId: 'a', sortOrder: 3, version: 1, url: 'https://example.com', memo: '메모' }), ancestors: [] });
    expect(s.task('c')).toMatchObject({ url: 'https://example.com', memo: '메모', version: 1 });
    expect(s.view(EMPTY_FILTER).rows.find((r) => r.id === 'c')).toMatchObject({ hasUrl: true, memoPreview: '메모' });
    s.applyWrite({ task: task({ id: 'c', parentId: 'a', sortOrder: 3, version: 2 }), ancestors: [] });
    expect(s.view(EMPTY_FILTER).rows.find((r) => r.id === 'c')).toMatchObject({ hasUrl: false, memoPreview: '' });
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

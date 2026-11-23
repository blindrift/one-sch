import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  dragPatch,
  filterTasks,
  projectRowId,
  projectToRow,
  toGanttLinks,
  toGanttRows,
  validateLink,
} from '@/components/gantt/adapter';
import { svarEndFromYmd, ymdToLocalDate } from '@/lib/dates';
import type { ProjectDto, TaskDto } from '@/lib/schedule/dto';

afterEach(() => vi.unstubAllEnvs());

const P: ProjectDto = {
  id: 'p1',
  key: 'ERP',
  name: 'ERP',
  color: '#2563eb',
  status: 'ACTIVE',
  startDate: null,
  endDate: null,
  ownerId: 'u1',
  archived: false,
  version: 0,
};

let seq = 0;
function task(over: Partial<TaskDto>): TaskDto {
  seq += 1;
  return {
    id: `t${seq}`,
    projectId: 'p1',
    parentId: null,
    title: `작업${seq}`,
    startDate: '2026-11-01',
    endDate: '2026-11-05',
    progress: 0,
    status: 'TODO',
    assigneeId: null,
    isMilestone: false,
    sortOrder: seq,
    version: 0,
    hasChildren: false,
    ...over,
  };
}

describe('toGanttRows', () => {
  it('프로젝트=summary, 작업=parent, 마일스톤, 색, 배타 종료일, 담당자 이름', () => {
    const parent = task({ id: 'a', hasChildren: true, startDate: '2026-11-01', endDate: '2026-11-10', progress: 50 });
    const child = task({ id: 'b', parentId: 'a', assigneeId: 'u1', endDate: '2026-11-10' });
    const ms = task({ id: 'm', isMilestone: true, startDate: '2026-11-20', endDate: '2026-11-20' });
    const rows = toGanttRows({ projects: [P], tasks: [child, ms, parent], users: [{ id: 'u1', name: '김' }], today: '2026-11-23' });
    expect(rows.map((r) => r.id)).toEqual([projectRowId('p1'), 'a', 'b', 'm']);
    const [proj, a, b, m] = rows;
    expect(proj).toMatchObject({ type: 'summary', kind: 'project', color: '#2563eb', readonly: true, startYmd: '2026-11-01', endYmd: '2026-11-20' });
    expect(a).toMatchObject({ type: 'summary', parent: projectRowId('p1'), summary: true });
    expect(b).toMatchObject({ type: 'task', parent: 'a', assigneeName: '김', color: '#2563eb' });
    expect(b.end!.getTime()).toBe(svarEndFromYmd('2026-11-10').getTime());
    expect(m).toMatchObject({ type: 'milestone' });
    expect(m.end!.getTime()).toBe(ymdToLocalDate('2026-11-20').getTime());
  });

  it('지연은 잎·미완료·종료일<오늘만', () => {
    const late = task({ endDate: '2026-11-22' });
    const done = task({ endDate: '2026-11-22', status: 'DONE' });
    const summary = task({ endDate: '2026-11-22', hasChildren: true });
    const rows = toGanttRows({ projects: [P], tasks: [late, done, summary], users: [], today: '2026-11-23' });
    expect(rows.slice(1).map((r) => r.late)).toEqual([true, false, false]);
  });

  it('접힌 행은 open=false, 보관 프로젝트 작업은 readonly', () => {
    const a = task({ id: 'x', hasChildren: true });
    const rows = toGanttRows({
      projects: [{ ...P, archived: true }],
      tasks: [a],
      users: [],
      today: '2026-11-23',
      closed: new Set(['x', projectRowId('p1')]),
    });
    expect(rows[0].open).toBe(false);
    expect(rows[1]).toMatchObject({ open: false, readonly: true });
  });

  it('작업 없는 프로젝트: 기간이 있으면 그 기간 막대, 없으면 막대 없음(D16)', () => {
    expect(projectToRow({ ...P, startDate: '2026-11-01', endDate: '2026-11-30' }, [])).toMatchObject({
      type: 'task',
      startYmd: '2026-11-01',
      endYmd: '2026-11-30',
    });
    expect(projectToRow(P, [])).toMatchObject({ unscheduled: true, startYmd: null });
  });

  it('상위가 필터로 빠지면 프로젝트 바로 밑에 둔다', () => {
    const rows = toGanttRows({ projects: [P], tasks: [task({ id: 'c', parentId: 'gone' })], users: [], today: '2026-11-23' });
    expect(rows[1].parent).toBe(projectRowId('p1'));
  });

  it('브라우저 시간대가 달라도 표시 날짜·저장 날짜가 같다', () => {
    vi.stubEnv('TZ', 'America/Los_Angeles');
    const t = task({ startDate: '2026-03-07', endDate: '2026-03-09' });
    const [, row] = toGanttRows({ projects: [P], tasks: [t], users: [], today: '2026-11-23' });
    expect(dragPatch(t, { start: row.start, end: row.end })).toEqual({});
  });
});

describe('dragPatch', () => {
  const t = task({ startDate: '2026-11-01', endDate: '2026-11-05', progress: 10 });
  it('이동: 시작·종료(배타 −1일)만', () => {
    expect(dragPatch(t, { start: ymdToLocalDate('2026-11-04'), end: svarEndFromYmd('2026-11-08') })).toEqual({
      startDate: '2026-11-04',
      endDate: '2026-11-08',
    });
  });
  it('끝 늘이기: 종료만', () => {
    expect(dragPatch(t, { start: ymdToLocalDate('2026-11-01'), end: svarEndFromYmd('2026-11-07') })).toEqual({ endDate: '2026-11-07' });
  });
  it('진행률: 반올림·범위 제한, 바뀐 것만', () => {
    expect(dragPatch(t, { progress: 63.6 })).toEqual({ progress: 64 });
    expect(dragPatch(t, { progress: 10.2 })).toEqual({});
    expect(dragPatch(t, { progress: 140 })).toEqual({ progress: 100 });
  });
  it('마일스톤은 시작=종료로 함께 옮긴다', () => {
    const m = task({ isMilestone: true, startDate: '2026-11-01', endDate: '2026-11-01' });
    expect(dragPatch(m, { start: ymdToLocalDate('2026-11-03'), end: ymdToLocalDate('2026-11-03') })).toEqual({
      startDate: '2026-11-03',
      endDate: '2026-11-03',
    });
  });
});

describe('링크', () => {
  const a = task({ id: 'a' });
  const b = task({ id: 'b', parentId: 'a' });
  const c = task({ id: 'c' });
  const d = task({ id: 'd', projectId: 'p2' });
  const tasks = new Map([a, b, c, d].map((t) => [t.id, t]));
  const deps = [{ id: 'l1', fromTaskId: 'a', toTaskId: 'c' }];
  const ctx = { tasks, readonlyProjects: new Set<string>(), deps };

  it('e2s 외 링크·프로젝트 행·자기 자신 거부', () => {
    expect(validateLink({ source: 'c', target: 'd', type: 's2s' }, ctx)).toBe('type');
    expect(validateLink({ source: projectRowId('p1'), target: 'c', type: 'e2s' }, ctx)).toBe('project-row');
    expect(validateLink({ source: 'c', target: 'c', type: 'e2s' }, ctx)).toBe('self');
  });
  it('조상·후손, 중복, 순환, 보관 거부. 프로젝트 사이 허용', () => {
    expect(validateLink({ source: 'a', target: 'b', type: 'e2s' }, ctx)).toBe('hierarchy');
    expect(validateLink({ source: 'a', target: 'c', type: 'e2s' }, ctx)).toBe('duplicate');
    expect(validateLink({ source: 'c', target: 'a', type: 'e2s' }, ctx)).toBe('cycle');
    expect(validateLink({ source: 'c', target: 'd', type: 'e2s' }, ctx)).toBeNull();
    expect(validateLink({ source: 'c', target: 'd', type: 'e2s' }, { ...ctx, readonlyProjects: new Set(['p2']) })).toBe('readonly');
  });
  it('양 끝이 보이는 의존만', () => {
    expect(toGanttLinks(deps, new Set(['a', 'c']))).toEqual([{ id: 'l1', source: 'a', target: 'c', type: 'e2s' }]);
    expect(toGanttLinks(deps, new Set(['a']))).toEqual([]);
  });
});

describe('filterTasks', () => {
  it('맞는 작업과 조상만 남긴다', () => {
    const r = task({ id: 'r' });
    const k = task({ id: 'k', parentId: 'r', assigneeId: 'u9' });
    const o = task({ id: 'o' });
    expect(filterTasks([r, k, o], (t) => t.assigneeId === 'u9').map((t) => t.id)).toEqual(['r', 'k']);
    expect(filterTasks([r, k, o], null)).toHaveLength(3);
  });
});

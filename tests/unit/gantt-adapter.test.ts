import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  dragPatch,
  filterTasks,
  MEMO_PREVIEW_MAX,
  memoPreview,
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
    url: null,
    memo: null,
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

describe('관련 링크·메모 표시', () => {
  it('URL·메모가 있으면 hasUrl·memoPreview, 없으면 false·빈 문자열, 프로젝트 행은 항상 없음', () => {
    const a = task({ id: 'u', url: 'https://example.com/a', memo: '첫 줄\n둘째   줄' });
    const b = task({ id: 'n' });
    const [proj, ra, rb] = toGanttRows({ projects: [P], tasks: [a, b], users: [], today: '2026-11-01' });
    expect(proj).toMatchObject({ hasUrl: false, memoPreview: '' });
    expect(ra).toMatchObject({ hasUrl: true, memoPreview: '첫 줄 둘째 줄' });
    expect(rb).toMatchObject({ hasUrl: false, memoPreview: '' });
  });
  it('메모 앞부분은 MEMO_PREVIEW_MAX 자에서 자르고 말줄임', () => {
    expect(memoPreview(null)).toBe('');
    expect(memoPreview('x'.repeat(MEMO_PREVIEW_MAX))).toBe('x'.repeat(MEMO_PREVIEW_MAX));
    expect(memoPreview('x'.repeat(MEMO_PREVIEW_MAX + 1))).toBe(`${'x'.repeat(MEMO_PREVIEW_MAX)}…`);
  });
});

describe('진행률 표 편집', () => {
  it('progressEditable: 일반 작업·마일스톤만, 요약·읽기 전용(프로젝트 행·보관)은 아님', async () => {
    const { progressEditable } = await import('@/components/gantt/columns');
    expect(progressEditable({ type: 'task', readonly: false })).toBe(true);
    expect(progressEditable({ type: 'milestone', readonly: false })).toBe(true);
    expect(progressEditable({ type: 'summary', readonly: false })).toBe(false);
    expect(progressEditable({ type: 'task', readonly: true })).toBe(false);
  });

  it('dragPatch: 표에서 온 문자열 숫자는 반올림·0–100, 숫자가 아니거나 빈 값이면 진행률을 바꾸지 않는다', async () => {
    const { dragPatch } = await import('@/components/gantt/adapter');
    const before = { startDate: '2026-11-10', endDate: '2026-11-12', progress: 10, isMilestone: false };
    expect(dragPatch(before, { progress: '55.6' as unknown as number })).toEqual({ progress: 56 });
    expect(dragPatch(before, { progress: 150 })).toEqual({ progress: 100 });
    expect(dragPatch(before, { progress: 'abc' as unknown as number })).toEqual({});
    expect(dragPatch(before, { progress: '' as unknown as number })).toEqual({});
  });
});

describe('shortRange (표의 짧은 기간)', () => {
  it('MM.DD ~ MM.DD, 하루면 MM.DD, 연도를 넘어도 연도 없이', async () => {
    const { shortRange } = await import('@/components/gantt/adapter');
    expect(shortRange('2026-11-14', '2026-11-20')).toBe('11.14 ~ 11.20');
    expect(shortRange('2026-11-25', '2026-11-25')).toBe('11.25');
    expect(shortRange('2026-12-28', '2027-01-03')).toBe('12.28 ~ 01.03');
  });
});

describe('정렬 동점(T-12)', () => {
  it('sortOrder 가 같으면 id 순(목록 탭·DB 쿼리와 같은 순서), 입력 순서와 무관', () => {
    const z = task({ id: 'zz', sortOrder: 5 });
    const a = task({ id: 'aa', sortOrder: 5 });
    const m = task({ id: 'mm', sortOrder: 5 });
    const first = task({ id: 'yy', sortOrder: 1 });
    for (const input of [[z, a, m, first], [m, first, a, z]]) {
      const rows = toGanttRows({ projects: [P], tasks: input, users: [], today: '2026-11-01' });
      expect(rows.slice(1).map((r) => r.id)).toEqual(['yy', 'aa', 'mm', 'zz']);
    }
  });
});

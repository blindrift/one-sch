import { afterEach, describe, expect, it, vi } from 'vitest';
import { projectRowId } from '@/components/gantt/adapter';
import { dayRangeFromX, presetForRow } from '@/components/gantt/drag-create';
import { TimelineStore } from '@/components/gantt/timeline-store';
import type { ProjectDto, TaskDto, TimelineData } from '@/lib/schedule/dto';

const project = (id: string, archived = false): ProjectDto => ({
  id,
  key: id.toUpperCase(),
  name: id,
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

const data = (): TimelineData => ({
  projects: [project('p1'), project('p2', true)],
  tasks: [
    task({ id: 'a', hasChildren: true }),
    task({ id: 'b', parentId: 'a' }),
    task({ id: 'top' }),
    task({ id: 'w', projectId: 'p2' }),
  ],
  dependencies: [],
  users: [],
  today: '2026-11-23',
});

describe('dayRangeFromX (차트 끌기 → 날짜)', () => {
  const start = new Date(2026, 10, 1); // 2026-11-01 로컬 자정

  it('일 줌(32px): 같은 칸 안이면 하루, 칸 경계를 넘으면 그만큼 늘어난다', () => {
    expect(dayRangeFromX(5, 30, start, 32)).toMatchObject({ startDate: '2026-11-01', endDate: '2026-11-01', firstIndex: 0, lastIndex: 0 });
    expect(dayRangeFromX(9 * 32 + 1, 13 * 32 + 31, start, 32)).toMatchObject({ startDate: '2026-11-10', endDate: '2026-11-14' });
  });

  it('오른쪽에서 왼쪽으로 끌어도 앞이 시작일', () => {
    expect(dayRangeFromX(13 * 32 + 2, 9 * 32 + 2, start, 32)).toMatchObject({ startDate: '2026-11-10', endDate: '2026-11-14' });
  });

  it('주 줌(하루 80/7px)·월 경계를 넘는 범위', () => {
    const w = 80 / 7;
    expect(dayRangeFromX(29 * w + 1, 32 * w + 1, start, w)).toMatchObject({ startDate: '2026-11-30', endDate: '2026-12-03' });
  });

  it('음수 x(눈금 앞)는 첫날로 자른다', () => {
    expect(dayRangeFromX(-50, 40, start, 32)).toMatchObject({ startDate: '2026-11-01', endDate: '2026-11-02' });
  });

  describe('일광 절약 시간대에서도 날짜가 하루씩', () => {
    afterEach(() => vi.unstubAllEnvs());
    // [TZ, 1월 offset, 시작일(로컬), DST 가 바뀌는 날을 지나는 5일]
    it.each([
      ['America/Los_Angeles', 480, [2026, 2, 6], '2026-03-06', '2026-03-10'], // 03-08 시작
      ['Europe/London', 0, [2026, 2, 27], '2026-03-27', '2026-03-31'], // 03-29 시작
      ['Europe/London', 0, [2026, 9, 23], '2026-10-23', '2026-10-27'], // 10-25 끝
    ] as const)('%s', (tz, offset, [y, m, d], from, to) => {
      vi.stubEnv('TZ', tz);
      expect(new Date(2026, 0, 1).getTimezoneOffset()).toBe(offset); // stub 이 실제로 먹었는지
      expect(dayRangeFromX(0, 4 * 32 + 1, new Date(y, m, d), 32)).toMatchObject({ startDate: from, endDate: to });
    });
  });
});

describe('presetForRow (끌기 시작 행 → 프로젝트·상위)', () => {
  const store = new TimelineStore(data());

  it('프로젝트 행: 그 프로젝트의 최상위', () => {
    expect(presetForRow(projectRowId('p1'), store)).toEqual({ projectId: 'p1', parentId: null });
  });

  it('하위가 있는 작업 행: 그 작업의 하위로', () => {
    expect(presetForRow('a', store)).toEqual({ projectId: 'p1', parentId: 'a' });
  });

  it('일반 작업 행: 같은 상위의 형제(최상위 작업이면 최상위)', () => {
    expect(presetForRow('b', store)).toEqual({ projectId: 'p1', parentId: 'a' });
    expect(presetForRow('top', store)).toEqual({ projectId: 'p1', parentId: null });
  });

  it('보관 프로젝트의 행은 readonly', () => {
    expect(presetForRow(projectRowId('p2'), store)).toBe('readonly');
    expect(presetForRow('w', store)).toBe('readonly');
  });

  it('행 밖·모르는 행은 null', () => {
    expect(presetForRow(null, store)).toBeNull();
    expect(presetForRow('nope', store)).toBeNull();
  });
});

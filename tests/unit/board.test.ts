import { describe, expect, it } from 'vitest';
import { boardTasks, compareIssueCards, issueColumns, moveCard, taskColumns, compareTaskCards } from '@/lib/board';
import type { TaskDto } from '@/lib/schedule/dto';

const task = (id: string, patch: Partial<TaskDto> = {}): TaskDto => ({
  id,
  projectId: 'p',
  parentId: null,
  title: id,
  startDate: '2026-11-01',
  endDate: '2026-11-05',
  progress: 0,
  status: 'TODO',
  assigneeId: null,
  isMilestone: false,
  sortOrder: 0,
  version: 0,
  url: null,
  memo: null,
  hasChildren: false,
  ...patch,
});

describe('보드 열 계산', () => {
  it('기본은 하위 없는 작업과 마일스톤만, 상위 포함 토글이면 전부', () => {
    const list = [task('leaf'), task('parent', { hasChildren: true }), task('ms', { isMilestone: true })];
    expect(boardTasks(list, false).map((t) => t.id)).toEqual(['leaf', 'ms']);
    expect(boardTasks(list, true).map((t) => t.id)).toEqual(['leaf', 'parent', 'ms']);
  });

  it('열 = 상태, 열 안은 종료일 → sortOrder → id', () => {
    const cols = taskColumns(
      [
        task('b', { endDate: '2026-11-03', sortOrder: 2 }),
        task('a', { endDate: '2026-11-03', sortOrder: 1 }),
        task('c', { endDate: '2026-11-01' }),
        task('d', { status: 'DONE' }),
      ],
      false,
    );
    expect(cols.TODO.map((t) => t.id)).toEqual(['c', 'a', 'b']);
    expect(cols.DONE.map((t) => t.id)).toEqual(['d']);
    expect(cols.IN_PROGRESS).toEqual([]);
    expect(cols.BLOCKED).toEqual([]);
  });

  it('이슈: 마감일 있는 것 먼저(이른 순), 없으면 번호 순', () => {
    const i = (id: string, number: number, dueDate: string | null, status: 'OPEN' | 'CLOSED' = 'OPEN') => ({ id, number, dueDate, status, projectKey: 'ERP' });
    const cols = issueColumns([i('x', 3, null), i('y', 1, null), i('z', 2, '2026-12-01'), i('w', 4, '2026-11-01'), i('v', 5, null, 'CLOSED')]);
    expect(cols.OPEN.map((c) => c.id)).toEqual(['w', 'z', 'y', 'x']);
    expect(cols.CLOSED.map((c) => c.id)).toEqual(['v']);
    expect(cols.RESOLVED).toEqual([]);
  });

  it('moveCard: 원래 열에서 빼고 새 열에 정렬 위치로, 상태도 바꾼다. 같은 열·없는 카드는 그대로', () => {
    const cols = taskColumns([task('a', { endDate: '2026-11-09' }), task('b', { status: 'DONE', endDate: '2026-11-01' }), task('c', { status: 'DONE', endDate: '2026-11-20' })], false);
    const moved = moveCard(cols, 'a', 'DONE', compareTaskCards);
    expect(moved.TODO).toEqual([]);
    expect(moved.DONE.map((t) => [t.id, t.status])).toEqual([
      ['b', 'DONE'],
      ['a', 'DONE'],
      ['c', 'DONE'],
    ]);
    expect(cols.TODO.map((t) => t.id)).toEqual(['a']);
    expect(moveCard(cols, 'a', 'TODO', compareTaskCards)).toBe(cols);
    expect(moveCard(cols, 'zz', 'DONE', compareTaskCards)).toBe(cols);
  });

  it('compareIssueCards 는 프로젝트가 다르면 키 순', () => {
    const a = { id: '1', number: 9, dueDate: null, status: 'OPEN' as const, projectKey: 'AAA' };
    const b = { id: '2', number: 1, dueDate: null, status: 'OPEN' as const, projectKey: 'BBB' };
    expect(compareIssueCards(a, b)).toBeLessThan(0);
  });
});

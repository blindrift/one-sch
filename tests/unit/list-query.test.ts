import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ISSUE_QUERY,
  DEFAULT_TASK_QUERY,
  isOrderMode,
  MAX_PAGE,
  parseIssueListQuery,
  parseTaskListQuery,
  toQueryString,
} from '@/lib/list-query';

const ID = '3F1C2B9E-8D4A-4C3B-9A2E-1F0E5D6C7B8A';

describe('parseTaskListQuery', () => {
  it('빈 query 는 기본값(순서 오름차순, 1쪽)', () => {
    expect(parseTaskListQuery({})).toEqual(DEFAULT_TASK_QUERY);
  });

  it('허용 목록 밖의 정렬·방향·상태는 버린다', () => {
    expect(parseTaskListQuery({ sort: 'createdAt; DROP', dir: 'sideways', status: 'DELETED' })).toEqual(DEFAULT_TASK_QUERY);
    expect(parseTaskListQuery({ sort: 'end', dir: 'desc', status: 'BLOCKED' })).toMatchObject({ sort: 'end', dir: 'desc', status: 'BLOCKED' });
  });

  it('담당자는 uuid(소문자로) 또는 none', () => {
    expect(parseTaskListQuery({ assignee: ID }).assignee).toBe(ID.toLowerCase());
    expect(parseTaskListQuery({ assignee: 'none' }).assignee).toBe('none');
    expect(parseTaskListQuery({ assignee: 'admin' }).assignee).toBeNull();
  });

  it('검색어: trim·공백 압축·100자 자르기, 제어 문자는 버림', () => {
    expect(parseTaskListQuery({ q: '  a   b  ' }).q).toBe('a b');
    expect(parseTaskListQuery({ q: 'x'.repeat(150) }).q).toHaveLength(100);
    expect(parseTaskListQuery({ q: 'a\u0000b' }).q).toBe('');
  });

  it('페이지: 1 이상 정수, 상한, 이상한 값은 1', () => {
    expect(parseTaskListQuery({ page: '3' }).page).toBe(3);
    for (const p of ['0', '-1', '1.5', 'abc', '01', '']) expect(parseTaskListQuery({ page: p }).page).toBe(1);
    expect(parseTaskListQuery({ page: '999999' }).page).toBe(MAX_PAGE);
  });

  it('값이 여러 개면 첫 값', () => {
    expect(parseTaskListQuery({ sort: ['title', 'end'] }).sort).toBe('title');
  });

  it('순서 모드는 정렬 order·asc 이고 필터·검색이 없을 때만', () => {
    expect(isOrderMode(DEFAULT_TASK_QUERY)).toBe(true);
    expect(isOrderMode({ ...DEFAULT_TASK_QUERY, page: 2 })).toBe(true);
    expect(isOrderMode({ ...DEFAULT_TASK_QUERY, dir: 'desc' })).toBe(false);
    expect(isOrderMode({ ...DEFAULT_TASK_QUERY, sort: 'title' })).toBe(false);
    expect(isOrderMode({ ...DEFAULT_TASK_QUERY, status: 'TODO' })).toBe(false);
    expect(isOrderMode({ ...DEFAULT_TASK_QUERY, assignee: 'none' })).toBe(false);
    expect(isOrderMode({ ...DEFAULT_TASK_QUERY, q: 'a' })).toBe(false);
  });
});

describe('parseIssueListQuery', () => {
  it('빈 query 는 기본값(최근 수정 내림차순)', () => {
    expect(parseIssueListQuery({})).toEqual(DEFAULT_ISSUE_QUERY);
  });

  it('필터는 enum·키 형식만', () => {
    expect(parseIssueListQuery({ project: 'ERP', type: 'RISK', status: 'OPEN', priority: 'URGENT' })).toMatchObject({
      project: 'ERP',
      type: 'RISK',
      status: 'OPEN',
      priority: 'URGENT',
    });
    expect(parseIssueListQuery({ project: 'erp', type: 'BUG', status: 'DONE', priority: 'P0' })).toMatchObject({
      project: null,
      type: null,
      status: null,
      priority: null,
    });
  });
});

describe('toQueryString', () => {
  it('기본값·빈 값은 빼고 키 순서를 고정한다', () => {
    expect(toQueryString(DEFAULT_TASK_QUERY, DEFAULT_TASK_QUERY)).toBe('');
    expect(toQueryString({ ...DEFAULT_TASK_QUERY, status: 'TODO', q: '로그 인', page: 2 }, DEFAULT_TASK_QUERY)).toBe('?page=2&q=%EB%A1%9C%EA%B7%B8+%EC%9D%B8&status=TODO');
  });

  it('extra 를 덧붙이고, 되읽으면 같은 query', () => {
    const q = { ...DEFAULT_ISSUE_QUERY, sort: 'priority' as const, dir: 'asc' as const, assignee: 'none' };
    const s = toQueryString(q, DEFAULT_ISSUE_QUERY, { issue: 'ERP-3', empty: null });
    expect(s).toContain('issue=ERP-3');
    expect(s).not.toContain('empty');
    const back = parseIssueListQuery(Object.fromEntries(new URLSearchParams(s.slice(1))));
    expect(back).toEqual(q);
  });
});

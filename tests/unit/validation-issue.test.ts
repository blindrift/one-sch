import { describe, expect, it } from 'vitest';
import { issueKey, parseIssueKey } from '@/lib/issue/status';
import { addCommentSchema, deleteCommentSchema, updateCommentSchema } from '@/lib/validation/comment';
import { createIssueSchema, deleteIssueSchema, updateIssueSchema } from '@/lib/validation/issue';
import { COMMENT_MAX, ISSUE_DESC_MAX } from '@/lib/validation/limits';

const ID = '3f1c2b9e-8d4a-4c3b-9a2e-1f0e5d6c7b8a';

const fieldsOf = (r: { success: boolean; error?: { issues: Array<{ path: PropertyKey[] }> } }) =>
  r.success ? [] : r.error!.issues.map((i) => i.path.join('.'));

describe('issue', () => {
  const base = { projectId: ID, title: ' 로그인 오류 ' };

  it('기본값: 설명 빈 문자열, ISSUE·OPEN·MEDIUM, 제목 trim', () => {
    expect(createIssueSchema.parse(base)).toEqual({
      projectId: ID,
      title: '로그인 오류',
      description: '',
      type: 'ISSUE',
      status: 'OPEN',
      priority: 'MEDIUM',
    });
  });

  it('빈 담당자·작업·마감일은 null', () => {
    expect(createIssueSchema.parse({ ...base, assigneeId: '', taskId: '', dueDate: '' })).toMatchObject({
      assigneeId: null,
      taskId: null,
      dueDate: null,
    });
  });

  it('제목 0자·201자·제어 문자 거부', () => {
    expect(fieldsOf(createIssueSchema.safeParse({ ...base, title: '  ' }))).toContain('title');
    expect(fieldsOf(createIssueSchema.safeParse({ ...base, title: 'x'.repeat(201) }))).toContain('title');
    expect(fieldsOf(createIssueSchema.safeParse({ ...base, title: 'a‮b' }))).toContain('title');
    expect(fieldsOf(createIssueSchema.safeParse({ ...base, title: 'a\nb' }))).toContain('title');
  });

  it('설명은 여러 줄·탭 허용, 20,000자까지, 그 밖의 제어 문자 거부', () => {
    expect(createIssueSchema.parse({ ...base, description: '# 제목\n\n- [ ] 할 일\t탭' }).description).toBe('# 제목\n\n- [ ] 할 일\t탭');
    expect(createIssueSchema.safeParse({ ...base, description: 'd'.repeat(ISSUE_DESC_MAX) }).success).toBe(true);
    expect(fieldsOf(createIssueSchema.safeParse({ ...base, description: 'd'.repeat(ISSUE_DESC_MAX + 1) }))).toContain('description');
    expect(fieldsOf(createIssueSchema.safeParse({ ...base, description: 'a\u0000b' }))).toContain('description');
    expect(fieldsOf(createIssueSchema.safeParse({ ...base, description: 'a​b' }))).toContain('description');
  });

  it.each([
    ['type', 'BUG'],
    ['status', 'DONE'],
    ['priority', 'CRITICAL'],
    ['dueDate', '2026-02-30'],
    ['assigneeId', 'x'],
    ['taskId', 'x'],
  ])('%s=%s 거부', (field, value) => {
    expect(fieldsOf(createIssueSchema.safeParse({ ...base, [field]: value }))).toContain(field);
  });

  it('update 는 projectId·number·reporterId 를 받지 않는다(버려짐), id·version 필수', () => {
    const r = updateIssueSchema.parse({ id: ID, version: 2, projectId: ID, number: 9, reporterId: ID, status: 'RESOLVED' });
    expect(r).toEqual({ id: ID, version: 2, status: 'RESOLVED' });
    expect(fieldsOf(updateIssueSchema.safeParse({ id: 'x' }))).toEqual(expect.arrayContaining(['id', 'version']));
  });

  it('delete 는 id·version', () => {
    expect(deleteIssueSchema.safeParse({ id: ID, version: 0 }).success).toBe(true);
    expect(deleteIssueSchema.safeParse({ id: ID, version: -1 }).success).toBe(false);
  });

  it('KEY-번호 표기·해석', () => {
    expect(issueKey('ERP', 12)).toBe('ERP-12');
    expect(parseIssueKey('erp-12')).toEqual({ projectKey: 'ERP', number: 12 });
    expect(parseIssueKey(' ERP-1 ')).toEqual({ projectKey: 'ERP', number: 1 });
    for (const bad of ['ERP-0', 'ERP-01', 'E-1', 'ERP12', 'ERP-1-2', 'ERP-', 'ERP-1234567890', '1RP-1']) expect(parseIssueKey(bad)).toBeNull();
  });
});

describe('comment', () => {
  it('본문 trim, 1–20,000자, 여러 줄 허용', () => {
    expect(addCommentSchema.parse({ issueId: ID, body: '  안녕\n**굵게**  ' })).toEqual({ issueId: ID, body: '안녕\n**굵게**' });
    expect(fieldsOf(addCommentSchema.safeParse({ issueId: ID, body: ' \n ' }))).toContain('body');
    expect(addCommentSchema.safeParse({ issueId: ID, body: 'b'.repeat(COMMENT_MAX) }).success).toBe(true);
    expect(fieldsOf(addCommentSchema.safeParse({ issueId: ID, body: 'b'.repeat(COMMENT_MAX + 1) }))).toContain('body');
    expect(fieldsOf(addCommentSchema.safeParse({ issueId: ID, body: 'a\u0007b' }))).toContain('body');
  });

  it('update·delete 는 id 가 uuid', () => {
    expect(updateCommentSchema.safeParse({ id: ID, body: 'x' }).success).toBe(true);
    expect(fieldsOf(updateCommentSchema.safeParse({ id: 'x', body: 'x' }))).toContain('id');
    expect(fieldsOf(deleteCommentSchema.safeParse({}))).toContain('id');
  });
});

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/server/db';
import { DEFAULT_ISSUE_QUERY, PAGE_SIZE, type IssueListQuery } from '@/lib/list-query';
import * as comments from '@/server/services/comment-service';
import * as issues from '@/server/services/issue-service';
import { escapeLike, getIssueDetail, listIssues, loadIssueBoard } from '@/server/services/issue-query-service';
import { disconnectAll, resetDb, stringifyRow } from '../helpers/db';

const meta = { ip: '127.0.0.1', userAgent: 'vitest' };

let me: { id: string; role: 'MEMBER' };
let erp: string;
let ops: string;

const q = (patch: Partial<IssueListQuery> = {}): IssueListQuery => ({ ...DEFAULT_ISSUE_QUERY, ...patch });
type NewIssue = Partial<Parameters<typeof issues.createIssue>[1]>;
const add = (i: NewIssue = {}) =>
  issues.createIssue(me, { projectId: erp, title: '이슈', description: '', type: 'ISSUE', status: 'OPEN', priority: 'MEDIUM', ...i }, meta);

beforeEach(async () => {
  await resetDb();
  const u = await prisma.user.create({ data: { email: 'me@example.com', name: '나', role: 'MEMBER' } });
  me = { id: u.id, role: 'MEMBER' };
  erp = (await prisma.project.create({ data: { key: 'ERP', name: 'ERP', color: '#2563eb', ownerId: me.id } })).id;
  ops = (await prisma.project.create({ data: { key: 'OPS', name: 'OPS', color: '#16a34a', ownerId: me.id } })).id;
});
afterAll(async () => {
  await prisma.$disconnect();
  await disconnectAll();
});

describe('listIssues', () => {
  it('프로젝트 범위·필터(유형·상태·우선순위·담당자)', async () => {
    await add({ title: 'a', type: 'RISK', priority: 'HIGH', assigneeId: me.id });
    await add({ title: 'b', status: 'CLOSED' });
    await add({ projectId: ops, title: 'c' });
    const titles = async (scope: Parameters<typeof listIssues>[0], query: IssueListQuery) =>
      (await listIssues(scope, query)).items.map((i) => i.title).sort();
    expect(await titles({ kind: 'project', projectId: erp }, q())).toEqual(['a', 'b']);
    expect(await titles({ kind: 'all' }, q())).toEqual(['a', 'b', 'c']);
    expect(await titles({ kind: 'all' }, q({ project: 'OPS' }))).toEqual(['c']);
    expect(await titles({ kind: 'all' }, q({ type: 'RISK' }))).toEqual(['a']);
    expect(await titles({ kind: 'all' }, q({ status: 'CLOSED' }))).toEqual(['b']);
    expect(await titles({ kind: 'all' }, q({ priority: 'HIGH' }))).toEqual(['a']);
    expect(await titles({ kind: 'all' }, q({ assignee: me.id }))).toEqual(['a']);
    expect(await titles({ kind: 'all' }, q({ assignee: 'none' }))).toEqual(['b', 'c']);
  });

  it('/issues 는 보관 프로젝트를 빼고, 그 프로젝트를 고르면 보인다. 프로젝트 탭은 보관이어도 보인다', async () => {
    await add({ title: 'a' });
    await prisma.project.update({ where: { id: erp }, data: { archived: true } });
    expect((await listIssues({ kind: 'all' }, q())).total).toBe(0);
    const picked = await listIssues({ kind: 'all' }, q({ project: 'ERP' }));
    expect(picked.items.map((i) => [i.title, i.projectArchived])).toEqual([['a', true]]);
    expect((await listIssues({ kind: 'project', projectId: erp }, q())).total).toBe(1);
  });

  it('50건 페이지 경계, 범위를 넘는 페이지는 마지막 페이지, 같은 값 정렬은 id 로 고정', async () => {
    await prisma.issue.createMany({
      data: Array.from({ length: PAGE_SIZE + 3 }, (_, i) => ({ projectId: erp, number: i + 1, title: '같은 제목', reporterId: me.id })),
    });
    const p1 = await listIssues({ kind: 'project', projectId: erp }, q({ sort: 'title', dir: 'asc' }));
    const p2 = await listIssues({ kind: 'project', projectId: erp }, q({ sort: 'title', dir: 'asc', page: 2 }));
    expect([p1.total, p1.pageCount, p1.items.length, p2.items.length, p2.page]).toEqual([PAGE_SIZE + 3, 2, PAGE_SIZE, 3, 2]);
    const ids = [...p1.items, ...p2.items].map((i) => i.id);
    expect(new Set(ids).size).toBe(PAGE_SIZE + 3);
    expect(ids).toEqual([...ids].sort());
    const far = await listIssues({ kind: 'project', projectId: erp }, q({ page: 99 }));
    expect([far.page, far.items.length]).toEqual([2, 3]);
    const empty = await listIssues({ kind: 'project', projectId: ops }, q({ page: 5 }));
    expect([empty.page, empty.pageCount, empty.total]).toEqual([1, 1, 0]);
  });

  it('정렬: 번호·우선순위·마감일(없으면 뒤)', async () => {
    await add({ title: '1', priority: 'LOW', dueDate: '2026-12-10' });
    await add({ title: '2', priority: 'URGENT' });
    await add({ title: '3', priority: 'HIGH', dueDate: '2026-12-01' });
    const order = async (patch: Partial<IssueListQuery>) => (await listIssues({ kind: 'project', projectId: erp }, q(patch))).items.map((i) => i.title);
    expect(await order({ sort: 'number', dir: 'asc' })).toEqual(['1', '2', '3']);
    expect(await order({ sort: 'number', dir: 'desc' })).toEqual(['3', '2', '1']);
    expect(await order({ sort: 'priority', dir: 'desc' })).toEqual(['2', '3', '1']);
    expect(await order({ sort: 'due', dir: 'asc' })).toEqual(['3', '1', '2']);
    expect(await order({ sort: 'due', dir: 'desc' })).toEqual(['1', '3', '2']);
  });

  it('검색: 제목 부분 일치(대소문자 무시), % _ \\ 는 글자 그대로', async () => {
    for (const title of ['Login 오류', '100% 완료', '50 percent', 'a_b', 'axb', 'c\\d', 'cd']) await add({ title });
    const find = async (text: string) => (await listIssues({ kind: 'all' }, q({ q: text }))).items.map((i) => i.title).sort();
    expect(await find('login')).toEqual(['Login 오류']);
    expect(await find('%')).toEqual(['100% 완료']);
    expect(await find('_')).toEqual(['a_b']);
    expect(await find('\\')).toEqual(['c\\d']);
    expect(escapeLike('a%b_c\\')).toBe('a\\%b\\_c\\\\');
  });

  it('검색: KEY-번호 는 그 이슈를 찾는다(소문자도)', async () => {
    await add({ title: 'x' });
    await add({ title: 'y' });
    await add({ projectId: ops, title: 'z' });
    expect((await listIssues({ kind: 'all' }, q({ q: 'erp-2' }))).items.map((i) => i.key)).toEqual(['ERP-2']);
    expect((await listIssues({ kind: 'project', projectId: erp }, q({ q: 'OPS-1' }))).total).toBe(0);
  });

  it('행에는 이름만 있고 이메일·설명이 없다, 댓글 수는 지운 것 제외', async () => {
    const i = await add({ title: 'a', description: '비밀 아닌 설명', assigneeId: me.id });
    const c = await comments.addComment(me, { issueId: i.id, body: '1' }, meta);
    await comments.addComment(me, { issueId: i.id, body: '2' }, meta);
    await comments.deleteComment(me, { id: c.id }, meta);
    const [row] = (await listIssues({ kind: 'all' }, q())).items;
    expect(row).toMatchObject({ assigneeName: '나', commentCount: 1, projectKey: 'ERP', key: 'ERP-1' });
    expect(stringifyRow(row)).not.toContain('@example.com');
    expect(row).not.toHaveProperty('description');
  });
});

describe('getIssueDetail', () => {
  it('연결 작업·댓글(작성 순), 지운 댓글은 본문 없음, 이메일 없음', async () => {
    const t = await prisma.task.create({
      data: { projectId: erp, title: '연결 작업', startDate: new Date('2026-11-01'), endDate: new Date('2026-11-02') },
    });
    const i = await add({ title: '상세', description: '**본문**', taskId: t.id });
    const c1 = await comments.addComment(me, { issueId: i.id, body: '첫 댓글' }, meta);
    await comments.addComment(me, { issueId: i.id, body: '두 번째' }, meta);
    await comments.deleteComment(me, { id: c1.id }, meta);
    const d = await getIssueDetail('erp-1');
    expect(d).toMatchObject({ key: 'ERP-1', description: '**본문**', reporterName: '나', task: { id: t.id, title: '연결 작업' } });
    expect(d!.comments.map((c) => [c.body, c.deleted])).toEqual([
      [null, true],
      ['두 번째', false],
    ]);
    const text = stringifyRow(d);
    expect(text).not.toContain('첫 댓글');
    expect(text).not.toContain('@example.com');
  });

  it('없는 번호·잘못된 형식·다른 프로젝트 범위는 null', async () => {
    await add();
    expect(await getIssueDetail('ERP-2')).toBeNull();
    expect(await getIssueDetail('nope')).toBeNull();
    expect(await getIssueDetail('ERP-1', ops)).toBeNull();
    expect(await getIssueDetail('ERP-1', erp)).not.toBeNull();
  });
});

describe('loadIssueBoard', () => {
  it('그 프로젝트의 이슈 전체(페이지 없음)', async () => {
    await prisma.issue.createMany({
      data: Array.from({ length: PAGE_SIZE + 5 }, (_, i) => ({ projectId: erp, number: i + 1, title: `i${i}`, reporterId: me.id })),
    });
    await add({ projectId: ops });
    expect(await loadIssueBoard(erp)).toHaveLength(PAGE_SIZE + 5);
  });
});

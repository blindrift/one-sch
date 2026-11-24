import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/server/db';
import { AppError } from '@/server/action-result';
import * as comments from '@/server/services/comment-service';
import * as issues from '@/server/services/issue-service';
import { disconnectAll, resetDb } from '../helpers/db';

const meta = { ip: '127.0.0.1', userAgent: 'vitest' };
const MISSING = '3f1c2b9e-8d4a-4c3b-9a2e-1f0e5d6c7b8a';

async function reasonOf(p: Promise<unknown>) {
  try {
    await p;
    return 'OK';
  } catch (e) {
    if (e instanceof AppError) return `${e.code}:${e.reason ?? ''}`;
    throw e;
  }
}

type Actor = comments.CommentActor;
let member: Actor;
let viewer: Actor;
let admin: Actor;
let projectId: string;
let issueId: string;

beforeEach(async () => {
  await resetDb();
  const mk = async (name: string, role: 'ADMIN' | 'MEMBER' | 'VIEWER') => {
    const u = await prisma.user.create({ data: { email: `${name}@example.com`, name, role } });
    return { id: u.id, role };
  };
  member = await mk('member', 'MEMBER');
  viewer = await mk('viewer', 'VIEWER');
  admin = await mk('admin', 'ADMIN');
  projectId = (await prisma.project.create({ data: { key: 'ERP', name: 'ERP', color: '#2563eb', ownerId: member.id } })).id;
  issueId = (
    await issues.createIssue(member, { projectId, title: 'i', description: '', type: 'ISSUE', status: 'OPEN', priority: 'MEDIUM' }, meta)
  ).id;
});
afterAll(async () => {
  await prisma.$disconnect();
  await disconnectAll();
});

const archive = () => prisma.project.update({ where: { id: projectId }, data: { archived: true } });

describe('addComment', () => {
  it('VIEWER 도 쓸 수 있고, 작성자 이름만 싣는다(이메일 없음). 감사 comment.create', async () => {
    const c = await comments.addComment(viewer, { issueId, body: '**확인**했습니다' }, meta);
    expect(c).toMatchObject({ authorId: viewer.id, authorName: 'viewer', body: '**확인**했습니다', deleted: false, edited: false });
    expect(JSON.stringify(c)).not.toContain('@example.com');
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'comment.create' } });
    expect(log).toMatchObject({ actorId: viewer.id, entityId: c.id, after: { issueId, body: '**확인**했습니다' } });
  });

  it('없는 이슈 NOT_FOUND, 보관 프로젝트 CONFLICT(archived)', async () => {
    expect(await reasonOf(comments.addComment(member, { issueId: MISSING, body: 'x' }, meta))).toBe('NOT_FOUND:');
    await archive();
    expect(await reasonOf(comments.addComment(viewer, { issueId, body: 'x' }, meta))).toBe('CONFLICT:archived');
    expect(await prisma.comment.count()).toBe(0);
  });
});

describe('댓글 수 상한(F8·S-6)', () => {
  it('살아 있는 댓글 1,000개에서 막히고(comment_limit), 하나 지우면 다시 쓸 수 있다. 다른 이슈는 영향 없음', async () => {
    await prisma.comment.createMany({ data: Array.from({ length: 999 }, (_, i) => ({ issueId, authorId: member.id, body: `c${i}` })) });
    // 지운 댓글은 1,000개 상한에 들지 않는다
    await prisma.comment.createMany({ data: Array.from({ length: 10 }, (_, i) => ({ issueId, authorId: member.id, body: `d${i}`, deletedAt: new Date() })) });
    const last = await comments.addComment(viewer, { issueId, body: '1000번째' }, meta);
    expect(await reasonOf(comments.addComment(viewer, { issueId, body: '1001번째' }, meta))).toBe('VALIDATION:comment_limit');
    await comments.deleteComment(viewer, { id: last.id }, meta);
    expect(await reasonOf(comments.addComment(viewer, { issueId, body: '지운 뒤 다시' }, meta))).toBe('OK');
    expect(await prisma.comment.count({ where: { issueId, deletedAt: null } })).toBe(1000);
    const other = await issues.createIssue(member, { projectId, title: 'j', description: '', type: 'ISSUE', status: 'OPEN', priority: 'MEDIUM' }, meta);
    expect(await reasonOf(comments.addComment(viewer, { issueId: other.id, body: 'x' }, meta))).toBe('OK');
  });

  it('지운 것까지 포함한 저장 행 5,000개에서 막힌다(살아 있는 댓글이 적어도)', async () => {
    await prisma.comment.createMany({ data: Array.from({ length: 4999 }, (_, i) => ({ issueId, authorId: member.id, body: `d${i}`, deletedAt: new Date() })) });
    expect(await reasonOf(comments.addComment(viewer, { issueId, body: '5000번째 행' }, meta))).toBe('OK');
    expect(await reasonOf(comments.addComment(viewer, { issueId, body: '5001번째 행' }, meta))).toBe('VALIDATION:comment_limit');
    expect(await prisma.comment.count({ where: { issueId } })).toBe(5000);
  });
});

describe('updateComment', () => {
  it('작성자만 고친다(ADMIN 도 남의 댓글은 못 고침). 감사에 본문 전후', async () => {
    const c = await comments.addComment(viewer, { issueId, body: '처음' }, meta);
    expect(await reasonOf(comments.updateComment(member, { id: c.id, body: 'x' }, meta))).toBe('FORBIDDEN:not_author');
    expect(await reasonOf(comments.updateComment(admin, { id: c.id, body: 'x' }, meta))).toBe('FORBIDDEN:not_author');
    const r = await comments.updateComment(viewer, { id: c.id, body: '고침' }, meta);
    expect(r).toMatchObject({ body: '고침', edited: true });
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'comment.update' } });
    expect(log).toMatchObject({ before: { body: '처음' }, after: { body: '고침' } });
  });

  it('같은 본문이면 감사·updatedAt 불변', async () => {
    const c = await comments.addComment(viewer, { issueId, body: '같음' }, meta);
    const r = await comments.updateComment(viewer, { id: c.id, body: '같음' }, meta);
    expect(r.edited).toBe(false);
    expect(await prisma.auditLog.count({ where: { action: 'comment.update' } })).toBe(0);
  });

  it('지운 댓글·없는 댓글은 NOT_FOUND, 보관 프로젝트는 CONFLICT(archived)', async () => {
    const c = await comments.addComment(viewer, { issueId, body: 'a' }, meta);
    const d = await comments.addComment(viewer, { issueId, body: 'b' }, meta);
    await comments.deleteComment(viewer, { id: d.id }, meta);
    expect(await reasonOf(comments.updateComment(viewer, { id: d.id, body: 'x' }, meta))).toBe('NOT_FOUND:');
    expect(await reasonOf(comments.updateComment(viewer, { id: MISSING, body: 'x' }, meta))).toBe('NOT_FOUND:');
    await archive();
    expect(await reasonOf(comments.updateComment(viewer, { id: c.id, body: 'x' }, meta))).toBe('CONFLICT:archived');
    expect((await prisma.comment.findUniqueOrThrow({ where: { id: c.id } })).body).toBe('a');
  });
});

describe('deleteComment', () => {
  it('작성자 본인은 지울 수 있다: deletedAt 소프트 삭제, 응답에 본문 없음, 감사 before 에 본문', async () => {
    const c = await comments.addComment(viewer, { issueId, body: '지울 글' }, meta);
    const r = await comments.deleteComment(viewer, { id: c.id }, meta);
    expect(r).toMatchObject({ deleted: true, body: null, edited: false });
    const row = await prisma.comment.findUniqueOrThrow({ where: { id: c.id } });
    expect(row.deletedAt).not.toBeNull();
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'comment.delete' } });
    expect(log).toMatchObject({ actorId: viewer.id, before: { issueId, authorId: viewer.id, body: '지울 글' } });
  });

  it('남의 댓글: MEMBER·VIEWER 는 FORBIDDEN, ADMIN 은 지운다. 두 번 지우면 NOT_FOUND', async () => {
    const c = await comments.addComment(viewer, { issueId, body: 'v' }, meta);
    expect(await reasonOf(comments.deleteComment(member, { id: c.id }, meta))).toBe('FORBIDDEN:not_author');
    const other = await prisma.user.create({ data: { email: 'v2@example.com', name: 'v2', role: 'VIEWER' } });
    expect(await reasonOf(comments.deleteComment({ id: other.id, role: 'VIEWER' }, { id: c.id }, meta))).toBe('FORBIDDEN:not_author');
    expect(await reasonOf(comments.deleteComment(admin, { id: c.id }, meta))).toBe('OK');
    expect(await reasonOf(comments.deleteComment(admin, { id: c.id }, meta))).toBe('NOT_FOUND:');
    expect((await prisma.auditLog.findFirstOrThrow({ where: { action: 'comment.delete' } })).actorId).toBe(admin.id);
  });

  it('보관 프로젝트에서는 ADMIN 도 CONFLICT(archived)', async () => {
    const c = await comments.addComment(viewer, { issueId, body: 'v' }, meta);
    await archive();
    expect(await reasonOf(comments.deleteComment(admin, { id: c.id }, meta))).toBe('CONFLICT:archived');
    expect((await prisma.comment.findUniqueOrThrow({ where: { id: c.id } })).deletedAt).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { createProjectSchema, setProjectArchivedSchema, updateProjectSchema } from '@/lib/validation/project';
import { addDependencySchema, createTaskSchema, deleteTaskSchema, updateTaskSchema } from '@/lib/validation/task';

const ID = '3f1c2b9e-8d4a-4c3b-9a2e-1f0e5d6c7b8a';
const ID2 = '4f1c2b9e-8d4a-4c3b-9a2e-1f0e5d6c7b8a';

const fieldsOf = (r: { success: boolean; error?: { issues: Array<{ path: PropertyKey[] }> } }) =>
  r.success ? [] : r.error!.issues.map((i) => i.path.join('.'));

describe('project', () => {
  const base = { key: 'erp', name: ' ERP 개편 ', color: '#AABBCC' };
  it('키는 대문자로, 이름은 trim, 색은 소문자, 상태 기본 PLANNED', () => {
    expect(createProjectSchema.parse(base)).toMatchObject({ key: 'ERP', name: 'ERP 개편', color: '#aabbcc', status: 'PLANNED' });
  });
  it.each(['E', '1ERP', 'ERP-1', 'ABCDEFGHIJK', '가나'])('키 %s 거부', (key) => {
    expect(fieldsOf(createProjectSchema.safeParse({ ...base, key }))).toContain('key');
  });
  it.each(['#abc', 'red', '#12345g', '112233'])('색 %s 거부', (color) => {
    expect(fieldsOf(createProjectSchema.safeParse({ ...base, color }))).toContain('color');
  });
  it('이름 0자·101자 거부', () => {
    expect(fieldsOf(createProjectSchema.safeParse({ ...base, name: '  ' }))).toContain('name');
    expect(fieldsOf(createProjectSchema.safeParse({ ...base, name: 'x'.repeat(101) }))).toContain('name');
  });
  it('빈 날짜는 null, 종료 < 시작 거부', () => {
    expect(createProjectSchema.parse({ ...base, startDate: '', endDate: '' })).toMatchObject({ startDate: null, endDate: null });
    expect(fieldsOf(createProjectSchema.safeParse({ ...base, startDate: '2026-02-01', endDate: '2026-01-31' }))).toContain('endDate');
    expect(fieldsOf(createProjectSchema.safeParse({ ...base, startDate: '2026-02-30' }))).toContain('startDate');
  });
  it('update 는 key 를 받지 않는다(버려짐), id·version 필수', () => {
    const r = updateProjectSchema.parse({ id: ID, version: 0, key: 'HACK', name: 'n' });
    expect(r).not.toHaveProperty('key');
    expect(fieldsOf(updateProjectSchema.safeParse({ id: 'x', name: 'n' }))).toEqual(expect.arrayContaining(['id', 'version']));
  });
  it('archive', () => {
    expect(setProjectArchivedSchema.safeParse({ id: ID, version: 1, archived: true }).success).toBe(true);
    expect(setProjectArchivedSchema.safeParse({ id: ID, version: -1, archived: true }).success).toBe(false);
  });
});

describe('task', () => {
  const base = { projectId: ID, title: ' 설계 ', startDate: '2026-11-01', endDate: '2026-11-05' };
  it('기본값', () => {
    expect(createTaskSchema.parse(base)).toMatchObject({ title: '설계', progress: 0, status: 'TODO', isMilestone: false });
  });
  it('제목 0자·201자 거부, 200자 허용', () => {
    expect(fieldsOf(createTaskSchema.safeParse({ ...base, title: '' }))).toContain('title');
    expect(fieldsOf(createTaskSchema.safeParse({ ...base, title: 'x'.repeat(201) }))).toContain('title');
    expect(createTaskSchema.safeParse({ ...base, title: 'x'.repeat(200) }).success).toBe(true);
  });
  it('진행률 소수·101·음수 거부', () => {
    for (const progress of [1.5, 101, -1, '50']) {
      expect(fieldsOf(createTaskSchema.safeParse({ ...base, progress }))).toContain('progress');
    }
  });
  it('종료 < 시작 거부, 마일스톤은 같은 날만', () => {
    expect(fieldsOf(createTaskSchema.safeParse({ ...base, endDate: '2026-10-31' }))).toContain('endDate');
    expect(fieldsOf(createTaskSchema.safeParse({ ...base, isMilestone: true }))).toContain('endDate');
    expect(createTaskSchema.safeParse({ ...base, endDate: base.startDate, isMilestone: true }).success).toBe(true);
  });
  it('uuid 형식', () => {
    expect(fieldsOf(createTaskSchema.safeParse({ ...base, projectId: 'abc' }))).toContain('projectId');
    expect(fieldsOf(createTaskSchema.safeParse({ ...base, parentId: '1' }))).toContain('parentId');
    expect(createTaskSchema.parse({ ...base, parentId: '', assigneeId: '' })).toMatchObject({ parentId: null, assigneeId: null });
  });
  it('update 는 projectId·key 를 무시한다', () => {
    const r = updateTaskSchema.parse({ id: ID, version: 3, projectId: ID2, key: 'X', progress: 10 });
    expect(r).toEqual({ id: ID, version: 3, progress: 10 });
  });
  it('update 의 날짜 쌍·마일스톤 검사', () => {
    expect(fieldsOf(updateTaskSchema.safeParse({ id: ID, version: 0, startDate: '2026-01-02', endDate: '2026-01-01' }))).toContain(
      'endDate',
    );
    expect(
      fieldsOf(updateTaskSchema.safeParse({ id: ID, version: 0, isMilestone: true, startDate: '2026-01-01', endDate: '2026-01-02' })),
    ).toContain('endDate');
  });
  it('delete·dependency', () => {
    expect(deleteTaskSchema.safeParse({ id: ID }).success).toBe(false);
    expect(fieldsOf(addDependencySchema.safeParse({ fromTaskId: ID, toTaskId: ID }))).toContain('toTaskId');
    expect(addDependencySchema.safeParse({ fromTaskId: ID, toTaskId: ID2 }).success).toBe(true);
  });
});

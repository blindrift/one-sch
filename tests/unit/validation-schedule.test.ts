import { describe, expect, it } from 'vitest';
import { createProjectSchema, setProjectArchivedSchema, updateProjectSchema } from '@/lib/validation/project';
import { isHttpUrl, TASK_MEMO_MAX, TASK_URL_MAX } from '@/lib/validation/limits';
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

describe('제목·이름의 제어 문자(S-4)', () => {
  const bad = [
    ...['a\u0000b', 'a\u0007b', 'a\nb', 'a\tb', 'a\u001fb', 'a\u007fb', 'a\u202ab', 'a\u202eb', 'a\u2066b', 'a\u2069b'],
    // S-5: C1 제어, ALM, 폭 없는 문자·LRM/RLM, 줄·문단 구분자, BOM
    ...['a\u0080b', 'a\u0085b', 'a\u009fb', 'a\u061cb', 'a\u200bb', 'a\u200cb', 'a\u200eb', 'a\u200fb', 'a\u2028b', 'a\u2029b', 'a\ufeffb'],
  ];
  const taskBase = { projectId: ID, startDate: '2026-11-01', endDate: '2026-11-02' };
  const projectBase = { key: 'ERP', color: '#aabbcc' };
  it.each(bad.map((s) => [JSON.stringify(s), s]))('%s 거부(작업 생성·수정, 프로젝트 생성·수정)', (_, s) => {
    expect(fieldsOf(createTaskSchema.safeParse({ ...taskBase, title: s }))).toContain('title');
    expect(fieldsOf(updateTaskSchema.safeParse({ id: ID, version: 0, title: s }))).toContain('title');
    expect(fieldsOf(createProjectSchema.safeParse({ ...projectBase, name: s }))).toContain('name');
    expect(fieldsOf(updateProjectSchema.safeParse({ id: ID, version: 0, name: s }))).toContain('name');
  });
  it('앞뒤 공백·줄바꿈은 trim 되고, 한글·이모지·기호·히브리 문자·NBSP 는 허용', () => {
    expect(createTaskSchema.parse({ ...taskBase, title: '\n 설계 검토 \t' }).title).toBe('설계 검토');
    for (const ok of ['설계 검토 🚀', 'A/B (v2) — 최종', 'אבג עברית', 'x\u00a0y', '\u{1F469}\u200d\u{1F4BB} 작업']) {
      expect(createTaskSchema.safeParse({ ...taskBase, title: ok }).success).toBe(true);
      expect(createProjectSchema.safeParse({ ...projectBase, name: ok }).success).toBe(true);
    }
  });
});

describe('작업의 관련 링크(url)·메모(memo)', () => {
  const base = { projectId: ID, title: '설계', startDate: '2026-11-01', endDate: '2026-11-05' };
  const upd = { id: ID, version: 0 };
  it('생략하면 없음, http·https 허용(앞뒤 공백 trim)', () => {
    expect(createTaskSchema.parse(base)).not.toHaveProperty('url');
    expect(createTaskSchema.parse({ ...base, url: ' https://example.com/a?b=1#c ' }).url).toBe('https://example.com/a?b=1#c');
    expect(createTaskSchema.parse({ ...base, url: 'http://intra.local:8080/x' }).url).toBe('http://intra.local:8080/x');
    expect(updateTaskSchema.parse({ ...upd, url: 'https://jira.example.com/browse/ERP-1' }).url).toBe('https://jira.example.com/browse/ERP-1');
  });
  it('빈 문자열·공백·null 은 null(수정에서 지우기)', () => {
    for (const v of ['', '   ', null]) {
      expect(createTaskSchema.parse({ ...base, url: v, memo: v })).toMatchObject({ url: null, memo: null });
      expect(updateTaskSchema.parse({ ...upd, url: v, memo: v })).toEqual({ ...upd, url: null, memo: null });
    }
  });
  it.each(['javascript:alert(1)', 'JavaScript:alert(1)', ' javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:x', 'file:///etc/passwd', 'ftp://example.com', 'example.com', '/relative/path', 'mailto:a@b.c'])(
    'url %s 거부',
    (v) => {
      expect(fieldsOf(createTaskSchema.safeParse({ ...base, url: v }))).toContain('url');
      expect(fieldsOf(updateTaskSchema.safeParse({ ...upd, url: v }))).toContain('url');
    },
  );
  it('url 제어 문자·길이 초과 거부', () => {
    for (const v of ['https://a.com/\u0000', 'https://a.com/x\ty', 'https://a.com/\u202e', 'https://a.com/\u200b']) {
      expect(fieldsOf(createTaskSchema.safeParse({ ...base, url: v }))).toContain('url');
    }
    const head = 'https://a.com/';
    expect(createTaskSchema.safeParse({ ...base, url: head + 'x'.repeat(TASK_URL_MAX - head.length) }).success).toBe(true);
    expect(fieldsOf(createTaskSchema.safeParse({ ...base, url: head + 'x'.repeat(TASK_URL_MAX - head.length + 1) }))).toContain('url');
  });
  it('memo 는 줄바꿈·탭·CRLF 허용, 앞뒤 공백 trim', () => {
    expect(createTaskSchema.parse({ ...base, memo: '  첫 줄\n\t둘째 줄\r\n셋째 🚀  ' }).memo).toBe('첫 줄\n\t둘째 줄\r\n셋째 🚀');
    expect(updateTaskSchema.parse({ ...upd, memo: 'a\nb' }).memo).toBe('a\nb');
  });
  it.each(['a\u0000b', 'a\u0007b', 'a\u000bb', 'a\u000cb', 'a\u001fb', 'a\u007fb', 'a\u0085b', 'a\u202eb', 'a\u2066b', 'a\u200bb', 'a\u2028b', 'a\ufeffb'].map((s) => [JSON.stringify(s), s]))(
    'memo %s 거부',
    (_, v) => {
      expect(fieldsOf(createTaskSchema.safeParse({ ...base, memo: v }))).toContain('memo');
      expect(fieldsOf(updateTaskSchema.safeParse({ ...upd, memo: v }))).toContain('memo');
    },
  );
  it('memo 길이: 5000자 허용, 5001자 거부(trim 뒤 기준)', () => {
    expect(createTaskSchema.safeParse({ ...base, memo: 'x'.repeat(TASK_MEMO_MAX) }).success).toBe(true);
    expect(createTaskSchema.safeParse({ ...base, memo: ` ${'x'.repeat(TASK_MEMO_MAX)} ` }).success).toBe(true);
    expect(fieldsOf(createTaskSchema.safeParse({ ...base, memo: 'x'.repeat(TASK_MEMO_MAX + 1) }))).toContain('memo');
  });
  it('isHttpUrl', () => {
    expect(isHttpUrl('https://a.com')).toBe(true);
    expect(isHttpUrl('http://a.com')).toBe(true);
    for (const v of ['', 'javascript:alert(1)', 'data:,x', 'a.com', '//a.com']) expect(isHttpUrl(v)).toBe(false);
  });
});

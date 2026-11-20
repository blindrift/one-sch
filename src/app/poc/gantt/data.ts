// PoC 데이터 생성과 서버에서 할 계산(요약 막대·순환 검사)의 시험 구현.

export type PocTask = {
  id: string;
  text: string;
  start: Date;
  end: Date;
  progress: number;
  type: 'summary' | 'task' | 'milestone';
  parent?: string;
  open?: boolean;
  color: string;
};

export type PocLink = { id: string; source: string; target: string; type: 'e2s' };

const COLORS = ['#2563eb', '#16a34a', '#d97706', '#9333ea', '#dc2626', '#0891b2'];
const DAY = 24 * 60 * 60 * 1000;

/** @db.Date 와 같은 "날짜만" 값: 로컬 자정 */
function day(base: Date, offset: number): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + offset);
}

/** 결정적 의사 난수(렌더마다 같은 데이터) */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

export function generate(totalTasks: number, today = new Date()): { tasks: PocTask[]; links: PocLink[] } {
  const projects = Math.max(1, Math.round(totalTasks / 60));
  const per = Math.max(1, Math.floor(totalTasks / projects));
  const rand = rng(42);
  const base = day(today, -30);
  const tasks: PocTask[] = [];
  const links: PocLink[] = [];

  for (let p = 0; p < projects; p++) {
    const pid = `p${p}`;
    const color = COLORS[p % COLORS.length];
    tasks.push({ id: pid, text: `프로젝트 ${p + 1}`, start: base, end: base, progress: 0, type: 'summary', open: p < 3, color });
    let cursor = Math.floor(rand() * 20);
    for (let i = 0; i < per; i++) {
      const len = 1 + Math.floor(rand() * 10);
      const milestone = i % 15 === 14;
      const start = day(base, cursor);
      // inclusiveEnd: 종료일 당일까지 포함하는 날짜만 값. 마일스톤은 시작=종료.
      const end = milestone ? start : day(base, cursor + len - 1);
      const id = `${pid}-t${i}`;
      tasks.push({
        id,
        text: milestone ? `마일스톤 ${i + 1}` : `작업 ${p + 1}-${i + 1}`,
        start,
        end,
        progress: Math.floor(rand() * 101),
        type: milestone ? 'milestone' : 'task',
        parent: pid,
        color,
      });
      if (i > 0 && i % 4 === 0) links.push({ id: `l-${id}`, source: `${pid}-t${i - 1}`, target: id, type: 'e2s' });
      cursor += Math.floor(len * 0.6);
    }
  }
  return { tasks: computeSummaries(tasks), links };
}

/** 요약 막대: 하위 최소 시작~최대 종료, 진행률은 기간 가중 평균(설계 6.1). SVAR PRO 기능을 서버 계산으로 대신한다. */
export function computeSummaries(tasks: PocTask[]): PocTask[] {
  const children = new Map<string, PocTask[]>();
  for (const t of tasks) if (t.parent) (children.get(t.parent) ?? children.set(t.parent, []).get(t.parent)!).push(t);
  return tasks.map((t) => {
    const kids = children.get(t.id);
    if (t.type !== 'summary' || !kids?.length) return t;
    let start = kids[0].start.getTime();
    let end = kids[0].end.getTime();
    let weighted = 0;
    let weight = 0;
    for (const k of kids) {
      start = Math.min(start, k.start.getTime());
      end = Math.max(end, k.end.getTime());
      const w = Math.round((k.end.getTime() - k.start.getTime()) / DAY) + 1;
      weighted += k.progress * w;
      weight += w;
    }
    return { ...t, start: new Date(start), end: new Date(end), progress: weight ? Math.round(weighted / weight) : 0 };
  });
}

/** source → target 링크를 더하면 순환이 생기는지(target 에서 source 로 가는 길이 이미 있는지) */
export function createsCycle(links: Array<{ source: string; target: string }>, source: string, target: string): boolean {
  if (source === target) return true;
  const next = new Map<string, string[]>();
  for (const l of links) (next.get(l.source) ?? next.set(l.source, []).get(l.source)!).push(l.target);
  const stack = [target];
  const seen = new Set<string>();
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === source) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    stack.push(...(next.get(cur) ?? []));
  }
  return false;
}

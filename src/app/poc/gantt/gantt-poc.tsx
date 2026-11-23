'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { Gantt, Willow, type IApi } from '@svar-ui/react-gantt';
import { Locale } from '@svar-ui/react-core';
import '@svar-ui/react-gantt/all.css';
import { computeSummaries, createsCycle, generate, type PocLink, type PocTask } from './data';
import { ko } from '@/components/gantt/ko';
import styles from './gantt-poc.module.css';

type Zoom = 'day' | 'week' | 'month';

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const SCALES: Record<Zoom, { cellWidth: number; scales: Array<{ unit: string; step: number; format: (d: Date) => string }> }> = {
  day: {
    cellWidth: 32,
    scales: [
      { unit: 'month', step: 1, format: (d) => `${d.getFullYear()}년 ${d.getMonth() + 1}월` },
      { unit: 'day', step: 1, format: (d) => String(d.getDate()) },
    ],
  },
  week: {
    cellWidth: 80,
    scales: [
      { unit: 'month', step: 1, format: (d) => `${d.getFullYear()}년 ${d.getMonth() + 1}월` },
      { unit: 'week', step: 1, format: (d) => `${d.getMonth() + 1}/${d.getDate()}~` },
    ],
  },
  month: {
    cellWidth: 120,
    scales: [
      { unit: 'year', step: 1, format: (d) => `${d.getFullYear()}년` },
      { unit: 'month', step: 1, format: (d) => `${d.getMonth() + 1}월` },
    ],
  },
};

function isToday(d: Date) {
  const t = new Date();
  return d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth() && d.getDate() === t.getDate();
}

/** 막대 안 내용: 프로젝트 색, 지연(종료일 경과 + 미완료)은 빨간 테두리 */
function TaskBar({ data }: { data: { text?: string; color?: string; end?: Date | null; progress?: number; type?: string } }) {
  const today = new Date(new Date().toDateString());
  const late = !!data.end && data.end.getTime() < today.getTime() && (data.progress ?? 0) < 100 && data.type !== 'summary';
  return (
    <div
      className={late ? styles.late : undefined}
      style={{ background: data.color, width: '100%', height: '100%', color: '#fff', paddingInline: 4, overflow: 'hidden' }}
      data-late={late ? 'true' : undefined}
    >
      {data.text}
    </div>
  );
}

export default function GanttPoc({ count }: { count: number }) {
  const t0 = useRef(performance.now());
  const [renderMs, setRenderMs] = useState<number | null>(null);
  const [zoom, setZoom] = useState<Zoom>('day');
  const [failSave, setFailSave] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const failRef = useRef(failSave);
  failRef.current = failSave;

  const initial = useMemo(() => generate(count), [count]);
  const linksRef = useRef<PocLink[]>(initial.links);
  const tasksRef = useRef<Map<string, PocTask>>(new Map(initial.tasks.map((t) => [t.id, t])));

  const push = useCallback((m: string) => setLog((l) => [`${new Date().toLocaleTimeString('ko-KR')} ${m}`, ...l].slice(0, 30)), []);

  const init = useCallback(
    (api: IApi) => {
      // PoC 자동 점검(Playwright)용. ADMIN·ENABLE_POC 화면에서만 쓰인다.
      (window as unknown as { __ganttApi?: IApi }).__ganttApi = api;
      requestAnimationFrame(() => requestAnimationFrame(() => setRenderMs(Math.round(performance.now() - t0.current))));

      // 1) 의존 추가: FS 만, 순환이면 거부
      api.intercept('add-link', (ev) => {
        const source = String(ev.link.source);
        const target = String(ev.link.target);
        const type = ev.link.type;
        if (type !== 'e2s') {
          push(`링크 거부: FS 만 허용(${type})`);
          return false;
        }
        if (createsCycle(linksRef.current, source, target)) {
          push(`링크 거부: 순환(${source}→${target})`);
          return false;
        }
        return true;
      });
      api.on('add-link', (ev) => {
        const link = { id: String(ev.id), source: String(ev.link.source), target: String(ev.link.target), type: 'e2s' as const };
        linksRef.current = [...linksRef.current, link];
        push(`링크 추가 ${link.source}→${link.target}`);
      });
      api.on('delete-link', (ev) => {
        linksRef.current = linksRef.current.filter((l) => l.id !== String(ev.id));
        push(`링크 삭제 ${ev.id}`);
      });

      // 2) 드래그 이동·리사이즈·진행률: 끝났을 때만 저장(실패하면 원위치)
      api.intercept('update-task', (ev) => {
        if (ev.inProgress || ev.eventSource === 'poc') return true;
        const cur = tasksRef.current.get(String(ev.id));
        if (cur?.type === 'summary') {
          push('요약 막대는 직접 편집 불가(서버 계산)');
          return false;
        }
        return true;
      });
      api.on('update-task', (ev) => {
        if (ev.inProgress || ev.eventSource === 'poc') return;
        const id = String(ev.id);
        const before = tasksRef.current.get(id);
        if (!before) return;
        const latest = api.getTask(id);
        const after: PocTask = {
          ...before,
          start: latest.start ?? before.start,
          end: latest.end ?? before.end,
          progress: Math.round(latest.progress ?? 0),
        };
        push(`저장 요청 ${id} ${ymd(after.start)}~${ymd(after.end)} ${after.progress}%`);
        setTimeout(() => {
          if (failRef.current) {
            api.exec('update-task', { id, task: { start: before.start, end: before.end, progress: before.progress }, eventSource: 'poc' });
            push(`저장 실패 → 원위치 ${id}`);
            return;
          }
          tasksRef.current.set(id, after);
          // 요약 막대 다시 계산(서버가 돌려준 값이라고 가정)
          if (after.parent) {
            const all = computeSummaries([...tasksRef.current.values()]);
            const parent = all.find((t) => t.id === after.parent)!;
            tasksRef.current.set(parent.id, parent);
            api.exec('update-task', {
              id: parent.id,
              task: { start: parent.start, end: parent.end, progress: parent.progress },
              eventSource: 'poc',
            });
          }
          push(`저장 완료 ${id}`);
        }, 150);
      });
    },
    [push],
  );

  const z = SCALES[zoom];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span>작업 {initial.tasks.length.toLocaleString()}건 · 링크 {initial.links.length}건</span>
        <span data-testid="render-ms">첫 표시 {renderMs === null ? '측정 중' : `${renderMs}ms`}</span>
        {(['day', 'week', 'month'] as const).map((k) => (
          <button
            key={k}
            type="button"
            className={`rounded border px-2 py-0.5 ${zoom === k ? 'bg-primary text-primary-foreground' : ''}`}
            onClick={() => setZoom(k)}
          >
            {k === 'day' ? '일' : k === 'week' ? '주' : '월'}
          </button>
        ))}
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={failSave} onChange={(e) => setFailSave(e.target.checked)} /> 저장 실패 흉내
        </label>
      </div>
      <div className={styles.frame}>
        <Locale words={ko}>
          {/* fonts=false: cdn.svar.dev 글꼴·아이콘 CSS 를 불러오지 않는다(CSP font-src/style-src 'self'). */}
          <Willow fonts={false}>
            <Gantt
              init={init}
              tasks={initial.tasks}
              links={initial.links}
              scales={z.scales}
              cellWidth={z.cellWidth}
              lengthUnit="day"
              durationUnit="day"
              inclusiveEnd
              taskTemplate={TaskBar}
              highlightTime={(date, unit) => (unit === 'day' && isToday(date) ? styles.today : '')}
            />
          </Willow>
        </Locale>
      </div>
      <ol className="max-h-48 overflow-auto rounded border p-2 font-mono text-xs" data-testid="poc-log">
        {log.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ol>
    </div>
  );
}

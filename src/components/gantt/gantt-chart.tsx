'use client';

// SVAR 간트를 그리는 부분만 둔다(브라우저 전용이라 timeline-view 가 dynamic(ssr:false) 로 불러온다).
// 이벤트 처리(저장·거부)는 onInit 으로 받은 api 에 timeline-view 가 붙인다.
import type { ComponentProps } from 'react';
import { useCallback, useEffect, useRef } from 'react';
import { Gantt, Willow, type IApi } from '@svar-ui/react-gantt';
import { Locale } from '@svar-ui/react-core';
import { ymdFromLocalDate } from '@/lib/dates';
import type { GanttLink, GanttRow } from './adapter';
import { COLUMNS } from './columns';
import { ko } from './ko';
import { SCALES, type Zoom } from './scales';
import { TaskBar } from './task-bar';
import './svar.css';
import './gantt.css';

type GanttProps = ComponentProps<typeof Gantt>;

export type GanttChartProps = {
  rows: GanttRow[];
  links: GanttLink[];
  zoom: Zoom;
  /** Asia/Seoul 기준 오늘(서버 계산) */
  today: string;
  readonly: boolean;
  onInit: (api: IApi) => void;
};

export default function GanttChart({ rows, links, zoom, today, readonly, onInit }: GanttChartProps) {
  const frame = useRef<HTMLDivElement>(null);
  const z = SCALES[zoom];
  const highlightTime = useCallback(
    (date: Date, unit: string) => (unit === 'day' && ymdFromLocalDate(date) === today ? 'og-today' : ''),
    [today],
  );

  // 첫 표시 시각(E2E 의 N-01 측정용): 마운트 뒤 두 번째 프레임. performance.now() 는 페이지 이동 시작 기준이다.
  useEffect(() => {
    let id = requestAnimationFrame(() => {
      id = requestAnimationFrame(() => {
        if (!frame.current) return;
        frame.current.dataset.readyMs = String(Math.round(performance.now()));
        frame.current.dataset.ready = 'true';
      });
    });
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div ref={frame} className="og-gantt h-full" data-testid="gantt">
      <Locale words={ko}>
        {/* fonts=false: cdn.svar.dev 글꼴·아이콘 CSS 를 불러오지 않는다(CSP). 글꼴 선언을 뺀 CSS 사본은 svar.css. */}
        <Willow fonts={false}>
          <Gantt
            init={onInit}
            tasks={rows as unknown as GanttProps['tasks']}
            links={links}
            columns={COLUMNS}
            gridWidth={560}
            scales={z.scales}
            cellWidth={z.cellWidth}
            lengthUnit="day"
            durationUnit="day"
            readonly={readonly}
            taskTemplate={TaskBar as unknown as GanttProps['taskTemplate']}
            highlightTime={highlightTime}
          />
        </Willow>
      </Locale>
    </div>
  );
}

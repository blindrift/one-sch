'use client';

// SVAR 간트를 그리는 부분만 둔다(브라우저 전용이라 timeline-view 가 dynamic(ssr:false) 로 불러온다).
// 이벤트 처리(저장·거부)는 onInit 으로 받은 api 에 timeline-view 가 붙인다.
import type { ComponentProps } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Gantt, Willow, type IApi } from '@svar-ui/react-gantt';
import { Locale } from '@svar-ui/react-core';
import type { GanttLink, GanttRow } from './adapter';
import { withCells } from './cells';
import { COLUMNS, GRID_WIDTH } from './columns';
import { dayRangeFromX } from './drag-create';
import { ko } from './ko';
import { dayHighlight, SCALES, type Zoom } from './scales';
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
  /** 차트의 빈 곳을 가로로 끌어 놓으면 부른다(rowId: 끌기를 시작한 행, 행 밖이면 null). 없으면 끌기 선택을 끈다. */
  onRangeSelect?: (sel: { rowId: string | null; startDate: string; endDate: string }) => void;
};

/** 끌기 중 강조 상자(간트 틀 기준 px) */
type SelectionBox = { left: number; top: number; width: number; height: number; label: string };

/** 끌기로 보는 최소 이동(px). 이보다 짧으면 단순 클릭으로 둔다 */
const DRAG_THRESHOLD = 4;

/** 행 높이·머리글 한 줄 높이(px). 막대 위치는 E2E 가 막대 상자로 계산하므로 행 높이에 묶여 있지 않다 */
const CELL_HEIGHT = 40;
const SCALE_HEIGHT = 28;

const GRID_COLUMNS = withCells(COLUMNS);

const NO_ROWS: GanttRow[] = [];
const NO_LINKS: GanttLink[] = [];

export default function GanttChart({ rows, links, zoom, today, readonly, onInit, onRangeSelect }: GanttChartProps) {
  const frame = useRef<HTMLDivElement>(null);
  const apiRef = useRef<IApi | null>(null);
  const init = useCallback(
    (api: IApi) => {
      apiRef.current = api;
      onInit(api);
    },
    [onInit],
  );
  const selectRef = useRef(onRangeSelect);
  useEffect(() => {
    selectRef.current = onRangeSelect;
  });
  const [box, setBox] = useState<SelectionBox | null>(null);
  const selectable = !readonly && !!onRangeSelect;

  // 진행률 칸은 한 번 눌러 바로 고친다. SVAR 표는 더블클릭에만 편집기를 열므로, 칸 클릭을 더블클릭으로 넘긴다.
  // (고칠 수 없는 행은 columns.ts 의 editor 가 null 이라 열리지 않는다)
  useEffect(() => {
    const root = frame.current;
    if (!root || readonly) return;
    const onClick = (e: MouseEvent) => {
      if (e.detail > 1) return; // 진짜 더블클릭의 두 번째 클릭은 그대로 둔다
      const cell = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-col-id=":progress"]') : null;
      if (!cell || !root.contains(cell) || cell.querySelector('input')) return;
      cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: e.clientX, clientY: e.clientY }));
    };
    root.addEventListener('click', onClick);
    return () => root.removeEventListener('click', onClick);
  }, [readonly]);

  // 빈 곳 끌기 → 날짜 범위. SVAR 는 빈 곳 mousedown 에 하는 일이 없다(막대·링크 점·삭제 단추는 건드리지 않는다).
  useEffect(() => {
    const root = frame.current;
    if (!root || !selectable) return;
    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const target = e.target instanceof Element ? e.target : null;
      const area = target?.closest<HTMLElement>('.wx-area');
      if (!target || !area || !root.contains(area)) return;
      if (target.closest('.wx-bar, .wx-link, .wx-delete-button, [data-id]')) return;
      const state = apiRef.current?.getState();
      const scales = state?._scales;
      const cellHeight = state?.cellHeight;
      if (!state || !scales || !cellHeight || !scales.lengthUnitWidth) return;
      const dayWidth = scales.lengthUnitWidth;
      const chart = area.closest<HTMLElement>('.wx-chart') ?? area;
      const x0 = e.clientX - area.getBoundingClientRect().left;
      const rowIndex = Math.floor((e.clientY - area.getBoundingClientRect().top) / cellHeight);
      const row = rowIndex >= 0 ? state._tasks[rowIndex] : undefined;
      const rowId = row ? String(row.id) : null;
      let moved = false;
      let x1 = x0;
      e.preventDefault(); // 글자 선택 막기

      const draw = () => {
        const r = dayRangeFromX(x0, x1, scales.start, dayWidth);
        const a = area.getBoundingClientRect();
        const c = chart.getBoundingClientRect();
        const f = root.getBoundingClientRect();
        // 차트 보이는 영역 밖(왼쪽 표 위)으로 넘치지 않게 자른다
        const left = Math.max(a.left + r.firstIndex * dayWidth, c.left);
        const right = Math.min(a.left + (r.lastIndex + 1) * dayWidth, c.right);
        const top = row ? a.top + rowIndex * cellHeight : Math.max(a.top + rowIndex * cellHeight, c.top);
        setBox({
          left: left - f.left,
          top: top - f.top,
          width: Math.max(0, right - left),
          height: cellHeight,
          label: r.startDate === r.endDate ? r.startDate : `${r.startDate} ~ ${r.endDate}`,
        });
      };
      const onMove = (ev: MouseEvent) => {
        x1 = ev.clientX - area.getBoundingClientRect().left;
        if (!moved && Math.abs(x1 - x0) < DRAG_THRESHOLD) return;
        moved = true;
        draw();
      };
      const finish = (ev: MouseEvent | null) => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        window.removeEventListener('keydown', onKey);
        setBox(null);
        if (!ev || !moved) return;
        x1 = ev.clientX - area.getBoundingClientRect().left;
        const r = dayRangeFromX(x0, x1, scales.start, dayWidth);
        selectRef.current?.({ rowId, startDate: r.startDate, endDate: r.endDate });
      };
      const onUp = (ev: MouseEvent) => finish(ev);
      const onKey = (ev: KeyboardEvent) => {
        if (ev.key === 'Escape') finish(null);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      window.addEventListener('keydown', onKey);
    };
    root.addEventListener('mousedown', onDown);
    return () => root.removeEventListener('mousedown', onDown);
  }, [selectable]);
  const z = SCALES[zoom];
  const highlightTime = useCallback(
    (date: Date, unit: string) => dayHighlight(date, unit, today),
    [today],
  );

  // SVAR 표(왼쪽 열)는 자기 높이를 재기 전 첫 렌더에서 모든 행을 그린다(3,000건이면 DOM 3만여 개, NAS 에서 1초 이상).
  // 그래서 빈 데이터로 먼저 띄워 크기를 재게 한 다음 프레임에 실제 행을 넘긴다(그 뒤로는 보이는 행만 그린다).
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    performance.mark('gantt-mounted');
    const id = requestAnimationFrame(() => setArmed(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // 첫 표시 시각(E2E 의 N-01 측정용): 실제 행을 넘긴 뒤 두 번째 프레임. performance.now() 는 페이지 이동 시작 기준이다.
  useEffect(() => {
    if (!armed) return;
    let id = requestAnimationFrame(() => {
      id = requestAnimationFrame(() => {
        if (!frame.current) return;
        frame.current.dataset.readyMs = String(Math.round(performance.now()));
        frame.current.dataset.ready = 'true';
      });
    });
    return () => cancelAnimationFrame(id);
  }, [armed]);

  // 클래스 이름은 통째로 쓴다: 템플릿 문자열에 붙이면 Tailwind 가 h-full 을 못 찾아 높이가 빠지고 행 가상화가 꺼진다
  return (
    <div ref={frame} className={selectable ? 'og-gantt h-full og-selectable' : 'og-gantt h-full'} data-testid="gantt">
      <Locale words={ko}>
        {/* fonts=false: cdn.svar.dev 글꼴·아이콘 CSS 를 불러오지 않는다(CSP). 글꼴 선언을 뺀 CSS 사본은 svar.css. */}
        <Willow fonts={false}>
          <Gantt
            init={init}
            tasks={(armed ? rows : NO_ROWS) as unknown as GanttProps['tasks']}
            links={armed ? links : NO_LINKS}
            columns={GRID_COLUMNS}
            gridWidth={GRID_WIDTH}
            cellHeight={CELL_HEIGHT}
            scaleHeight={SCALE_HEIGHT}
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
      {box ? (
        <div
          className="og-range"
          data-testid="gantt-range"
          style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
        >
          <span>{box.label}</span>
        </div>
      ) : null}
    </div>
  );
}

'use client';

import type { CSSProperties } from 'react';
import type { GanttRow } from './adapter';

/**
 * 관련 링크(🔗)·메모(📝)가 있으면 작은 표시. 자세한 내용은 막대에 마우스를 올리면 뜨는 정보 카드(hover-card)가 보여 준다.
 */
function Marks({ data }: { data: Partial<GanttRow> }) {
  if (!data.hasUrl && !data.memoPreview) return null;
  return (
    <span className="og-bar-marks" data-testid="bar-marks" data-has-url={data.hasUrl ? 'true' : undefined} data-has-memo={data.memoPreview ? 'true' : undefined}>
      {data.hasUrl ? '🔗' : ''}
      {data.memoPreview ? '📝' : ''}
    </span>
  );
}

/**
 * 막대 안 내용. 색은 막대 전체를 덮는 배경(진행률 채움 아래)으로, 글자는 그 위에 그린다.
 * 지연·읽기 전용은 클래스와 data 속성(E2E 용)으로 표시한다.
 */
/** 막대 안에 제목을 다 쓰는 데 필요한 대략의 너비(px): 한글·전각 12px, 그 밖 7px + 좌우 여백·표시 */
export function labelWidth(data: Pick<Partial<GanttRow>, 'text' | 'hasUrl' | 'memoPreview'>): number {
  let w = 22;
  for (const ch of data.text ?? '') w += ch.charCodeAt(0) > 0x2e80 ? 12 : 7;
  if (data.hasUrl) w += 14;
  if (data.memoPreview) w += 14;
  return w;
}

export function TaskBar({ data }: { data: Partial<GanttRow> & { $w?: number } }) {
  // 기간이 없는 프로젝트(작업·기간 모두 없음, D16): 막대를 숨긴다(gantt.css 의 .og-unscheduled).
  if (!data.startYmd) return <span className="og-unscheduled" data-bar-id={data.id} />;
  if (data.type === 'milestone') {
    return (
      <>
        <span className={`og-milestone${data.late ? ' og-late' : ''}`} style={{ '--bar': data.color } as CSSProperties} data-bar-id={data.id} data-late={data.late ? 'true' : undefined} />
        <span className="og-milestone-text">
          <Marks data={data} />
          {data.text}
        </span>
      </>
    );
  }
  // 막대 모양: 작업은 프로젝트 색, 하위가 있는 작업(요약)은 옅은 색 + 진행 채움, 프로젝트 행은 얇은 괄호형
  const shape = data.kind === 'project' ? 'og-bracket' : data.type === 'summary' ? 'og-soft' : 'og-solid';
  const cls = ['og-bar-bg', shape, data.late ? 'og-late' : '', data.readonly && data.kind === 'task' ? 'og-readonly' : ''].filter(Boolean).join(' ');
  const color = { '--bar': data.color } as CSSProperties;
  // 막대가 글자보다 좁으면(하루짜리 등) 제목을 막대 오른쪽 바깥에 쓴다
  const narrow = shape !== 'og-bracket' && (data.$w ?? Infinity) < labelWidth(data);
  return (
    <>
      <span className={narrow ? `${cls} og-narrow` : cls} style={color} data-bar-id={data.id} data-late={data.late ? 'true' : undefined}>
        {shape === 'og-soft' ? <span className="og-soft-fill" style={{ width: `${data.progress ?? 0}%` }} /> : null}
      </span>
      {shape === 'og-bracket' ? null : (
        <span className={narrow ? 'og-bar-text og-bar-text-out' : shape === 'og-soft' ? 'og-bar-text og-bar-text-soft' : 'og-bar-text'} style={color}>
          <Marks data={data} />
          {data.text}
        </span>
      )}
    </>
  );
}

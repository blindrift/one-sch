'use client';

import type { CSSProperties } from 'react';
import type { GanttRow } from './adapter';

/**
 * 관련 링크(🔗)·메모(📝)가 있으면 작은 표시. title 로 메모 앞부분을 보여 준다(React 텍스트로만 렌더).
 * 막대 글자는 pointer-events 가 꺼져 있어 이 표시만 켠다(마우스 다운은 막대로 올라가 드래그는 그대로 된다).
 */
function Marks({ data }: { data: Partial<GanttRow> }) {
  if (!data.hasUrl && !data.memoPreview) return null;
  const title = [data.hasUrl ? '관련 링크 있음' : '', data.memoPreview ? `메모: ${data.memoPreview}` : ''].filter(Boolean).join('\n');
  return (
    <span className="og-bar-marks" title={title} data-testid="bar-marks" data-has-url={data.hasUrl ? 'true' : undefined} data-has-memo={data.memoPreview ? 'true' : undefined}>
      {data.hasUrl ? '🔗' : ''}
      {data.memoPreview ? '📝' : ''}
    </span>
  );
}

/**
 * 막대 안 내용. 색은 막대 전체를 덮는 배경(진행률 채움 아래)으로, 글자는 그 위에 그린다.
 * 지연·읽기 전용은 클래스와 data 속성(E2E 용)으로 표시한다.
 */
export function TaskBar({ data }: { data: Partial<GanttRow> }) {
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
  return (
    <>
      <span className={cls} style={color} data-bar-id={data.id} data-late={data.late ? 'true' : undefined}>
        {shape === 'og-soft' ? <span className="og-soft-fill" style={{ width: `${data.progress ?? 0}%` }} /> : null}
      </span>
      {shape === 'og-bracket' ? null : (
        <span className={shape === 'og-soft' ? 'og-bar-text og-bar-text-soft' : 'og-bar-text'} style={color}>
          <Marks data={data} />
          {data.text}
        </span>
      )}
    </>
  );
}

'use client';

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
        <span className={`og-milestone${data.late ? ' og-late' : ''}`} style={{ background: data.color }} data-bar-id={data.id} data-late={data.late ? 'true' : undefined} />
        <span className="og-milestone-text">
          <Marks data={data} />
          {data.text}
        </span>
      </>
    );
  }
  const cls = ['og-bar-bg', data.late ? 'og-late' : '', data.readonly && data.kind === 'task' ? 'og-readonly' : ''].filter(Boolean).join(' ');
  return (
    <>
      <span className={cls} style={{ background: data.color }} data-bar-id={data.id} data-late={data.late ? 'true' : undefined} />
      <span className="og-bar-text">
        <Marks data={data} />
        {data.text}
      </span>
    </>
  );
}

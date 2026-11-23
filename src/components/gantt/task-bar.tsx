'use client';

import type { GanttRow } from './adapter';

/**
 * 막대 안 내용. 색은 막대 전체를 덮는 배경(진행률 채움 아래)으로, 글자는 그 위에 그린다.
 * 지연·읽기 전용은 클래스와 data 속성(E2E 용)으로 표시한다.
 */
export function TaskBar({ data }: { data: Partial<GanttRow> }) {
  if (data.type === 'milestone') return <span data-bar-id={data.id} data-late={data.late ? 'true' : undefined} />;
  const cls = ['og-bar-bg', data.late ? 'og-late' : '', data.readonly && data.kind === 'task' ? 'og-readonly' : ''].filter(Boolean).join(' ');
  return (
    <>
      <span className={cls} style={{ background: data.color }} data-bar-id={data.id} data-late={data.late ? 'true' : undefined} />
      <span className="og-bar-text">{data.text}</span>
    </>
  );
}

'use client';

import dynamic from 'next/dynamic';

// SVAR 는 브라우저 전용(window 사용)이라 서버 렌더를 끈다. ssr:false 는 클라이언트 컴포넌트 안에서만 쓸 수 있다.
const GanttPoc = dynamic(() => import('./gantt-poc'), { ssr: false, loading: () => <p>간트 불러오는 중…</p> });

export function GanttPocLoader({ count }: { count: number }) {
  return <GanttPoc count={count} />;
}

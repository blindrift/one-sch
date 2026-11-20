'use client';

import { useEffect } from 'react';

/** 클라이언트 하이드레이션이 끝나면 <html data-hydrated="true"> 를 붙인다(E2E 가 폼 조작 전에 기다리는 신호). */
export function HydrationMarker() {
  useEffect(() => {
    document.documentElement.dataset.hydrated = 'true';
  }, []);
  return null;
}

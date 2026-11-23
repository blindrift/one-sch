import type { IScaleConfig } from '@svar-ui/react-gantt';

export const ZOOMS = ['day', 'week', 'month'] as const;
export type Zoom = (typeof ZOOMS)[number];
export const ZOOM_LABELS: Record<Zoom, string> = { day: '일', week: '주', month: '월' };

export function isZoom(v: unknown): v is Zoom {
  return typeof v === 'string' && (ZOOMS as readonly string[]).includes(v);
}

const ym = (d: Date) => `${d.getFullYear()}년 ${d.getMonth() + 1}월`;

/** 줌별 머리글·칸 너비. 일 줌의 칸 너비는 E2E 드래그 계산에 쓰므로 바꾸면 테스트도 고친다. */
export const SCALES: Record<Zoom, { cellWidth: number; scales: IScaleConfig[] }> = {
  day: {
    cellWidth: 32,
    scales: [
      { unit: 'month', step: 1, format: ym },
      { unit: 'day', step: 1, format: (d: Date) => String(d.getDate()) },
    ],
  },
  week: {
    cellWidth: 80,
    scales: [
      { unit: 'month', step: 1, format: ym },
      { unit: 'week', step: 1, format: (d: Date) => `${d.getMonth() + 1}/${d.getDate()}~` },
    ],
  },
  month: {
    cellWidth: 120,
    scales: [
      { unit: 'year', step: 1, format: (d: Date) => `${d.getFullYear()}년` },
      { unit: 'month', step: 1, format: (d: Date) => `${d.getMonth() + 1}월` },
    ],
  },
};

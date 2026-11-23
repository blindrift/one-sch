// 클라이언트·서버 공용. Prisma enum 과 같은 값이어야 한다(server/services/schedule-types.ts 에서 타입으로 확인).
export const PROJECT_STATUSES = ['PLANNED', 'ACTIVE', 'ON_HOLD', 'DONE'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  PLANNED: '계획',
  ACTIVE: '진행',
  ON_HOLD: '보류',
  DONE: '완료',
};

export const TASK_STATUSES = ['TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  TODO: '할 일',
  IN_PROGRESS: '진행 중',
  BLOCKED: '막힘',
  DONE: '완료',
};

/** 계층 깊이 최대(D13) */
export const MAX_TASK_DEPTH = 5;

/** 상태 색(디자인 토큰 CSS 변수). 배지·막대 점 등에 쓴다. */
export const TASK_STATUS_COLORS: Record<TaskStatus, string> = {
  TODO: 'var(--status-todo)',
  IN_PROGRESS: 'var(--status-progress)',
  BLOCKED: 'var(--status-blocked)',
  DONE: 'var(--status-done)',
};

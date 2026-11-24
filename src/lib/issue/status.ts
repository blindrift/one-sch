// 이슈 유형·상태·우선순위(클라이언트·서버 공용). Prisma enum 과 같은 값이어야 한다(server/services/issue-dto.ts 에서 타입으로 확인).
export const ISSUE_TYPES = ['ISSUE', 'RISK', 'REQUEST'] as const;
export type IssueType = (typeof ISSUE_TYPES)[number];
export const ISSUE_TYPE_LABELS: Record<IssueType, string> = {
  ISSUE: '이슈',
  RISK: '위험',
  REQUEST: '요청',
};

export const ISSUE_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];
export const ISSUE_STATUS_LABELS: Record<IssueStatus, string> = {
  OPEN: '열림',
  IN_PROGRESS: '진행 중',
  RESOLVED: '해결',
  CLOSED: '닫힘',
};
/** 상태 색(디자인 토큰 CSS 변수) */
export const ISSUE_STATUS_COLORS: Record<IssueStatus, string> = {
  OPEN: 'var(--status-progress)',
  IN_PROGRESS: 'var(--chart-4)',
  RESOLVED: 'var(--status-done)',
  CLOSED: 'var(--status-todo)',
};

export const ISSUE_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
export type IssuePriority = (typeof ISSUE_PRIORITIES)[number];
export const ISSUE_PRIORITY_LABELS: Record<IssuePriority, string> = {
  LOW: '낮음',
  MEDIUM: '보통',
  HIGH: '높음',
  URGENT: '긴급',
};
export const ISSUE_PRIORITY_COLORS: Record<IssuePriority, string> = {
  LOW: 'var(--status-todo)',
  MEDIUM: 'var(--status-progress)',
  HIGH: 'var(--chart-4)',
  URGENT: 'var(--status-blocked)',
};

/** 화면 표기 `KEY-번호`(예: ERP-12) */
export function issueKey(projectKey: string, number: number): string {
  return `${projectKey}-${number}`;
}

/** `KEY-번호` 형식이면 나눠 준다(키 규칙은 PROJECT_KEY_RE 와 같음, 번호는 1 이상 정수). 아니면 null */
export function parseIssueKey(value: string): { projectKey: string; number: number } | null {
  const m = /^([A-Z][A-Z0-9]{1,9})-([1-9][0-9]{0,8})$/.exec(value.trim().toUpperCase());
  return m ? { projectKey: m[1], number: Number(m[2]) } : null;
}

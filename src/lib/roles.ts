// 클라이언트·서버 공용. Prisma enum Role 과 같은 값이어야 한다(server/auth/require-role.ts 에서 타입으로 확인).
export const ROLES = ['VIEWER', 'MEMBER', 'ADMIN'] as const;
export type Role = (typeof ROLES)[number];

const RANK: Record<Role, number> = { VIEWER: 0, MEMBER: 1, ADMIN: 2 };

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: '관리자',
  MEMBER: '멤버',
  VIEWER: '조회자',
};

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

export function hasRole(userRole: Role, minRole: Role): boolean {
  return RANK[userRole] >= RANK[minRole];
}

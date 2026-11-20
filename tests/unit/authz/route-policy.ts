import type { Role } from '@/lib/roles';

/** 정책 키: 저장소 기준 route 파일 경로 + '#' + HTTP 메서드. 예: `src/app/api/projects/route.ts#GET` */
export function routeKey(routeRelPath: string, method: string): string {
  return `${routeRelPath}#${method}`;
}

/**
 * 가드가 붙는 route handler 의 메서드별 최소 역할. withApi 첫 인자와 같아야 하고, 표의 항목은 모두 실제 export 여야 한다.
 * (공개 route 인 [...nextauth]·health 는 대상이 아니다.) 현재 대상 route 는 없다.
 */
export const ROUTE_POLICY: Record<string, Role> = {};

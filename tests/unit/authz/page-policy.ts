import type { Role } from '@/lib/roles';

export type PagePolicy = { min: Role; allowPasswordChange?: true };

/**
 * 가드가 붙는 page 의 최소 역할(저장소 기준 파일 경로). requirePage 인자(역할 리터럴·옵션)와 같아야 하고,
 * 표의 항목은 모두 실제 page 여야 한다(이름만 남은 항목 금지). 공개 page(로그인·루트)는 대상이 아니다.
 */
export const PAGE_POLICY: Record<string, PagePolicy> = {
  'src/app/(auth)/change-password/page.tsx': { min: 'VIEWER', allowPasswordChange: true },
  'src/app/(main)/timeline/page.tsx': { min: 'VIEWER' },
  'src/app/(main)/projects/page.tsx': { min: 'VIEWER' },
  'src/app/admin/users/page.tsx': { min: 'ADMIN' },
  'src/app/poc/gantt/page.tsx': { min: 'ADMIN' },
};

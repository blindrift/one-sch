import type { Role } from '@/lib/roles';

export type Policy = { min: Role; allowPasswordChange?: boolean } | { min: 'PUBLIC' };

/** 정책 키: `src/server/actions/` 기준 상대 경로(확장자 제외) + '.' + export 이름. 예: `auth.logout`, `admin/user.x` */
export function actionKey(relPathFromActions: string, exportName: string): string {
  return `${relPathFromActions.replace(/\.(ts|tsx)$/, '')}.${exportName}`;
}

/** src/server/actions/** 의 모든 export 와 1:1 로 맞아야 한다(새 액션을 추가하면 여기에도 적는다). */
export const ACTION_POLICY: Record<string, Policy> = {
  'auth.loginWithPassword': { min: 'PUBLIC' },
  'auth.logout': { min: 'PUBLIC' },
  'auth.signInWithGoogle': { min: 'PUBLIC' },
  'auth.changePassword': { min: 'VIEWER', allowPasswordChange: true },

  'user.createUser': { min: 'ADMIN' },
  'user.updateUserRole': { min: 'ADMIN' },
  'user.setUserActive': { min: 'ADMIN' },
  'user.revokeUserSessions': { min: 'ADMIN' },
  'user.unlockUser': { min: 'ADMIN' },
  'user.resetUserPassword': { min: 'ADMIN' },
  'user.approveUser': { min: 'ADMIN' },
  'user.rejectUser': { min: 'ADMIN' },
  'user.deleteUnapprovedUser': { min: 'ADMIN' },

  'project.createProject': { min: 'MEMBER' },
  'project.updateProject': { min: 'MEMBER' },
  'project.setProjectArchived': { min: 'MEMBER' },

  'task.createTask': { min: 'MEMBER' },
  'task.updateTask': { min: 'MEMBER' },
  'task.deleteTask': { min: 'MEMBER' },

  'dependency.addDependency': { min: 'MEMBER' },
  'dependency.removeDependency': { min: 'MEMBER' },
};

export const PUBLIC_ACTIONS = Object.entries(ACTION_POLICY)
  .filter(([, p]) => p.min === 'PUBLIC')
  .map(([k]) => k);

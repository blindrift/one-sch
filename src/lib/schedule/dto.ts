// 서버 → 화면으로 내려보내는 일정 데이터(클라이언트·서버 공용 타입). 날짜는 모두 `YYYY-MM-DD`(포함 종료일).
import type { ProjectStatus, TaskStatus } from './status';

export type ProjectDto = {
  id: string;
  key: string;
  name: string;
  color: string;
  status: ProjectStatus;
  startDate: string | null;
  endDate: string | null;
  ownerId: string;
  archived: boolean;
  version: number;
};

export type TaskDto = {
  id: string;
  projectId: string;
  parentId: string | null;
  title: string;
  startDate: string;
  endDate: string;
  progress: number;
  status: TaskStatus;
  assigneeId: string | null;
  isMilestone: boolean;
  sortOrder: number;
  version: number;
  /** 관련 링크(http/https). 없으면 null */
  url: string | null;
  /** 여러 줄 평문 메모. 없으면 null */
  memo: string | null;
  /** 하위 작업이 있는지(요약 행, D4) */
  hasChildren: boolean;
};

export type DependencyDto = { id: string; fromTaskId: string; toTaskId: string };

/** 담당자·책임자 후보(D8): 이메일은 내려보내지 않는다. */
export type UserOption = { id: string; name: string };

export type TimelineData = {
  projects: ProjectDto[];
  tasks: TaskDto[];
  dependencies: DependencyDto[];
  users: UserOption[];
  /** Asia/Seoul 기준 오늘 */
  today: string;
};

/** 작업 쓰기 결과: 갱신된 작업과 재계산된 조상(가까운 순) */
export type TaskWriteResult = { task: TaskDto; ancestors: TaskDto[] };
export type TaskDeleteResult = { deletedIds: string[]; ancestors: TaskDto[] };

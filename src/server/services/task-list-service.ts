import 'server-only';
import type { TaskListQuery } from '@/lib/list-query';
import type { TimelineData } from '@/lib/schedule/dto';
import { buildTaskList, type TaskListPage } from '@/lib/task-list';
import { loadTimeline } from './timeline-service';

export type TaskListData = TaskListPage & { data: TimelineData };

/**
 * 프로젝트 목록 탭: 그 프로젝트의 간트 데이터(작업 대화상자의 상위 후보·의존 검사용)와 표 한 페이지.
 * 프로젝트 하나의 작업은 수백 건 규모라 모두 읽어 메모리에서 거르고 정렬한다(간트와 같은 순서·같은 지연 판정).
 */
export async function listTasks(projectId: string, query: TaskListQuery): Promise<TaskListData> {
  const data = await loadTimeline({ projectId });
  return { ...buildTaskList(data.tasks, data.users, data.today, query), data };
}

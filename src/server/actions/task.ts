'use server';

import { createTaskSchema, deleteTaskSchema, reorderTaskSchema, updateTaskSchema } from '@/lib/validation/task';
import { toActionResult, type ActionResult } from '../action-result';
import { requireRole } from '../auth/require-role';
import { getRequestMeta } from '../request-meta';
import * as tasks from '../services/task-service';

// revalidatePath 를 부르지 않는다: 일정 화면은 동적 렌더라 서버 캐시가 없고, 부르면 액션 응답마다 수천 건 타임라인을
// 다시 읽어 내려보낸다. 화면은 액션 결과(갱신된 작업·조상)로 간트를 고치고, 필요할 때만 router.refresh() 한다.

export async function createTask(input: unknown): Promise<ActionResult<tasks.TaskWriteResult>> {
  return toActionResult(async () => {
    const actor = await requireRole('MEMBER');
    const data = createTaskSchema.parse(input);
    return tasks.createTask(actor, data, await getRequestMeta());
  });
}

export async function updateTask(input: unknown): Promise<ActionResult<tasks.TaskWriteResult>> {
  return toActionResult(async () => {
    const actor = await requireRole('MEMBER');
    const data = updateTaskSchema.parse(input);
    return tasks.updateTask(actor, data, await getRequestMeta());
  });
}

export async function deleteTask(input: unknown): Promise<ActionResult<tasks.TaskDeleteResult>> {
  return toActionResult(async () => {
    const actor = await requireRole('MEMBER');
    const data = deleteTaskSchema.parse(input);
    return tasks.deleteTask(actor, data, await getRequestMeta());
  });
}

/** 목록 탭의 형제 순서 바꾸기(D17) */
export async function reorderTask(input: unknown): Promise<ActionResult<tasks.TaskReorderResult>> {
  return toActionResult(async () => {
    const actor = await requireRole('MEMBER');
    const data = reorderTaskSchema.parse(input);
    return tasks.reorderTask(actor, data, await getRequestMeta());
  });
}

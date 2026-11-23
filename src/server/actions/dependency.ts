'use server';

import { addDependencySchema, removeDependencySchema } from '@/lib/validation/task';
import { toActionResult, type ActionResult } from '../action-result';
import { requireRole } from '../auth/require-role';
import { getRequestMeta } from '../request-meta';
import * as dependencies from '../services/dependency-service';
import type { DependencyDto } from '../services/schedule-dto';

// revalidatePath 를 부르지 않는 이유는 actions/task.ts 참고.

export async function addDependency(input: unknown): Promise<ActionResult<DependencyDto>> {
  return toActionResult(async () => {
    const actor = await requireRole('MEMBER');
    const data = addDependencySchema.parse(input);
    return dependencies.addDependency(actor, data, await getRequestMeta());
  });
}

export async function removeDependency(input: unknown): Promise<ActionResult<{ id: string }>> {
  return toActionResult(async () => {
    const actor = await requireRole('MEMBER');
    const { id } = removeDependencySchema.parse(input);
    return dependencies.removeDependency(actor, id, await getRequestMeta());
  });
}

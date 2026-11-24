'use server';

import type { IssueDeleteResult, IssueDto } from '@/lib/issue/dto';
import { createIssueSchema, deleteIssueSchema, updateIssueSchema } from '@/lib/validation/issue';
import { toActionResult, type ActionResult } from '../action-result';
import { requireRole } from '../auth/require-role';
import { getRequestMeta } from '../request-meta';
import * as issues from '../services/issue-service';

// revalidatePath 를 부르지 않는다(actions/task.ts 참고). 화면은 결과를 받은 뒤 router.refresh() 로 다시 읽는다.

export async function createIssue(input: unknown): Promise<ActionResult<IssueDto>> {
  return toActionResult(async () => {
    const actor = await requireRole('MEMBER');
    const data = createIssueSchema.parse(input);
    return issues.createIssue(actor, data, await getRequestMeta());
  });
}

export async function updateIssue(input: unknown): Promise<ActionResult<IssueDto>> {
  return toActionResult(async () => {
    const actor = await requireRole('MEMBER');
    const data = updateIssueSchema.parse(input);
    return issues.updateIssue(actor, data, await getRequestMeta());
  });
}

export async function deleteIssue(input: unknown): Promise<ActionResult<IssueDeleteResult>> {
  return toActionResult(async () => {
    const actor = await requireRole('MEMBER');
    const data = deleteIssueSchema.parse(input);
    return issues.deleteIssue(actor, data, await getRequestMeta());
  });
}

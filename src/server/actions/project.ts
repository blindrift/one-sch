'use server';

import { revalidatePath } from 'next/cache';
import { createProjectSchema, setProjectArchivedSchema, updateProjectSchema } from '@/lib/validation/project';
import { toActionResult, type ActionResult } from '../action-result';
import { requireRole } from '../auth/require-role';
import { getRequestMeta } from '../request-meta';
import * as projects from '../services/project-service';
import type { ProjectDto } from '../services/schedule-dto';

const PATH = '/projects';

export async function createProject(input: unknown): Promise<ActionResult<ProjectDto>> {
  return toActionResult(async () => {
    const actor = await requireRole('MEMBER');
    const data = createProjectSchema.parse(input);
    const result = await projects.createProject(actor, data, await getRequestMeta());
    revalidatePath(PATH);
    return result;
  });
}

export async function updateProject(input: unknown): Promise<ActionResult<ProjectDto>> {
  return toActionResult(async () => {
    const actor = await requireRole('MEMBER');
    const data = updateProjectSchema.parse(input);
    const result = await projects.updateProject(actor, data, await getRequestMeta());
    revalidatePath(PATH);
    return result;
  });
}

export async function setProjectArchived(input: unknown): Promise<ActionResult<ProjectDto>> {
  return toActionResult(async () => {
    const actor = await requireRole('MEMBER');
    const data = setProjectArchivedSchema.parse(input);
    const result = await projects.setProjectArchived(actor, data, await getRequestMeta());
    revalidatePath(PATH);
    return result;
  });
}

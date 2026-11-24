'use server';

import { revalidatePath } from 'next/cache';
import {
  approveUserSchema,
  createUserSchema,
  setUserActiveSchema,
  updateUserRoleSchema,
  userTargetSchema,
} from '@/lib/validation/user';
import { toActionResult, type ActionResult } from '../action-result';
import { requireRole } from '../auth/require-role';
import { getRequestMeta } from '../request-meta';
import * as users from '../services/user-service';

const PATH = '/admin/users';

export async function createUser(input: unknown): Promise<ActionResult<{ id: string }>> {
  return toActionResult(async () => {
    const actor = await requireRole('ADMIN');
    const data = createUserSchema.parse(input);
    const result = await users.createUser(actor, data, await getRequestMeta());
    revalidatePath(PATH);
    return result;
  });
}

export async function updateUserRole(input: unknown): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const actor = await requireRole('ADMIN');
    const { userId, role } = updateUserRoleSchema.parse(input);
    await users.updateUserRole(actor, userId, role, await getRequestMeta());
    revalidatePath(PATH);
    return null;
  });
}

export async function setUserActive(input: unknown): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const actor = await requireRole('ADMIN');
    const { userId, active } = setUserActiveSchema.parse(input);
    await users.setUserActive(actor, userId, active, await getRequestMeta());
    revalidatePath(PATH);
    return null;
  });
}

export async function revokeUserSessions(input: unknown): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const actor = await requireRole('ADMIN');
    const { userId } = userTargetSchema.parse(input);
    await users.revokeUserSessions(actor, userId, await getRequestMeta());
    revalidatePath(PATH);
    return null;
  });
}

export async function unlockUser(input: unknown): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const actor = await requireRole('ADMIN');
    const { userId } = userTargetSchema.parse(input);
    await users.unlockUser(actor, userId, await getRequestMeta());
    revalidatePath(PATH);
    return null;
  });
}

export async function resetUserPassword(input: unknown): Promise<ActionResult<{ temporaryPassword: string }>> {
  return toActionResult(async () => {
    const actor = await requireRole('ADMIN');
    const { userId } = userTargetSchema.parse(input);
    const result = await users.resetUserPassword(actor, userId, await getRequestMeta());
    revalidatePath(PATH);
    return result;
  });
}

export async function approveUser(input: unknown): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const actor = await requireRole('ADMIN');
    const { userId, role } = approveUserSchema.parse(input);
    await users.approveUser(actor, userId, role, await getRequestMeta());
    revalidatePath(PATH);
    return null;
  });
}

export async function rejectUser(input: unknown): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const actor = await requireRole('ADMIN');
    const { userId } = userTargetSchema.parse(input);
    await users.rejectUser(actor, userId, await getRequestMeta());
    revalidatePath(PATH);
    return null;
  });
}

export async function deleteUnapprovedUser(input: unknown): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const actor = await requireRole('ADMIN');
    const { userId } = userTargetSchema.parse(input);
    await users.deleteUnapprovedUser(actor, userId, await getRequestMeta());
    revalidatePath(PATH);
    return null;
  });
}

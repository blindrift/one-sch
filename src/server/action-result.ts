import 'server-only';
import { unstable_rethrow } from 'next/navigation';
import { ZodError } from 'zod';
import { log } from './log';

export type ErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'INTERNAL';

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; code: ErrorCode; message: string; fieldErrors?: Record<string, string[]> };

const MESSAGES: Record<ErrorCode, string> = {
  UNAUTHENTICATED: '로그인이 필요합니다.',
  FORBIDDEN: '권한이 없습니다.',
  VALIDATION: '입력값을 확인해 주세요.',
  NOT_FOUND: '대상을 찾을 수 없습니다.',
  CONFLICT: '다른 사용자가 먼저 변경했습니다. 새로고침 후 다시 시도해 주세요.',
  RATE_LIMITED: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
  INTERNAL: '처리 중 오류가 발생했습니다.',
};

export class AppError extends Error {
  readonly code: ErrorCode;
  /** 내부 사유(로그·분기용). 사용자에게는 message 만 보인다. */
  readonly reason?: string;
  readonly fieldErrors?: Record<string, string[]>;

  constructor(code: ErrorCode, reason?: string, message?: string, fieldErrors?: Record<string, string[]>) {
    super(message ?? MESSAGES[code]);
    this.name = 'AppError';
    this.code = code;
    this.reason = reason;
    this.fieldErrors = fieldErrors;
  }
}

export function fail(code: ErrorCode, message?: string): ActionResult<never> {
  return { ok: false, code, message: message ?? MESSAGES[code] };
}

/**
 * Server Action 본문을 감싸 ActionResult 로 바꾼다.
 * redirect()/notFound()/forbidden() 같은 Next 내부 예외는 그대로 다시 던진다.
 */
export async function toActionResult<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    unstable_rethrow(err);
    if (err instanceof AppError) {
      return err.fieldErrors
        ? { ok: false, code: err.code, message: err.message, fieldErrors: err.fieldErrors }
        : { ok: false, code: err.code, message: err.message };
    }
    if (err instanceof ZodError) {
      const fieldErrors: Record<string, string[]> = {};
      for (const issue of err.issues) {
        const key = issue.path.join('.') || '_';
        (fieldErrors[key] ??= []).push(issue.message);
      }
      return { ok: false, code: 'VALIDATION', message: MESSAGES.VALIDATION, fieldErrors };
    }
    log.error('action.internal_error', { err });
    return fail('INTERNAL');
  }
}

import { notFound, redirect } from 'next/navigation';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AppError, toActionResult } from '@/server/action-result';
import { conflict } from '@/server/services/schedule-dto';

describe('toActionResult', () => {
  it('성공 값을 감싼다', async () => {
    await expect(toActionResult(async () => 1)).resolves.toEqual({ ok: true, data: 1 });
  });

  it('AppError 를 코드로 바꾼다', async () => {
    await expect(
      toActionResult(async () => {
        throw new AppError('FORBIDDEN', 'x');
      }),
    ).resolves.toEqual({ ok: false, code: 'FORBIDDEN', message: '권한이 없습니다.' });
  });

  it('CONFLICT 는 reason 을 함께 싣는다(T-4: 클라이언트가 문구 대신 reason 으로 분기)', async () => {
    await expect(
      toActionResult(async () => {
        throw new AppError('CONFLICT', 'archived', '보관된 프로젝트는 바꿀 수 없습니다.');
      }),
    ).resolves.toEqual({ ok: false, code: 'CONFLICT', message: '보관된 프로젝트는 바꿀 수 없습니다.', reason: 'archived' });
    await expect(
      toActionResult(async () => {
        throw new AppError('CONFLICT', 'email_taken', '이미 등록된 이메일입니다.', { email: ['이미 등록된 이메일입니다.'] });
      }),
    ).resolves.toEqual({
      ok: false,
      code: 'CONFLICT',
      message: '이미 등록된 이메일입니다.',
      reason: 'email_taken',
      fieldErrors: { email: ['이미 등록된 이메일입니다.'] },
    });
    // 일정 서비스의 conflict('archived') 가 그대로 클라이언트까지(timeline-view 가 reason === 'archived' 로 분기)
    const archived = await toActionResult(async () => {
      throw conflict('archived');
    });
    expect(archived).toMatchObject({ ok: false, code: 'CONFLICT', reason: 'archived' });
    // 사유 없는 CONFLICT 는 reason 키도 없다
    await expect(
      toActionResult(async () => {
        throw new AppError('CONFLICT');
      }),
    ).resolves.toEqual({ ok: false, code: 'CONFLICT', message: '다른 사용자가 먼저 변경했습니다. 새로고침 후 다시 시도해 주세요.' });
  });

  it('CONFLICT 밖의 사유(로그인 실패 사유 등)는 싣지 않는다', async () => {
    for (const [code, reason] of [
      ['UNAUTHENTICATED', 'locked'],
      ['FORBIDDEN', 'LOCAL_LOGIN_DISABLED'],
      ['VALIDATION', 'invalid_current'],
    ] as const) {
      const r = await toActionResult(async () => {
        throw new AppError(code, reason, 'm');
      });
      expect(r).toEqual({ ok: false, code, message: 'm' });
      expect(r).not.toHaveProperty('reason');
    }
  });

  it('ZodError 는 VALIDATION 과 필드 오류', async () => {
    const r = await toActionResult(async () => z.object({ name: z.string().min(1) }).parse({ name: '' }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('VALIDATION');
      expect(r.fieldErrors?.name?.length).toBe(1);
    }
  });

  it('redirect·notFound 는 다시 던진다', async () => {
    await expect(toActionResult(async () => redirect('/login'))).rejects.toMatchObject({
      digest: expect.stringMatching(/^NEXT_REDIRECT;replace;\/login;307;/),
    });
    await expect(toActionResult(async () => notFound())).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
  });

  it('알 수 없는 오류는 INTERNAL 이고 상세를 노출하지 않는다', async () => {
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const r = await toActionResult(async () => {
      throw new Error('db password=abc leaked');
    });
    spy.mockRestore();
    expect(r).toEqual({ ok: false, code: 'INTERNAL', message: '처리 중 오류가 발생했습니다.' });
  });
});

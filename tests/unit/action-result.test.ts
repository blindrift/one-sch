import { notFound, redirect } from 'next/navigation';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AppError, toActionResult } from '@/server/action-result';

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

  it('ZodError 는 VALIDATION 과 필드 오류', async () => {
    const r = await toActionResult(async () => z.object({ name: z.string().min(1) }).parse({ name: '' }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('VALIDATION');
      expect(r.fieldErrors?.name?.length).toBe(1);
    }
  });

  it('redirect·notFound 는 다시 던진다', async () => {
    await expect(toActionResult(async () => redirect('/login'))).rejects.toThrow();
    await expect(toActionResult(async () => notFound())).rejects.toThrow();
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

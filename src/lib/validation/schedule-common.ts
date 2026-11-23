import { z } from 'zod';
import { isValidYmd } from '../dates';

export const id = (message = '잘못된 대상입니다.') => z.uuid(message);
export const version = z.number().int().min(0);

export const ymd = z.string().refine(isValidYmd, '날짜는 YYYY-MM-DD 형식의 2000–2100년 날짜여야 합니다.');
/** 빈 문자열은 null 로(폼에서 지운 날짜) */
export const nullableYmd = z.preprocess((v) => (v === '' ? null : v), ymd.nullable());
export const nullableId = (message?: string) => z.preprocess((v) => (v === '' ? null : v), id(message).nullable());

type Ctx = z.RefinementCtx;

/** 두 날짜가 모두 있으면 종료 ≥ 시작 */
export function checkDateOrder(ctx: Ctx, start: string | null | undefined, end: string | null | undefined) {
  if (start && end && end < start) {
    ctx.addIssue({ code: 'custom', path: ['endDate'], message: '종료일은 시작일보다 빠를 수 없습니다.' });
  }
}

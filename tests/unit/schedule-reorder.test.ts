import { describe, expect, it } from 'vitest';
import { reorderIds, sortOrdersFor } from '@/lib/schedule/reorder';
import { reorderTaskSchema } from '@/lib/validation/task';

const ids = ['a', 'b', 'c', 'd'];

describe('reorderIds', () => {
  it('앞으로·뒤로 옮긴다', () => {
    expect(reorderIds(ids, 'd', { beforeId: 'a' })).toEqual(['d', 'a', 'b', 'c']);
    expect(reorderIds(ids, 'a', { afterId: 'd' })).toEqual(['b', 'c', 'd', 'a']);
    expect(reorderIds(ids, 'a', { afterId: 'b' })).toEqual(['b', 'a', 'c', 'd']);
    expect(reorderIds(ids, 'c', { beforeId: 'b' })).toEqual(['a', 'c', 'b', 'd']);
  });

  it('제자리(바로 뒤의 앞, 바로 앞의 뒤)는 순서 그대로', () => {
    expect(reorderIds(ids, 'b', { beforeId: 'c' })).toEqual(ids);
    expect(reorderIds(ids, 'b', { afterId: 'a' })).toEqual(ids);
  });

  it('없는 id·자기 자신 기준은 null', () => {
    expect(reorderIds(ids, 'x', { beforeId: 'a' })).toBeNull();
    expect(reorderIds(ids, 'a', { beforeId: 'x' })).toBeNull();
    expect(reorderIds(ids, 'a', { afterId: 'a' })).toBeNull();
  });
});

describe('sortOrdersFor', () => {
  it('형제가 쓰던 값을 정렬해 다시 쓴다(겹치면 가장 작은 값부터 1씩)', () => {
    expect(sortOrdersFor([7, 2, 30])).toEqual([2, 7, 30]);
    expect(sortOrdersFor([5, 5, 9])).toEqual([5, 6, 7]);
    expect(sortOrdersFor([])).toEqual([]);
  });
});

describe('reorderTaskSchema', () => {
  const ID = '3f1c2b9e-8d4a-4c3b-9a2e-1f0e5d6c7b8a';
  const ID2 = '4f1c2b9e-8d4a-4c3b-9a2e-1f0e5d6c7b8a';
  it('beforeId·afterId 중 정확히 하나, 자기 자신 금지', () => {
    expect(reorderTaskSchema.safeParse({ id: ID, version: 0, beforeId: ID2 }).success).toBe(true);
    expect(reorderTaskSchema.safeParse({ id: ID, version: 0, afterId: ID2 }).success).toBe(true);
    expect(reorderTaskSchema.safeParse({ id: ID, version: 0 }).success).toBe(false);
    expect(reorderTaskSchema.safeParse({ id: ID, version: 0, beforeId: ID2, afterId: ID2 }).success).toBe(false);
    expect(reorderTaskSchema.safeParse({ id: ID, version: 0, beforeId: ID }).success).toBe(false);
    expect(reorderTaskSchema.safeParse({ id: ID, version: 0, beforeId: 'x' }).success).toBe(false);
  });
});

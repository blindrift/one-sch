import { describe, expect, it } from 'vitest';
import { reorderIds, siblingAnchor, sortOrdersFor } from '@/lib/schedule/reorder';
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

describe('siblingAnchor', () => {
  // a ─ a1 ─ a1x, b, c ─ c1
  const parentOf = new Map<string, string | null>([
    ['a', null],
    ['a1', 'a'],
    ['a1x', 'a1'],
    ['b', null],
    ['c', null],
    ['c1', 'c'],
  ]);
  it('형제면 그대로, 형제의 후손이면 그 형제', () => {
    expect(siblingAnchor(parentOf, 'b', 'c')).toBe('c');
    expect(siblingAnchor(parentOf, 'b', 'a1x')).toBe('a');
    expect(siblingAnchor(parentOf, 'c', 'a1')).toBe('a');
  });
  it('자기 후손·다른 상위 아래·없는 id 는 null', () => {
    expect(siblingAnchor(parentOf, 'a', 'a1x')).toBeNull();
    expect(siblingAnchor(parentOf, 'a1', 'b')).toBeNull();
    expect(siblingAnchor(parentOf, 'c1', 'a1')).toBeNull();
    expect(siblingAnchor(parentOf, 'zz', 'a')).toBeNull();
  });
});

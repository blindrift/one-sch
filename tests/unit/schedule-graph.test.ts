import { describe, expect, it } from 'vitest';
import { ancestorsOf, createsCycle, depthOf, isAncestor, subtreeHeight, type Edge } from '@/lib/schedule/graph';

describe('createsCycle', () => {
  const edges: Edge[] = [
    { from: 'a', to: 'b' },
    { from: 'b', to: 'c' },
    { from: 'x', to: 'y' },
  ];
  it('자기 자신', () => expect(createsCycle(edges, 'a', 'a')).toBe(true));
  it('직접 역방향', () => expect(createsCycle(edges, 'b', 'a')).toBe(true));
  it('간접 역방향', () => expect(createsCycle(edges, 'c', 'a')).toBe(true));
  it('순환 없음', () => {
    expect(createsCycle(edges, 'a', 'c')).toBe(false);
    expect(createsCycle(edges, 'c', 'x')).toBe(false);
  });
  it('프로젝트 사이(다른 컴포넌트를 잇는) 순환', () => {
    const e = [...edges, { from: 'c', to: 'x' }];
    expect(createsCycle(e, 'y', 'a')).toBe(true);
  });
  it('3,000 노드 사슬도 빠르게', () => {
    const chain: Edge[] = Array.from({ length: 2999 }, (_, i) => ({ from: `n${i}`, to: `n${i + 1}` }));
    const t0 = performance.now();
    expect(createsCycle(chain, 'n2999', 'n0')).toBe(true);
    expect(createsCycle(chain, 'n0', 'n2999')).toBe(false);
    expect(performance.now() - t0).toBeLessThan(200);
  });
});

describe('계층', () => {
  const parentOf = new Map<string, string | null>([
    ['r', null],
    ['a', 'r'],
    ['b', 'a'],
    ['c', 'b'],
    ['s', null],
  ]);
  it('isAncestor', () => {
    expect(isAncestor(parentOf, 'r', 'c')).toBe(true);
    expect(isAncestor(parentOf, 'b', 'c')).toBe(true);
    expect(isAncestor(parentOf, 'c', 'r')).toBe(false);
    expect(isAncestor(parentOf, 'c', 'c')).toBe(false);
    expect(isAncestor(parentOf, 's', 'c')).toBe(false);
  });
  it('ancestorsOf·depthOf', () => {
    expect(ancestorsOf(parentOf, 'c')).toEqual(['b', 'a', 'r']);
    expect(depthOf(parentOf, 'c')).toBe(4);
    expect(depthOf(parentOf, 'r')).toBe(1);
  });
  it('잘못된(순환) 데이터에서도 멈춘다', () => {
    const bad = new Map<string, string | null>([
      ['a', 'b'],
      ['b', 'a'],
    ]);
    expect(isAncestor(bad, 'x', 'a')).toBe(false);
    expect(ancestorsOf(bad, 'a')).toEqual(['b']);
  });
  it('subtreeHeight', () => {
    const children = new Map([
      ['r', ['a', 's']],
      ['a', ['b']],
    ]);
    expect(subtreeHeight(children, 'r')).toBe(3);
    expect(subtreeHeight(children, 'b')).toBe(1);
  });
});

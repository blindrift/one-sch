import { describe, expect, it } from 'vitest';
import {
  ancestorsOf,
  createsCycle,
  depthOf,
  isAncestor,
  moveCreatesHierarchyDependency,
  subtreeDependencyPartners,
  subtreeHeight,
  type Edge,
} from '@/lib/schedule/graph';

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

describe('계층 변경과 의존(D14, L-1)', () => {
  // g > p > {a > a1, b},  x(최상위)
  const parentOf = new Map<string, string | null>([
    ['g', null],
    ['p', 'g'],
    ['a', 'p'],
    ['a1', 'a'],
    ['b', 'p'],
    ['x', null],
  ]);
  it('형제 a→b 의존이 있으면 b 를 a 밑으로 옮길 수 없다(양방향)', () => {
    expect(moveCreatesHierarchyDependency(parentOf, [{ from: 'a', to: 'b' }], 'b', 'a')).toBe(true);
    expect(moveCreatesHierarchyDependency(parentOf, [{ from: 'b', to: 'a' }], 'b', 'a')).toBe(true);
  });
  it('하위 트리의 후손과 새 상위의 조상 사이 의존도 거부', () => {
    // a1(a 의 후손) → x, a 를 x 밑으로
    expect(moveCreatesHierarchyDependency(parentOf, [{ from: 'a1', to: 'x' }], 'a', 'x')).toBe(true);
    // b → x 의존이 있을 때 a 를 b 밑으로: b 는 새 상위 자체, x 는 무관 → 허용
    expect(moveCreatesHierarchyDependency(parentOf, [{ from: 'b', to: 'x' }], 'a', 'b')).toBe(false);
    // a1 → g(새 상위 x 와 무관한 조상) 는 허용, a1 → b 이면 b 밑으로 거부
    expect(moveCreatesHierarchyDependency(parentOf, [{ from: 'a1', to: 'g' }], 'a', 'x')).toBe(false);
    expect(moveCreatesHierarchyDependency(parentOf, [{ from: 'a1', to: 'b' }], 'a', 'b')).toBe(true);
  });
  it('새 상위의 조상과의 의존도 거부, 관계없는 의존·하위 트리 안 의존은 허용', () => {
    const nested = new Map(parentOf).set('y', 'x');
    expect(moveCreatesHierarchyDependency(nested, [{ from: 'x', to: 'a1' }], 'a', 'y')).toBe(true);
    expect(moveCreatesHierarchyDependency(nested, [{ from: 'a', to: 'a1' }], 'a', 'y')).toBe(false);
    expect(moveCreatesHierarchyDependency(nested, [{ from: 'b', to: 'g' }], 'a', 'y')).toBe(false);
  });
  it('subtreeDependencyPartners 는 하위 트리 밖 상대만', () => {
    const edges: Edge[] = [
      { from: 'a', to: 'a1' },
      { from: 'a1', to: 'x' },
      { from: 'b', to: 'a' },
    ];
    expect([...subtreeDependencyPartners(parentOf, edges, 'a')].sort()).toEqual(['b', 'x']);
  });
});

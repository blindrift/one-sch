import { describe, expect, it } from 'vitest';
import { isLate, rollupTree, summarize } from '@/lib/schedule/rollup';

const t = (startDate: string, endDate: string, progress: number, isMilestone = false) => ({
  startDate,
  endDate,
  progress,
  isMilestone,
});

describe('summarize', () => {
  it('하위 없음 → null', () => expect(summarize([])).toBeNull());
  it('최소 시작~최대 종료, 기간 가중 평균', () => {
    // 10일 100% + 30일 0% → 25%
    expect(summarize([t('2026-01-01', '2026-01-10', 100), t('2026-01-05', '2026-02-03', 0)])).toEqual({
      startDate: '2026-01-01',
      endDate: '2026-02-03',
      progress: 25,
    });
  });
  it('마일스톤은 가중치 1일', () => {
    // 3일 0% + 마일스톤 100% → 25%
    expect(summarize([t('2026-01-01', '2026-01-03', 0), t('2026-01-10', '2026-01-10', 100, true)])).toEqual({
      startDate: '2026-01-01',
      endDate: '2026-01-10',
      progress: 25,
    });
  });
});

describe('rollupTree', () => {
  it('다단계: 손자 → 자식 → 부모, 잎은 그대로', () => {
    const nodes = [
      { id: 'p', parentId: null, ...t('2000-01-01', '2000-01-01', 0) },
      { id: 'c1', parentId: 'p', ...t('2000-01-01', '2000-01-01', 0) },
      { id: 'g1', parentId: 'c1', ...t('2026-01-01', '2026-01-04', 100) },
      { id: 'g2', parentId: 'c1', ...t('2026-01-05', '2026-01-08', 0) },
      { id: 'c2', parentId: 'p', ...t('2026-01-09', '2026-01-16', 50) },
    ];
    const out = rollupTree(nodes);
    expect(out.get('c1')).toEqual({ startDate: '2026-01-01', endDate: '2026-01-08', progress: 50 });
    // c1(8일, 50) + c2(8일, 50) → 50
    expect(out.get('p')).toEqual({ startDate: '2026-01-01', endDate: '2026-01-16', progress: 50 });
    expect(out.has('g1')).toBe(false);
    expect(out.has('c2')).toBe(false);
  });
});

describe('isLate', () => {
  const today = '2026-11-23';
  it('종료일 < 오늘 이고 완료 아님', () => {
    expect(isLate({ endDate: '2026-11-22', status: 'IN_PROGRESS', hasChildren: false }, today)).toBe(true);
  });
  it('오늘 종료는 지연 아님', () => {
    expect(isLate({ endDate: today, status: 'TODO', hasChildren: false }, today)).toBe(false);
  });
  it('DONE 은 진행률과 무관하게 지연 아님', () => {
    expect(isLate({ endDate: '2026-01-01', status: 'DONE', hasChildren: false }, today)).toBe(false);
  });
  it('요약 행은 제외', () => {
    expect(isLate({ endDate: '2026-01-01', status: 'TODO', hasChildren: true }, today)).toBe(false);
  });
});

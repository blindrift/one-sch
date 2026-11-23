// 차트의 빈 곳을 끌어 작업을 만드는 기능의 순수 계산(DOM·SVAR 와 무관해 단위 테스트한다).
import { ymdFromLocalDate } from '@/lib/dates';
import { isProjectRow, projectIdOfRow } from './adapter';
import type { TimelineStore } from './timeline-store';

/** 끌기로 고른 칸 범위: 시작·끝 칸 번호(포함, 0부터)와 날짜(YYYY-MM-DD, 포함 종료일) */
export type DayRange = { firstIndex: number; lastIndex: number; startDate: string; endDate: string };

/**
 * 차트 내용 좌표의 두 x(누른 곳·놓은 곳)를 날짜 범위로 바꾼다. 방향과 상관없이 앞이 시작이다.
 * scaleStart 는 간트 눈금의 첫날(로컬 자정), dayWidth 는 하루의 픽셀 너비(줌마다 다르다).
 */
export function dayRangeFromX(x0: number, x1: number, scaleStart: Date, dayWidth: number): DayRange {
  const idx = (x: number) => Math.max(0, Math.floor(x / dayWidth));
  const firstIndex = Math.min(idx(x0), idx(x1));
  const lastIndex = Math.max(idx(x0), idx(x1));
  // 로컬 날짜로 더한다(일광 절약 시간에도 자정이 유지된다)
  const at = (i: number) => ymdFromLocalDate(new Date(scaleStart.getFullYear(), scaleStart.getMonth(), scaleStart.getDate() + i));
  return { firstIndex, lastIndex, startDate: at(firstIndex), endDate: at(lastIndex) };
}

/** 끌기를 시작한 행으로 정하는 새 작업의 프로젝트·상위 작업 */
export type CreatePreset = { projectId: string; parentId: string | null };

/**
 * 행 → 새 작업 위치.
 * - 프로젝트 행: 그 프로젝트의 최상위 작업
 * - 하위가 있는 작업(요약) 행: 그 작업의 하위
 * - 그 밖의 작업 행: 같은 상위의 형제
 * - 행 밖(null): 위치를 정하지 않는다(대화상자 기본값)
 * 보관 프로젝트면 'readonly', 모르는 행이면 null.
 */
export function presetForRow(rowId: string | null, store: Pick<TimelineStore, 'task' | 'isReadonlyProject'>): CreatePreset | 'readonly' | null {
  if (!rowId) return null;
  if (isProjectRow(rowId)) {
    const projectId = projectIdOfRow(rowId);
    return store.isReadonlyProject(projectId) ? 'readonly' : { projectId, parentId: null };
  }
  const t = store.task(rowId);
  if (!t) return null;
  if (store.isReadonlyProject(t.projectId)) return 'readonly';
  return { projectId: t.projectId, parentId: t.hasChildren ? t.id : t.parentId };
}

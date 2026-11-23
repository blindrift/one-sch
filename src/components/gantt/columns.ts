import type { IColumnConfig } from '@svar-ui/react-gantt';
import type { GanttRow } from './adapter';

const PROGRESS_EDITOR = { type: 'text', config: { type: 'number', min: 0, max: 100, step: 5 } } as const;

/** 진행률 칸을 표에서 바로 고칠 수 있는 행: 일반 작업·마일스톤이고 읽기 전용(프로젝트 행·보관)이 아님 */
export function progressEditable(row: Pick<GanttRow, 'type' | 'readonly'>): boolean {
  return !row.readonly && row.type !== 'summary';
}

/** 왼쪽 표 너비(열 너비의 합). 작업 열은 남는 폭을 가져간다 */
export const GRID_WIDTH = 700;

/**
 * 왼쪽 표의 열(설계 6.1: 작업·상태·담당자·기간·진행률). 기본 열은 날짜를 DD-MM-YYYY 로 보여 주므로 직접 정의한다.
 * 칸 그리기(cell)는 React 컴포넌트라 cells.tsx 의 withCells 가 붙인다(이 파일은 단위 테스트가 바로 불러 JSX 를 두지 않는다).
 */
export const COLUMNS: IColumnConfig[] = [
  { id: 'text', header: '작업', flexgrow: 1, width: 220 },
  { id: 'status', header: '상태', width: 92 },
  { id: 'assigneeName', header: '담당자', width: 112 },
  {
    id: 'range',
    header: '기간',
    width: 172,
    template: (_v: unknown, row: GanttRow) =>
      !row.startYmd ? '' : row.type === 'milestone' || row.startYmd === row.endYmd ? row.startYmd : `${row.startYmd} ~ ${row.endYmd}`,
  },
  {
    id: 'progress',
    header: '진행률',
    width: 104,
    // 칸을 눌러 바로 고친다(저장은 막대 드래그와 같은 update-task 경로). 프로젝트 행·요약(D4)·보관(D6) 행은 고칠 수 없다.
    editor: (row: GanttRow) => (progressEditable(row) ? PROGRESS_EDITOR : null),
  },
] as unknown as IColumnConfig[];

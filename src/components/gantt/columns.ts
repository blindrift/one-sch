import type { IColumnConfig } from '@svar-ui/react-gantt';
import type { GanttRow } from './adapter';

const PROGRESS_EDITOR = { type: 'text', config: { type: 'number', min: 0, max: 100, step: 5 } } as const;

/** 진행률 칸을 표에서 바로 고칠 수 있는 행: 일반 작업·마일스톤이고 읽기 전용(프로젝트 행·보관)이 아님 */
export function progressEditable(row: Pick<GanttRow, 'type' | 'readonly'>): boolean {
  return !row.readonly && row.type !== 'summary';
}

/** 왼쪽 표의 열(설계 6.1: 작업·담당자·기간·진행률). 기본 열은 날짜를 DD-MM-YYYY 로 보여 주므로 직접 정의한다. */
export const COLUMNS: IColumnConfig[] = [
  { id: 'text', header: '작업', flexgrow: 1, width: 200 },
  { id: 'assigneeName', header: '담당자', width: 90, template: (_v: unknown, row: GanttRow) => row.assigneeName ?? '' },
  {
    id: 'range',
    header: '기간',
    width: 170,
    align: 'center',
    template: (_v: unknown, row: GanttRow) =>
      !row.startYmd ? '' : row.type === 'milestone' || row.startYmd === row.endYmd ? row.startYmd : `${row.startYmd} ~ ${row.endYmd}`,
  },
  {
    id: 'progress',
    header: '진행률',
    width: 72,
    align: 'center',
    template: (_v: unknown, row: GanttRow) => (row.startYmd ? `${row.progress}%` : ''),
    // 칸을 눌러 바로 고친다(저장은 막대 드래그와 같은 update-task 경로). 프로젝트 행·요약(D4)·보관(D6) 행은 고칠 수 없다.
    editor: (row: GanttRow) => (progressEditable(row) ? PROGRESS_EDITOR : null),
  },
] as IColumnConfig[];

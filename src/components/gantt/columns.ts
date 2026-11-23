import type { IColumnConfig } from '@svar-ui/react-gantt';
import type { GanttRow } from './adapter';

/** 왼쪽 표의 열(설계 6.1: 작업·담당자·기간·진행률). 기본 열은 날짜를 DD-MM-YYYY 로 보여 주므로 직접 정의한다. */
export const COLUMNS: IColumnConfig[] = [
  { id: 'text', header: '작업', flexgrow: 1 },
  { id: 'assigneeName', header: '담당자', width: 72, template: (_v: unknown, row: GanttRow) => row.assigneeName ?? '' },
  {
    id: 'range',
    header: '기간',
    width: 170,
    align: 'center',
    template: (_v: unknown, row: GanttRow) =>
      !row.startYmd ? '' : row.type === 'milestone' || row.startYmd === row.endYmd ? row.startYmd : `${row.startYmd} ~ ${row.endYmd}`,
  },
  { id: 'progress', header: '진행률', width: 60, align: 'center', template: (_v: unknown, row: GanttRow) => (row.startYmd ? `${row.progress}%` : '') },
] as IColumnConfig[];

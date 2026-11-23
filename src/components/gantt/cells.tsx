'use client';

// 왼쪽 표의 칸 그리기(SVAR 표의 column.cell). 행은 보이는 것만 그려지므로(가상화) 가벼운 span 만 쓴다.
import type { CSSProperties, FC } from 'react';
import type { IColumnConfig } from '@svar-ui/react-gantt';
import { TASK_STATUS_COLORS, TASK_STATUS_LABELS } from '@/lib/schedule/status';
import type { GanttRow } from './adapter';

type CellProps = { row: GanttRow };

/** 아바타 배경색(사용자 id 로 고정). 흰 글자가 읽히는 중간 명도만 둔다 */
const AVATAR_COLORS = ['#7b68ee', '#4c7dff', '#2fb17c', '#f5a524', '#e5484d', '#0091ff', '#d6409f', '#12a594', '#8e4ec6', '#e5734b'];

export function avatarColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

/** 이니셜: 한글 이름은 첫 글자, 로마자는 앞 두 단어의 머리글자 */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  if (/^[A-Za-z]/.test(parts[0])) return parts.slice(0, 2).map((p) => p[0].toUpperCase()).join('');
  return parts[0].slice(0, 1);
}

/** 작업 열(SVAR 가 펼침 단추·들여쓰기를 앞에 붙인다): 프로젝트 행은 색 점 + 굵게, 마일스톤은 작은 마름모 */
export function TaskCell({ row }: CellProps) {
  if (row.kind === 'project') {
    return (
      <span className="og-cell-task og-cell-project">
        <span className="og-dot" style={{ background: row.color }} aria-hidden />
        <span className="og-cell-title">{row.text}</span>
      </span>
    );
  }
  return (
    <span className="og-cell-task">
      {row.type === 'milestone' ? <span className="og-ms-icon" style={{ background: row.color }} aria-hidden /> : null}
      <span className="og-cell-title">{row.text}</span>
    </span>
  );
}

/** 상태 열: 색 점 + 라벨 배지 */
export function StatusCell({ row }: CellProps) {
  if (!row.status) return null;
  return (
    <span className="og-status" style={{ '--st': TASK_STATUS_COLORS[row.status] } as CSSProperties}>
      <span className="og-status-dot" aria-hidden />
      {TASK_STATUS_LABELS[row.status]}
    </span>
  );
}

/** 담당자 열: 이니셜 원형 아바타 + 이름 */
export function AssigneeCell({ row }: CellProps) {
  if (row.kind === 'project') return null;
  if (!row.assigneeName || !row.assigneeId) return <span className="og-avatar og-avatar-empty" aria-hidden />;
  return (
    <span className="og-assignee">
      <span className="og-avatar" style={{ background: avatarColor(row.assigneeId) }} aria-hidden>
        {initials(row.assigneeName)}
      </span>
      <span className="og-assignee-name">{row.assigneeName}</span>
    </span>
  );
}

/** 진행률 열: 작은 진행 바 + 숫자(칸 글자는 숫자뿐이라 E2E 의 '80%' 비교가 그대로 맞는다) */
export function ProgressCell({ row }: CellProps) {
  if (!row.startYmd) return null;
  const pct = Math.max(0, Math.min(100, Number(row.progress) || 0));
  return (
    <span className={pct >= 100 ? 'og-progress og-progress-done' : 'og-progress'}>
      <span className="og-progress-track" aria-hidden>
        <span className="og-progress-fill" style={{ width: `${pct}%` }} />
      </span>
      <span className="og-progress-num">{`${row.progress}%`}</span>
    </span>
  );
}

const CELLS: Record<string, FC<CellProps>> = { text: TaskCell, status: StatusCell, assigneeName: AssigneeCell, progress: ProgressCell };

/** 열 정의에 칸 그리기를 붙인다(작업 열의 cell 은 SVAR 가 펼침 단추·들여쓰기 뒤에 넣는다) */
export function withCells(columns: IColumnConfig[]): IColumnConfig[] {
  return columns.map((c) => (c.id && CELLS[c.id] ? ({ ...c, cell: CELLS[c.id] } as unknown as IColumnConfig) : c));
}

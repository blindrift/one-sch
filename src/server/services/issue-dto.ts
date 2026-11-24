import 'server-only';
import type {
  IssuePriority as PrismaIssuePriority,
  IssueStatus as PrismaIssueStatus,
  IssueType as PrismaIssueType,
} from '@prisma/client';
import { toYmd } from '@/lib/dates';
import type { IssueDto } from '@/lib/issue/dto';
import { issueKey, type IssuePriority, type IssueStatus, type IssueType } from '@/lib/issue/status';

// lib/issue/status.ts 의 값과 Prisma enum 이 어긋나면 컴파일 오류가 나게 한다.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const issueTypeMatch: Same<IssueType, PrismaIssueType> = true;
const issueStatusMatch: Same<IssueStatus, PrismaIssueStatus> = true;
const issuePriorityMatch: Same<IssuePriority, PrismaIssuePriority> = true;
void issueTypeMatch;
void issueStatusMatch;
void issuePriorityMatch;

export type IssueRow = {
  id: string;
  projectId: string;
  number: number;
  taskId: string | null;
  title: string;
  description: string;
  type: PrismaIssueType;
  status: PrismaIssueStatus;
  priority: PrismaIssuePriority;
  assigneeId: string | null;
  reporterId: string;
  dueDate: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

export function toIssueDto(row: IssueRow, projectKey: string): IssueDto {
  return {
    id: row.id,
    projectId: row.projectId,
    projectKey,
    number: row.number,
    key: issueKey(projectKey, row.number),
    taskId: row.taskId,
    title: row.title,
    description: row.description,
    type: row.type,
    status: row.status,
    priority: row.priority,
    assigneeId: row.assigneeId,
    reporterId: row.reporterId,
    dueDate: row.dueDate ? toYmd(row.dueDate) : null,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** 감사·비교용 스냅샷(마감일은 ymd) */
export function issueSnapshot(i: IssueDto) {
  return {
    projectId: i.projectId,
    number: i.number,
    taskId: i.taskId,
    title: i.title,
    description: i.description,
    type: i.type,
    status: i.status,
    priority: i.priority,
    assigneeId: i.assigneeId,
    reporterId: i.reporterId,
    dueDate: i.dueDate,
  };
}

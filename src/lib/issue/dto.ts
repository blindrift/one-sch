// 서버 → 화면으로 내려보내는 이슈·댓글 데이터(클라이언트·서버 공용 타입). 날짜(마감일)는 `YYYY-MM-DD`, 시각은 ISO 문자열.
// 사용자는 id·이름만 싣는다(D8, 이메일 미노출).
import type { IssuePriority, IssueStatus, IssueType } from './status';

export type IssueDto = {
  id: string;
  projectId: string;
  projectKey: string;
  number: number;
  /** `KEY-번호` */
  key: string;
  taskId: string | null;
  title: string;
  description: string;
  type: IssueType;
  status: IssueStatus;
  priority: IssuePriority;
  assigneeId: string | null;
  reporterId: string;
  dueDate: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** 목록 행(설명 없이) */
export type IssueListItem = Omit<IssueDto, 'description'> & {
  projectName: string;
  projectColor: string;
  projectArchived: boolean;
  assigneeName: string | null;
  /** 지우지 않은 댓글 수 */
  commentCount: number;
};

export type CommentDto = {
  id: string;
  authorId: string;
  authorName: string;
  /** 지운 댓글은 null(본문을 내려보내지 않는다) */
  body: string | null;
  deleted: boolean;
  /** 만든 뒤 고친 적이 있는지(지운 댓글은 false) */
  edited: boolean;
  createdAt: string;
};

export type IssueDetail = IssueDto & {
  projectName: string;
  projectArchived: boolean;
  assigneeName: string | null;
  reporterName: string;
  task: { id: string; title: string } | null;
  /** 최근 댓글(작성 순, 최대 COMMENT_DETAIL_LIMIT 건) */
  comments: CommentDto[];
  /** 위 목록에서 생략한 오래된 댓글 수(지운 댓글 포함) */
  olderCommentCount: number;
  /** 지우지 않은 댓글 수(전체) */
  commentCount: number;
};

export type IssueDeleteResult = { id: string };

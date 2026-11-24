import { MessageSquare } from 'lucide-react';
import Link from 'next/link';
import { ariaSort, SortHeaderLink, type SortLink } from '@/components/list/pager';
import type { IssueListItem } from '@/lib/issue/dto';
import type { IssueSort } from '@/lib/list-query';
import { IssuePriorityBadge, IssueStatusBadge, IssueTypeBadge } from './issue-badges';

/**
 * 이슈 목록 표(서버 렌더). 행을 누르면 같은 화면에 상세 패널을 연다(`?issue=KEY-n`, 목록 query 유지).
 * showProject: 전체 이슈(/issues)에서 프로젝트 열을 보인다.
 */
export function IssueList({
  items,
  hrefFor,
  sortLinks,
  selectedKey,
  showProject,
  today,
}: {
  items: IssueListItem[];
  hrefFor: (key: string) => string;
  sortLinks: Record<IssueSort, SortLink>;
  selectedKey: string | null;
  showProject: boolean;
  today: string;
}) {
  const head = (sort: IssueSort, label: string, className = '') => (
    <th scope="col" className={`py-2 pr-3 font-medium ${className}`} aria-sort={ariaSort(sortLinks[sort])}>
      <SortHeaderLink label={label} link={sortLinks[sort]} />
    </th>
  );
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-background shadow-[var(--shadow-sm)]">
      <table className="w-full text-sm" data-testid="issue-list">
        <thead className="bg-surface-muted text-left text-xs text-muted-foreground">
          <tr className="border-b border-line">
            {head('number', '번호', 'w-24 pl-4')}
            {head('title', '제목')}
            {showProject ? (
              <th scope="col" className="w-32 py-2 pr-3 font-medium">
                프로젝트
              </th>
            ) : null}
            {head('status', '상태', 'w-24')}
            {head('priority', '우선순위', 'w-24')}
            <th scope="col" className="w-28 py-2 pr-3 font-medium">
              담당자
            </th>
            {head('due', '마감일', 'w-28 pr-4')}
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <tr>
              <td colSpan={showProject ? 7 : 6} className="py-12 text-center text-muted-foreground">
                이슈가 없습니다.
              </td>
            </tr>
          ) : null}
          {items.map((i) => {
            const selected = i.key === selectedKey;
            const late = !!i.dueDate && i.dueDate < today && (i.status === 'OPEN' || i.status === 'IN_PROGRESS');
            return (
              <tr
                key={i.id}
                data-testid={`issue-row-${i.key}`}
                aria-selected={selected}
                className={`border-b border-line last:border-0 ${selected ? 'bg-brand-soft/60' : 'hover:bg-surface-muted/60'}`}
              >
                <td className="py-2 pl-4 font-mono text-xs text-text-subtle">{i.key}</td>
                <td className="py-2 pr-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <IssueTypeBadge type={i.type} />
                    <Link href={hrefFor(i.key)} scroll={false} className="truncate font-medium hover:underline" aria-current={selected ? 'true' : undefined}>
                      {i.title}
                    </Link>
                    {i.commentCount ? (
                      <span className="inline-flex shrink-0 items-center gap-0.5 text-[11px] text-text-subtle" title={`댓글 ${i.commentCount}개`}>
                        <MessageSquare className="size-3" aria-hidden />
                        {i.commentCount}
                      </span>
                    ) : null}
                  </div>
                </td>
                {showProject ? (
                  <td className="py-2 pr-3 text-xs">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="size-2 rounded-[3px]" style={{ background: i.projectColor }} aria-hidden />
                      <span className="truncate">{i.projectName}</span>
                    </span>
                  </td>
                ) : null}
                <td className="py-2 pr-3">
                  <IssueStatusBadge status={i.status} />
                </td>
                <td className="py-2 pr-3">
                  <IssuePriorityBadge priority={i.priority} />
                </td>
                <td className="py-2 pr-3 text-xs">{i.assigneeName ?? <span className="text-text-subtle">—</span>}</td>
                <td className={`py-2 pr-4 text-xs tabular-nums ${late ? 'font-medium text-red-700' : ''}`}>{i.dueDate ?? <span className="text-text-subtle">—</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

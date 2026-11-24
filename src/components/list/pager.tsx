import { ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';

/** 목록 아래 페이지 이동(이전·다음 링크와 "n / m쪽 · 전체 k건") */
export function Pager({ page, pageCount, total, hrefFor, unit = '건' }: { page: number; pageCount: number; total: number; hrefFor: (page: number) => string; unit?: string }) {
  const btn = 'inline-flex h-8 items-center gap-1 rounded-md border border-line bg-background px-2.5 text-xs';
  return (
    <nav aria-label="페이지" className="flex items-center justify-between gap-3 px-4 py-3 text-xs text-muted-foreground">
      <span data-testid="list-total" className="tabular-nums">
        전체 {total.toLocaleString('ko-KR')}
        {unit}
      </span>
      {pageCount > 1 ? (
        <div className="flex items-center gap-2">
          {page > 1 ? (
            <Link href={hrefFor(page - 1)} className={`${btn} hover:bg-surface-muted`} rel="prev">
              <ChevronLeft className="size-3.5" aria-hidden />
              이전
            </Link>
          ) : (
            <span className={`${btn} opacity-40`} aria-disabled>
              <ChevronLeft className="size-3.5" aria-hidden />
              이전
            </span>
          )}
          <span className="tabular-nums" aria-current="page">
            {page} / {pageCount}쪽
          </span>
          {page < pageCount ? (
            <Link href={hrefFor(page + 1)} className={`${btn} hover:bg-surface-muted`} rel="next">
              다음
              <ChevronRight className="size-3.5" aria-hidden />
            </Link>
          ) : (
            <span className={`${btn} opacity-40`} aria-disabled>
              다음
              <ChevronRight className="size-3.5" aria-hidden />
            </span>
          )}
        </div>
      ) : null}
    </nav>
  );
}

export type SortLink = { href: string; active: boolean; dir: 'asc' | 'desc' };

/** 정렬 가능한 열 머리(링크). 현재 정렬이면 방향 화살표와 aria-sort */
export function SortHeaderLink({ label, link }: { label: string; link: SortLink }) {
  return (
    <Link href={link.href} className="inline-flex items-center gap-1 hover:text-foreground" data-sort-active={link.active || undefined}>
      {label}
      {link.active ? <span aria-hidden>{link.dir === 'asc' ? '↑' : '↓'}</span> : null}
    </Link>
  );
}

export function ariaSort(link: SortLink): 'ascending' | 'descending' | undefined {
  return link.active ? (link.dir === 'asc' ? 'ascending' : 'descending') : undefined;
}

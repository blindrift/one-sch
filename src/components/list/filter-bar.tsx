'use client';

import { ChevronDown, Search, X } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import { SEARCH_MAX } from '@/lib/validation/limits';

export type FilterSpec = { name: string; label: string; value: string; options: { value: string; label: string }[] };

/**
 * 목록 화면의 필터·검색 도구 모음. 값을 바꾸면 URL query 를 고쳐 이동한다(서버가 다시 읽는다, 새로고침·공유 유지).
 * 필터·검색이 바뀌면 페이지는 1쪽으로, 상세 패널(issue)은 닫는다.
 */
export function FilterBar({ filters, q, placeholder, children }: { filters: FilterSpec[]; q: string; placeholder: string; children?: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [text, setText] = useState(q);
  const [source, setSource] = useState(q);
  if (source !== q) {
    setSource(q);
    setText(q);
  }
  const [pending, startTransition] = useTransition();

  function go(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    next.delete('page');
    next.delete('issue');
    const qs = next.toString();
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname));
  }

  const active = filters.some((f) => f.value) || !!q;
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line bg-background px-4 py-2 text-sm" aria-busy={pending}>
      <form
        role="search"
        className="relative w-56"
        onSubmit={(e) => {
          e.preventDefault();
          go({ q: text.trim() || null });
        }}
      >
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-text-subtle" aria-hidden />
        <input
          type="search"
          aria-label="검색"
          placeholder={placeholder}
          maxLength={SEARCH_MAX}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="h-8 w-full rounded-md border border-line bg-background pr-2 pl-8 text-xs outline-none placeholder:text-text-subtle focus-visible:ring-2 focus-visible:ring-brand/30"
        />
      </form>
      {filters.map((f) => (
        <div key={f.name} className="relative w-36">
          <select
            aria-label={f.label}
            value={f.value}
            onChange={(e) => go({ [f.name]: e.target.value || null })}
            className={
              f.value
                ? 'h-8 w-full cursor-pointer appearance-none truncate rounded-md border border-brand/40 bg-brand-soft pr-7 pl-2.5 text-xs font-medium text-brand outline-none focus-visible:ring-2 focus-visible:ring-brand/30'
                : 'h-8 w-full cursor-pointer appearance-none truncate rounded-md border border-line bg-background pr-7 pl-2.5 text-xs text-muted-foreground outline-none hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-brand/30'
            }
          >
            {f.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-text-subtle" aria-hidden />
        </div>
      ))}
      {active ? (
        <button
          type="button"
          onClick={() => {
            setText('');
            go({ q: null, ...Object.fromEntries(filters.map((f) => [f.name, null])) });
          }}
          className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-surface-muted hover:text-foreground"
        >
          <X className="size-3.5" aria-hidden />
          초기화
        </button>
      ) : null}
      {children}
    </div>
  );
}

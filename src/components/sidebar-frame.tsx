'use client';

import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useState } from 'react';
import { cn } from 'cn';

/** 접힘 상태를 남기는 쿠키(서버가 첫 화면부터 같은 모양으로 그리도록 쿠키에 둔다) */
export const SIDEBAR_COOKIE = 'og-sidebar';

/**
 * 접을 수 있는 사이드바 틀. 접으면 아이콘만 남는 좁은 막대(56px)가 된다.
 * 안쪽 요소는 `group-data-[collapsed=true]/side:*` 로 접힌 모양을 정한다.
 */
export function SidebarFrame({ initialCollapsed, brand, children }: { initialCollapsed: boolean; brand: React.ReactNode; children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = `${SIDEBAR_COOKIE}=${next ? 'collapsed' : 'open'}; path=/; max-age=31536000; samesite=lax`;
  }
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose;
  return (
    <aside
      data-collapsed={collapsed}
      data-testid="sidebar"
      className={cn(
        'group/side flex shrink-0 flex-col border-r border-line bg-surface-muted transition-[width] duration-150',
        collapsed ? 'w-14' : 'w-60',
      )}
    >
      <div className="flex h-12 shrink-0 items-center gap-1 px-2 group-data-[collapsed=true]/side:flex-col group-data-[collapsed=true]/side:justify-center">
        <div className="min-w-0 flex-1 group-data-[collapsed=true]/side:hidden">{brand}</div>
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? '사이드바 펼치기' : '사이드바 접기'}
          aria-expanded={!collapsed}
          title={collapsed ? '사이드바 펼치기' : '사이드바 접기'}
          className="flex size-8 shrink-0 items-center justify-center rounded-md text-text-subtle transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:outline-none"
        >
          <Icon className="size-4" aria-hidden />
        </button>
      </div>
      {children}
    </aside>
  );
}

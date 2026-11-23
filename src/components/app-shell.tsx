import { LogOut } from 'lucide-react';
import Link from 'next/link';
import { headers } from 'next/headers';
import { BrandMark } from '@/components/brand-mark';
import { SidebarFrame } from '@/components/sidebar-frame';
import { SidebarNav, type SidebarProject } from '@/components/sidebar-nav';
import { ROLE_LABELS } from '@/lib/roles';
import { logout } from '@/server/actions/auth';
import type { SessionUser } from '@/server/auth/current-user';
import { listProjects } from '@/server/services/timeline-service';

type ShellProject = SidebarProject & { archived: boolean };

/**
 * 앱 화면 틀: 왼쪽 사이드바 + 얇은 상단 바 + 본문.
 *
 * layout 이 아니라 각 page 가 requirePage 를 통과한 뒤 그린다. layout 은 가드가 없어 DB·서비스에 닿으면 안 되므로
 * (tests/unit/authz/static-guards), 사이드바의 프로젝트 목록을 읽는 이 틀은 page 안에서만 쓴다.
 *
 * - `fill`: 본문이 남은 높이를 정확히 채운다(간트. 높이가 풀리면 행 가상화가 꺼진다). 아니면 본문이 자체 스크롤한다.
 * - `projects`: 이미 읽은 프로젝트가 있으면 넘긴다(없으면 여기서 읽는다). 보관 프로젝트는 빼고 보여 준다.
 */
export async function AppShell({
  me,
  title,
  actions,
  fill = false,
  projects,
  children,
}: {
  me: SessionUser;
  title: React.ReactNode;
  actions?: React.ReactNode;
  fill?: boolean;
  projects?: ShellProject[];
  children: React.ReactNode;
}) {
  const list = projects ?? (await listProjects());
  const active = list.filter((p) => !p.archived).map(({ key, name, color }) => ({ key, name, color }));
  // middleware 가 og-sidebar 쿠키를 x-og-sidebar 헤더로 넘긴다(cookies() 로는 보이지 않을 수 있다)
  const collapsed = (await headers()).get('x-og-sidebar') === 'collapsed';

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <SidebarFrame
        initialCollapsed={collapsed}
        brand={
          <Link href="/timeline" className="flex h-9 items-center gap-2.5 rounded-md px-2 hover:bg-sidebar-accent/60">
            <BrandMark className="size-6 rounded-md text-xs" />
            <span className="text-[15px] font-semibold tracking-tight">one-sch</span>
          </Link>
        }
      >
        <SidebarNav isAdmin={me.role === 'ADMIN'} projects={active} />
        <div className="flex shrink-0 items-center gap-2.5 border-t border-line px-3 py-2.5 group-data-[collapsed=true]/side:flex-col group-data-[collapsed=true]/side:px-0">
          <span
            aria-hidden
            className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand"
          >
            {me.name.slice(0, 1)}
          </span>
          <div className="flex min-w-0 flex-1 flex-col leading-tight group-data-[collapsed=true]/side:hidden">
            <span className="truncate text-[13px] font-medium">{me.name}</span>
            <span className="text-[11px] text-text-subtle">{ROLE_LABELS[me.role]}</span>
          </div>
          <form action={logout}>
            <button
              type="submit"
              aria-label="로그아웃"
              title="로그아웃"
              className="flex size-7 items-center justify-center rounded-md text-text-subtle transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:outline-none"
            >
              <LogOut className="size-4" aria-hidden />
            </button>
          </form>
        </div>
      </SidebarFrame>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-background px-4">
          <div className="flex min-w-0 flex-1 items-center gap-2.5">{title}</div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </header>
        <main className={fill ? 'flex min-h-0 flex-1 flex-col overflow-hidden' : 'min-h-0 flex-1 overflow-y-auto bg-surface-sunken'}>
          {children}
        </main>
      </div>
    </div>
  );
}

/** 상단 바 제목(h1). 페이지마다 하나만 둔다. */
export function PageTitle({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <>
      {icon ? <span className="flex size-6 shrink-0 items-center justify-center text-text-subtle">{icon}</span> : null}
      <h1 className="truncate text-[15px] font-semibold">{children}</h1>
    </>
  );
}

/** ClickUp 식 밑줄 보기 탭(현재 2단계는 간트 하나). */
export function ViewTabs({ tabs, label }: { tabs: { label: string; icon?: React.ReactNode; active: boolean }[]; label: string }) {
  return (
    <nav aria-label={label} className="flex h-10 shrink-0 items-stretch gap-5 border-b border-line px-4">
      {tabs.map((t) => (
        <span
          key={t.label}
          aria-current={t.active ? 'page' : undefined}
          className={
            t.active
              ? 'relative flex items-center gap-1.5 text-[13px] font-medium text-foreground after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:rounded-full after:bg-brand'
              : 'flex items-center gap-1.5 text-[13px] text-text-subtle'
          }
        >
          {t.icon}
          {t.label}
        </span>
      ))}
    </nav>
  );
}

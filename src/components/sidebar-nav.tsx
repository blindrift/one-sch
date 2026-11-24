'use client';

import { ChartGantt, CircleDot, FolderKanban, Users } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from 'cn';

export type SidebarProject = { key: string; name: string; color: string };

const ITEM =
  'flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] transition-colors group-data-[collapsed=true]/side:justify-center group-data-[collapsed=true]/side:px-0';
/** 사이드바를 접으면 숨기는 글자 */
const LABEL = 'truncate group-data-[collapsed=true]/side:hidden';
const IDLE = 'text-foreground/80 hover:bg-sidebar-accent hover:text-foreground';
const ACTIVE = 'bg-brand-soft font-medium text-brand';

/** 사이드바 메뉴·프로젝트 목록. 현재 경로로 활성 항목만 표시한다(화면 틀, 권한은 page 가 검사). */
export function SidebarNav({ isAdmin, projects }: { isAdmin: boolean; projects: SidebarProject[] }) {
  const pathname = usePathname();
  const menu = [
    { href: '/timeline', label: '타임라인', icon: ChartGantt, active: pathname === '/timeline' },
    { href: '/projects', label: '프로젝트', icon: FolderKanban, active: pathname === '/projects' },
    { href: '/issues', label: '이슈', icon: CircleDot, active: pathname === '/issues' },
    ...(isAdmin ? [{ href: '/admin/users', label: '사용자 관리', icon: Users, active: pathname.startsWith('/admin/users') }] : []),
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 px-2 py-3">
      <nav aria-label="주 메뉴" className="flex flex-col gap-0.5">
        {menu.map((m) => (
          <Link key={m.href} href={m.href} aria-current={m.active ? 'page' : undefined} className={cn(ITEM, m.active ? ACTIVE : IDLE)} title={m.label}>
            <m.icon className={cn('size-4 shrink-0', m.active ? 'text-brand' : 'text-text-subtle')} aria-hidden />
            <span className={LABEL}>{m.label}</span>
          </Link>
        ))}
      </nav>
      <nav aria-label="프로젝트 바로 가기" className="flex min-h-0 flex-1 flex-col">
        <p className="px-2.5 pb-1.5 text-[11px] font-semibold tracking-wide text-text-subtle group-data-[collapsed=true]/side:hidden">프로젝트</p>
        <ul className="-mr-2 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pr-2">
          {projects.length === 0 ? <li className="px-2.5 py-1 text-xs text-text-subtle">활성 프로젝트가 없습니다.</li> : null}
          {projects.map((p) => {
            const href = `/projects/${p.key}`;
            // 프로젝트의 모든 탭(/board·/list·/issues)에서 활성. 키가 앞부분만 같은 다른 프로젝트(AB·ABC)는 제외
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <li key={p.key}>
                <Link href={href} aria-current={active ? 'page' : undefined} className={cn(ITEM, active ? ACTIVE : IDLE)} title={`[${p.key}] ${p.name}`}>
                  <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: p.color }} aria-hidden />
                  <span className={LABEL}>
                    <span className={cn('font-mono text-[11px]', active ? 'text-brand' : 'text-text-subtle')}>[{p.key}]</span> {p.name}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

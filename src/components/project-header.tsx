import { ChartGantt, ChevronRight, CircleDot, SquareKanban, List } from 'lucide-react';
import Link from 'next/link';
import { ViewTabs } from '@/components/app-shell';
import { ProjectStatusBadge } from '@/components/project-status-badge';
import type { ProjectDto } from '@/lib/schedule/dto';

// 프로젝트 화면 공통 머리(제목·탭). (main)/layout 은 가드가 없어 DB 를 읽을 수 없으므로 각 탭 page 가 그린다.

export type ProjectTab = 'gantt' | 'board' | 'list' | 'issues';

const TABS: { tab: ProjectTab; label: string; path: string; icon: React.ReactNode }[] = [
  { tab: 'gantt', label: '간트', path: '', icon: <ChartGantt className="size-3.5" aria-hidden /> },
  { tab: 'board', label: '보드', path: '/board', icon: <SquareKanban className="size-3.5" aria-hidden /> },
  { tab: 'list', label: '목록', path: '/list', icon: <List className="size-3.5" aria-hidden /> },
  { tab: 'issues', label: '이슈', path: '/issues', icon: <CircleDot className="size-3.5" aria-hidden /> },
];

/** 상단 바 제목: 프로젝트 › [KEY] 이름 · 상태 · 보관 표시 */
export function ProjectTitle({ project }: { project: ProjectDto }) {
  return (
    <>
      <Link href="/projects" className="shrink-0 text-[13px] text-text-subtle transition-colors hover:text-foreground">
        프로젝트
      </Link>
      <ChevronRight className="size-3.5 shrink-0 text-text-subtle" aria-hidden />
      <span className="size-3 shrink-0 rounded-[4px]" style={{ background: project.color }} aria-hidden />
      <h1 className="truncate text-[15px] font-semibold">
        <span className="font-mono text-text-subtle">{project.key}</span> {project.name}
      </h1>
      <ProjectStatusBadge status={project.status} />
      {project.archived ? (
        <span className="inline-flex h-5 shrink-0 items-center rounded-full border border-line bg-surface-muted px-2 text-xs text-muted-foreground">
          보관(읽기 전용)
        </span>
      ) : null}
    </>
  );
}

/** 간트·보드·목록·이슈 탭(링크, 현재 탭은 aria-current=page) */
export function ProjectTabs({ projectKey, active }: { projectKey: string; active: ProjectTab }) {
  return (
    <ViewTabs
      label="프로젝트 탭"
      tabs={TABS.map((t) => ({
        label: t.label,
        icon: t.icon,
        active: t.tab === active,
        href: `/projects/${projectKey}${t.path}`,
        testId: `project-tab-${t.tab}`,
      }))}
    />
  );
}

import { notFound } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { ProjectTabs, ProjectTitle } from '@/components/project-header';
import { PROJECT_KEY_RE } from '@/lib/validation/limits';
import { requirePage } from '@/server/auth/require-role';
import { findProjectByKey } from '@/server/services/timeline-service';

// 프로젝트 보드 탭
export default async function ProjectBoardPage({ params }: { params: Promise<{ key: string }> }) {
  const me = await requirePage('VIEWER');
  const { key } = await params;
  const project = PROJECT_KEY_RE.test(key) ? await findProjectByKey(key) : null;
  if (!project) notFound();

  return (
    <AppShell me={me} title={<ProjectTitle project={project} />}>
      <ProjectTabs projectKey={project.key} active="board" />
      <p className="p-6 text-sm text-muted-foreground">준비 중입니다.</p>
    </AppShell>
  );
}

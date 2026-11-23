import { FolderKanban } from 'lucide-react';
import { AppShell, PageTitle } from '@/components/app-shell';
import { hasRole } from '@/lib/roles';
import { requirePage } from '@/server/auth/require-role';
import { listProjects, listUserOptions } from '@/server/services/timeline-service';
import { ProjectFormDialog } from './project-form-dialog';
import { ProjectsTable } from './projects-table';

export default async function ProjectsPage() {
  const me = await requirePage('VIEWER');
  const [projects, users] = await Promise.all([listProjects(), listUserOptions()]);
  const canEdit = hasRole(me.role, 'MEMBER');
  const activeCount = projects.filter((p) => !p.archived).length;

  return (
    <AppShell
      me={me}
      projects={projects}
      title={<PageTitle icon={<FolderKanban className="size-4" />}>프로젝트</PageTitle>}
      actions={canEdit ? <ProjectFormDialog mode="create" users={users} defaultOwnerId={me.id} /> : null}
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-6">
        <div className="flex items-baseline justify-between gap-4">
          <p className="text-sm text-muted-foreground">보관한 프로젝트는 타임라인에서 숨겨지고 읽기 전용이 됩니다.</p>
          <p className="shrink-0 text-xs text-text-subtle">
            활성 {activeCount}개 · 전체 {projects.length}개
          </p>
        </div>
        <ProjectsTable projects={projects} users={users} canEdit={canEdit} />
      </div>
    </AppShell>
  );
}

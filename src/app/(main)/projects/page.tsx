import { hasRole } from '@/lib/roles';
import { requirePage } from '@/server/auth/require-role';
import { listProjects, listUserOptions } from '@/server/services/timeline-service';
import { ProjectFormDialog } from './project-form-dialog';
import { ProjectsTable } from './projects-table';

export default async function ProjectsPage() {
  const me = await requirePage('VIEWER');
  const [projects, users] = await Promise.all([listProjects(), listUserOptions()]);
  const canEdit = hasRole(me.role, 'MEMBER');

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">프로젝트</h1>
          <p className="text-sm text-muted-foreground">보관한 프로젝트는 타임라인에서 숨겨지고 읽기 전용이 됩니다.</p>
        </div>
        {canEdit ? <ProjectFormDialog mode="create" users={users} defaultOwnerId={me.id} /> : null}
      </div>
      <ProjectsTable projects={projects} users={users} canEdit={canEdit} />
    </main>
  );
}

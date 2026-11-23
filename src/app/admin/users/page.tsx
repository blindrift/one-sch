import { Users } from 'lucide-react';
import { AppShell, PageTitle } from '@/components/app-shell';
import { requirePage } from '@/server/auth/require-role';
import { listUsers } from '@/server/services/user-service';
import { CreateUserDialog } from './create-user-dialog';
import { UsersTable } from './users-table';

export default async function AdminUsersPage() {
  const me = await requirePage('ADMIN');
  const users = await listUsers();

  return (
    <AppShell me={me} title={<PageTitle icon={<Users className="size-4" />}>사용자 관리</PageTitle>} actions={<CreateUserDialog />}>
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-6">
        <div className="flex items-baseline justify-between gap-4">
          <p className="text-sm text-muted-foreground">구글 계정 이메일로 등록한 사용자만 로그인할 수 있습니다.</p>
          <p className="shrink-0 text-xs text-text-subtle">사용자 {users.length}명</p>
        </div>
        <UsersTable users={users} currentUserId={me.id} />
      </div>
    </AppShell>
  );
}

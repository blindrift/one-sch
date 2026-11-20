import { requirePage } from '@/server/auth/require-role';
import { listUsers } from '@/server/services/user-service';
import { CreateUserDialog } from './create-user-dialog';
import { UsersTable } from './users-table';

export default async function AdminUsersPage() {
  const me = await requirePage('ADMIN');
  const users = await listUsers();

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">사용자 관리</h1>
          <p className="text-sm text-muted-foreground">구글 계정 이메일로 등록한 사용자만 로그인할 수 있습니다.</p>
        </div>
        <CreateUserDialog />
      </div>
      <UsersTable users={users} currentUserId={me.id} />
    </main>
  );
}

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ROLE_LABELS } from '@/lib/roles';
import { logout } from '@/server/actions/auth';
import { getSessionUser } from '@/server/auth/current-user';

// 화면 틀(UI)일 뿐 보안 경계가 아니다. 권한은 각 page 의 requirePage 가 검사한다.
export async function AppHeader() {
  const user = await getSessionUser();

  return (
    <header className="flex h-12 items-center justify-between border-b px-4">
      <nav className="flex items-center gap-4 text-sm">
        <Link href="/timeline" className="font-semibold">
          one-sch
        </Link>
        <Link href="/timeline">타임라인</Link>
        <Link href="/projects">프로젝트</Link>
        {user?.role === 'ADMIN' ? <Link href="/admin/users">사용자 관리</Link> : null}
      </nav>
      {user ? (
        <div className="flex items-center gap-3 text-sm">
          <span>
            {user.name} <span className="text-muted-foreground">({ROLE_LABELS[user.role]})</span>
          </span>
          <form action={logout}>
            <Button type="submit" variant="ghost" size="sm">
              로그아웃
            </Button>
          </form>
        </div>
      ) : null}
    </header>
  );
}

import { Button } from '@/components/ui/button';
import { logout } from '@/server/actions/auth';
import { requirePage } from '@/server/auth/require-role';
import { AuthFrame } from '../auth-frame';
import { ChangePasswordForm } from './form';

export default async function ChangePasswordPage() {
  const user = await requirePage('VIEWER', { allowPasswordChange: true });

  return (
    <AuthFrame>
      <div className="flex flex-col gap-1.5 pb-6 text-center">
        <h1 className="text-xl font-semibold tracking-tight">비밀번호 변경</h1>
        <p className="text-sm text-muted-foreground">
          {user.mustChangePassword ? '처음 로그인했습니다. 계속하려면 비밀번호를 바꿔야 합니다.' : '새 비밀번호를 입력해 주세요.'}
        </p>
      </div>
      <div className="flex flex-col gap-3">
        {user.hasPassword ? (
          <ChangePasswordForm />
        ) : (
          <p className="text-sm text-muted-foreground">이 계정은 구글 로그인을 사용하므로 비밀번호가 없습니다.</p>
        )}
        <form action={logout}>
          <Button type="submit" variant="ghost" className="w-full text-muted-foreground">
            로그아웃
          </Button>
        </form>
      </div>
    </AuthFrame>
  );
}

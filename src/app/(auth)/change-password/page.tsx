import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { logout } from '@/server/actions/auth';
import { requirePage } from '@/server/auth/require-role';
import { ChangePasswordForm } from './form';

export default async function ChangePasswordPage() {
  const user = await requirePage('VIEWER', { allowPasswordChange: true });

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>비밀번호 변경</CardTitle>
          <CardDescription>
            {user.mustChangePassword
              ? '처음 로그인했습니다. 계속하려면 비밀번호를 바꿔야 합니다.'
              : '새 비밀번호를 입력해 주세요.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {user.hasPassword ? (
            <ChangePasswordForm />
          ) : (
            <p className="text-sm text-muted-foreground">이 계정은 구글 로그인을 사용하므로 비밀번호가 없습니다.</p>
          )}
          <form action={logout}>
            <Button type="submit" variant="ghost" className="w-full">
              로그아웃
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}

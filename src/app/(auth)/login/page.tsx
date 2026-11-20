import { redirect } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { safeCallbackUrl } from '@/lib/validation/auth';
import { signInWithGoogle } from '@/server/actions/auth';
import { getSessionUser } from '@/server/auth/current-user';
import { LoginForm } from './login-form';

// 공개 페이지(requirePage 없음). 이미 로그인했으면 원래 가려던 곳으로 보낸다.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const { callbackUrl: rawCallback, error } = await searchParams;
  const callbackUrl = safeCallbackUrl(rawCallback);
  const user = await getSessionUser();
  if (user) redirect(user.mustChangePassword ? '/change-password' : callbackUrl);

  const localEnabled = process.env.LOCAL_LOGIN_ENABLED === 'true';

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>one-sch 로그인</CardTitle>
          <CardDescription>등록된 계정만 로그인할 수 있습니다.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>등록되지 않았거나 사용할 수 없는 계정입니다.</AlertDescription>
            </Alert>
          ) : null}
          <form action={signInWithGoogle}>
            <input type="hidden" name="callbackUrl" value={callbackUrl} />
            <Button type="submit" variant="outline" className="w-full">
              Google 계정으로 로그인
            </Button>
          </form>
          {localEnabled ? <LoginForm callbackUrl={callbackUrl} /> : null}
        </CardContent>
      </Card>
    </main>
  );
}

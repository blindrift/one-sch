import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { safeCallbackUrl } from '@/lib/validation/auth';
import { signInWithGoogle } from '@/server/actions/auth';
import { getSessionUser } from '@/server/auth/current-user';
import { AuthFrame, GoogleG } from '../auth-frame';
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
    <AuthFrame
      footer={
        <p className="flex justify-center gap-4 text-xs text-text-subtle">
          <Link href="/about" className="hover:text-foreground">
            소개
          </Link>
          <span aria-hidden>·</span>
          <Link href="/privacy" className="hover:text-foreground">
            개인정보처리방침
          </Link>
        </p>
      }
    >
      <div className="flex flex-col gap-1.5 pb-6 text-center">
        <h1 className="text-xl font-semibold tracking-tight">one-sch 로그인</h1>
        <p className="text-sm text-muted-foreground">등록된 계정만 로그인할 수 있습니다.</p>
      </div>
      <div className="flex flex-col gap-5">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>등록되지 않았거나 사용할 수 없는 계정입니다.</AlertDescription>
          </Alert>
        ) : null}
        <form action={signInWithGoogle}>
          <input type="hidden" name="callbackUrl" value={callbackUrl} />
          <Button type="submit" variant="outline" className="h-10 w-full gap-2.5 text-sm">
            <GoogleG />
            Google 계정으로 로그인
          </Button>
        </form>
        {localEnabled ? <LoginForm callbackUrl={callbackUrl} /> : null}
      </div>
    </AuthFrame>
  );
}

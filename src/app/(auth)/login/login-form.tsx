'use client';

import { useActionState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { loginWithPassword } from '@/server/actions/auth';

export function LoginForm({ callbackUrl }: { callbackUrl: string }) {
  const [state, action, pending] = useActionState(loginWithPassword, null);

  return (
    <form action={action} className="flex flex-col gap-3 border-t pt-6">
      <input type="hidden" name="callbackUrl" value={callbackUrl} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="username">아이디</Label>
        <Input id="username" name="username" autoComplete="username" required maxLength={64} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">비밀번호</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required maxLength={128} />
      </div>
      {state && !state.ok ? (
        <Alert variant="destructive" role="alert" data-testid="form-error">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? '확인 중…' : '로그인'}
      </Button>
    </form>
  );
}

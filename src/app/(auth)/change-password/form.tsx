'use client';

import { useActionState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PASSWORD_MAX, PASSWORD_MIN } from '@/lib/validation/limits';
import { changePassword } from '@/server/actions/auth';

const FIELDS = [
  { name: 'currentPassword', label: '현재 비밀번호', autoComplete: 'current-password' },
  { name: 'newPassword', label: '새 비밀번호', autoComplete: 'new-password' },
  { name: 'confirmPassword', label: '새 비밀번호 확인', autoComplete: 'new-password' },
] as const;

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState(changePassword, null);
  const fieldErrors = state && !state.ok ? (state.fieldErrors ?? {}) : {};

  return (
    <form action={action} className="flex flex-col gap-3">
      <ul className="list-disc pl-5 text-xs text-muted-foreground">
        <li>{PASSWORD_MIN}자 이상</li>
        <li>아이디와 &apos;admin&apos; 을 포함할 수 없음</li>
        <li>이전 비밀번호와 달라야 함</li>
      </ul>
      {FIELDS.map((f) => (
        <div key={f.name} className="flex flex-col gap-1.5">
          <Label htmlFor={f.name}>{f.label}</Label>
          <Input
            id={f.name}
            name={f.name}
            type="password"
            autoComplete={f.autoComplete}
            required
            maxLength={PASSWORD_MAX}
            aria-invalid={fieldErrors[f.name] ? true : undefined}
          />
          {fieldErrors[f.name]?.map((m) => (
            <p key={m} className="text-xs text-destructive">
              {m}
            </p>
          ))}
        </div>
      ))}
      {state && !state.ok ? (
        <Alert variant="destructive" role="alert" data-testid="form-error">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? '변경 중…' : '변경'}
      </Button>
    </form>
  );
}

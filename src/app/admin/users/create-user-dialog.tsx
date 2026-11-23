'use client';

import { UserPlus } from 'lucide-react';
import { useState, useTransition } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ROLES, ROLE_LABELS, type Role } from '@/lib/roles';
import { EMAIL_MAX, NAME_MAX } from '@/lib/validation/limits';
import { createUser } from '@/server/actions/user';

export function CreateUserDialog() {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<Role>('VIEWER');
  const [error, setError] = useState<{ message: string; fields: Record<string, string[]> } | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(formData: FormData) {
    startTransition(async () => {
      const result = await createUser({ email: formData.get('email'), name: formData.get('name'), role });
      if (result.ok) {
        setOpen(false);
        setError(null);
        setRole('VIEWER');
      } else {
        setError({ message: result.message, fields: result.fieldErrors ?? {} });
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <UserPlus aria-hidden />
          사용자 등록
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>사용자 등록</DialogTitle>
          <DialogDescription>구글 계정 이메일을 등록하면 그 계정으로 로그인할 수 있습니다.</DialogDescription>
        </DialogHeader>
        <form action={submit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-email">이메일</Label>
            <Input id="new-email" name="email" type="email" required maxLength={EMAIL_MAX} />
            {error?.fields.email?.map((m) => (
              <p key={m} className="text-xs text-destructive">
                {m}
              </p>
            ))}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-name">이름</Label>
            <Input id="new-name" name="name" required maxLength={NAME_MAX} />
            {error?.fields.name?.map((m) => (
              <p key={m} className="text-xs text-destructive">
                {m}
              </p>
            ))}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-role">역할</Label>
            <Select value={role} onValueChange={(v) => setRole(v as Role)}>
              <SelectTrigger id="new-role" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {error ? (
            <Alert variant="destructive" role="alert" data-testid="create-user-error">
              <AlertDescription>{error.message}</AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? '등록 중…' : '등록'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

'use client';

import { Check, UserPlus, X } from 'lucide-react';
import { useState, useTransition } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ROLES, ROLE_LABELS, type Role } from '@/lib/roles';
import { approveUser, rejectUser } from '@/server/actions/user';
import type { ActionResult } from '@/server/action-result';
import type { UserRow } from '@/server/services/user-service';

const dateFmt = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Seoul' });

/** 구글 첫 로그인으로 들어온 가입 신청. 역할을 골라 승인하거나 거부한다. */
export function PendingSignups({ users }: { users: UserRow[] }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [roles, setRoles] = useState<Record<string, Role>>({});

  if (users.length === 0) return null;

  function run(fn: () => Promise<ActionResult<null>>) {
    startTransition(async () => {
      const r = await fn();
      setMessage(r.ok ? null : r.message);
    });
  }

  return (
    <section
      aria-labelledby="pending-signups-title"
      data-testid="pending-signups"
      className="overflow-hidden rounded-xl border border-[color-mix(in_srgb,var(--brand)_35%,transparent)] bg-background shadow-[var(--shadow-sm)]"
    >
      <header className="flex items-center gap-2 border-b border-line bg-brand-soft/60 px-4 py-2.5">
        <UserPlus className="size-4 text-brand" aria-hidden />
        <h2 id="pending-signups-title" className="text-sm font-semibold">
          가입 승인 대기
        </h2>
        <span className="rounded-full bg-brand px-2 py-0.5 text-[11px] font-semibold text-white tabular-nums">{users.length}</span>
        <span className="ml-auto text-xs text-text-subtle">구글로 처음 로그인한 계정입니다. 역할을 골라 승인해 주세요.</span>
      </header>
      {message ? (
        <Alert variant="destructive" role="alert" className="m-3">
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : null}
      <ul className="divide-y divide-line">
        {users.map((u) => {
          const role = roles[u.id] ?? 'VIEWER';
          return (
            <li key={u.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5" data-testid={`pending-row-${u.email}`}>
              <span aria-hidden className="flex size-7 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand">
                {u.name.slice(0, 1)}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium">{u.name}</span>
                <span className="truncate font-mono text-xs text-muted-foreground">{u.email}</span>
              </span>
              <span className="text-xs text-text-subtle tabular-nums">신청 {dateFmt.format(new Date(u.createdAt))}</span>
              <span className="ml-auto flex items-center gap-2">
                <Select value={role} disabled={pending} onValueChange={(r) => setRoles((m) => ({ ...m, [u.id]: r as Role }))}>
                  <SelectTrigger size="sm" aria-label={`${u.name} 승인 역할`} className="w-24">
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
                <Button size="sm" disabled={pending} onClick={() => run(() => approveUser({ userId: u.id, role }))}>
                  <Check aria-hidden />
                  승인
                </Button>
                <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => rejectUser({ userId: u.id }))}>
                  <X aria-hidden />
                  거부
                </Button>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

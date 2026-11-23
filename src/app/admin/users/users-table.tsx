'use client';

import { MoreHorizontal } from 'lucide-react';
import { useState, useTransition } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ROLES, ROLE_LABELS, type Role } from '@/lib/roles';
import {
  resetUserPassword,
  revokeUserSessions,
  setUserActive,
  unlockUser,
  updateUserRole,
} from '@/server/actions/user';
import type { ActionResult } from '@/server/action-result';
import type { UserRow } from '@/server/services/user-service';

const dateFmt = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Seoul' });

export function UsersTable({ users, currentUserId }: { users: UserRow[]; currentUserId: string }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [tempPassword, setTempPassword] = useState<{ name: string; value: string } | null>(null);

  function run<T>(fn: () => Promise<ActionResult<T>>, onOk?: (data: T) => void) {
    startTransition(async () => {
      const r = await fn();
      if (r.ok) {
        setMessage(null);
        onOk?.(r.data);
      } else {
        setMessage(r.message);
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {message ? (
        <Alert variant="destructive" role="alert" data-testid="admin-users-error">
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : null}
      <div className="overflow-hidden rounded-xl border border-line bg-background shadow-[var(--shadow-sm)]">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-4">이름</TableHead>
            <TableHead>계정</TableHead>
            <TableHead>역할</TableHead>
            <TableHead>상태</TableHead>
            <TableHead>마지막 로그인</TableHead>
            <TableHead>세션</TableHead>
            <TableHead className="pr-4 text-right">작업</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((u) => {
            const locked = u.lockedUntil !== null && new Date(u.lockedUntil).getTime() > Date.now();
            const isMe = u.id === currentUserId;
            return (
              <TableRow key={u.id} data-testid={`user-row-${u.email ?? u.username}`}>
                <TableCell className="pl-4">
                  <span className="inline-flex items-center gap-2.5">
                    <span aria-hidden className="flex size-7 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand">
                      {u.name.slice(0, 1)}
                    </span>
                    <span className="font-medium">{u.name}</span>
                    {isMe ? <span className="text-xs text-text-subtle">(나)</span> : null}
                  </span>
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{u.email ?? `${u.username} (로컬)`}</TableCell>
                <TableCell>
                  <Select
                    value={u.role}
                    // 자기 역할은 서버에서도 거부한다(바꾸면 즉시 로그아웃되므로 다른 관리자가 하게).
                    disabled={pending || isMe}
                    onValueChange={(role) => run(() => updateUserRole({ userId: u.id, role: role as Role }))}
                  >
                    <SelectTrigger size="sm" aria-label={`${u.name} 역할`}>
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
                </TableCell>
                <TableCell>
                  <span className="inline-flex gap-1">
                  {u.active ? (
                    <Badge variant="secondary" className="gap-1.5 bg-[color-mix(in_srgb,var(--status-done)_12%,transparent)] text-status-done">
                      <span className="size-1.5 rounded-full bg-status-done" aria-hidden />
                      활성
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground">
                      비활성
                    </Badge>
                  )}
                  {locked ? <Badge variant="destructive">잠김</Badge> : null}
                  </span>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground tabular-nums">{u.lastLoginAt ? dateFmt.format(new Date(u.lastLoginAt)) : '-'}</TableCell>
                <TableCell className="tabular-nums">{u.sessionCount}</TableCell>
                <TableCell className="pr-4 text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" disabled={pending} aria-label={`${u.name} 작업`}>
                        <MoreHorizontal aria-hidden />
                        작업
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => run(() => revokeUserSessions({ userId: u.id }))}>
                        세션 종료
                      </DropdownMenuItem>
                      {locked ? (
                        <DropdownMenuItem onSelect={() => run(() => unlockUser({ userId: u.id }))}>잠금 해제</DropdownMenuItem>
                      ) : null}
                      {!isMe ? (
                        <DropdownMenuItem onSelect={() => run(() => setUserActive({ userId: u.id, active: !u.active }))}>
                          {u.active ? '비활성화' : '활성화'}
                        </DropdownMenuItem>
                      ) : null}
                      {u.hasPassword && !isMe ? (
                        <DropdownMenuItem
                          onSelect={() =>
                            run(
                              () => resetUserPassword({ userId: u.id }),
                              (d) => setTempPassword({ name: u.name, value: d.temporaryPassword }),
                            )
                          }
                        >
                          비밀번호 초기화
                        </DropdownMenuItem>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      </div>

      <Dialog open={tempPassword !== null} onOpenChange={(v) => !v && setTempPassword(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>임시 비밀번호</DialogTitle>
            <DialogDescription>
              {tempPassword?.name} 계정의 임시 비밀번호입니다. 이 창을 닫으면 다시 볼 수 없습니다. 다음 로그인 때 변경해야
              합니다.
            </DialogDescription>
          </DialogHeader>
          <p className="rounded-md bg-muted p-3 text-center font-mono text-lg select-all" data-testid="temp-password">
            {tempPassword?.value}
          </p>
          <DialogFooter>
            <Button onClick={() => setTempPassword(null)}>닫기</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

'use client';

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
        <Alert variant="destructive" role="alert">
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : null}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>이름</TableHead>
            <TableHead>계정</TableHead>
            <TableHead>역할</TableHead>
            <TableHead>상태</TableHead>
            <TableHead>마지막 로그인</TableHead>
            <TableHead>세션</TableHead>
            <TableHead className="text-right">작업</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((u) => {
            const locked = u.lockedUntil !== null && new Date(u.lockedUntil).getTime() > Date.now();
            const isMe = u.id === currentUserId;
            return (
              <TableRow key={u.id} data-testid={`user-row-${u.email ?? u.username}`}>
                <TableCell>
                  {u.name}
                  {isMe ? <span className="ml-1 text-xs text-muted-foreground">(나)</span> : null}
                </TableCell>
                <TableCell className="font-mono text-xs">{u.email ?? `${u.username} (로컬)`}</TableCell>
                <TableCell>
                  <Select
                    value={u.role}
                    disabled={pending}
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
                <TableCell className="flex gap-1">
                  {u.active ? <Badge variant="secondary">활성</Badge> : <Badge variant="outline">비활성</Badge>}
                  {locked ? <Badge variant="destructive">잠김</Badge> : null}
                </TableCell>
                <TableCell className="text-xs">{u.lastLoginAt ? dateFmt.format(new Date(u.lastLoginAt)) : '-'}</TableCell>
                <TableCell>{u.sessionCount}</TableCell>
                <TableCell className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" disabled={pending} aria-label={`${u.name} 작업`}>
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

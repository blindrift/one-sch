'use client';

import { Archive, ArchiveRestore } from 'lucide-react';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { cn } from 'cn';
import { ProjectStatusBadge } from '@/components/project-status-badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { UserOption } from '@/lib/schedule/dto';
import { setProjectArchived } from '@/server/actions/project';
import type { ProjectListItem } from '@/server/services/timeline-service';
import { ProjectFormDialog } from './project-form-dialog';

function period(p: ProjectListItem) {
  if (!p.startDate && !p.endDate) return <span className="text-text-subtle">—</span>;
  return `${p.startDate ?? ''} ~ ${p.endDate ?? ''}`;
}

export function ProjectsTable({ projects, users, canEdit }: { projects: ProjectListItem[]; users: UserOption[]; canEdit: boolean }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function toggleArchive(p: ProjectListItem) {
    startTransition(async () => {
      const r = await setProjectArchived({ id: p.id, version: p.version, archived: !p.archived });
      setMessage(r.ok ? null : r.message);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {message ? (
        <Alert variant="destructive" role="alert" data-testid="projects-error">
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : null}
      <div className="overflow-hidden rounded-xl border border-line bg-background shadow-[var(--shadow-sm)]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-24 pl-4">키</TableHead>
              <TableHead>이름</TableHead>
              <TableHead>상태</TableHead>
              <TableHead>기간</TableHead>
              <TableHead>책임자</TableHead>
              <TableHead className="text-right">작업</TableHead>
              {canEdit ? <TableHead className="pr-4 text-right">관리</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {projects.length === 0 ? (
              <TableRow>
                <TableCell colSpan={canEdit ? 7 : 6} className="py-12 text-center text-muted-foreground">
                  프로젝트가 없습니다.
                </TableCell>
              </TableRow>
            ) : null}
            {projects.map((p) => (
              <TableRow key={p.id} data-testid={`project-row-${p.key}`} className={cn('group', p.archived && 'bg-surface-sunken text-muted-foreground')}>
                <TableCell className={cn('pl-4 font-mono text-xs', p.archived ? 'text-text-subtle' : 'text-muted-foreground')}>{p.key}</TableCell>
                <TableCell>
                  <div className={cn('flex items-center gap-2.5', p.archived && 'opacity-60')}>
                    <span className="size-3 shrink-0 rounded-[4px]" style={{ background: p.color }} aria-hidden />
                    <Link href={`/projects/${p.key}`} className="font-medium underline-offset-4 hover:text-brand hover:underline">
                      {p.name}
                    </Link>
                    {p.archived ? (
                      <Badge variant="secondary" className="ml-0.5">
                        보관
                      </Badge>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className={p.archived ? 'opacity-60' : undefined}>
                  <ProjectStatusBadge status={p.status} />
                </TableCell>
                <TableCell className="text-xs tabular-nums">{period(p)}</TableCell>
                <TableCell>
                  <span className="inline-flex items-center gap-2">
                    <span aria-hidden className="flex size-5 items-center justify-center rounded-full bg-brand-soft text-[10px] font-semibold text-brand">
                      {p.ownerName.slice(0, 1)}
                    </span>
                    {p.ownerName}
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums">{p.taskCount}</TableCell>
                {canEdit ? (
                  <TableCell className="pr-4">
                    <div className="flex justify-end gap-1.5">
                      {p.archived ? null : <ProjectFormDialog mode="edit" users={users} project={p} />}
                      <Button variant="ghost" size="sm" disabled={pending} onClick={() => toggleArchive(p)} aria-label={`${p.key} ${p.archived ? '보관 해제' : '보관'}`}>
                        {p.archived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
                        {p.archived ? '보관 해제' : '보관'}
                      </Button>
                    </div>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { UserOption } from '@/lib/schedule/dto';
import { PROJECT_STATUS_LABELS } from '@/lib/schedule/status';
import { setProjectArchived } from '@/server/actions/project';
import type { ProjectListItem } from '@/server/services/timeline-service';
import { ProjectFormDialog } from './project-form-dialog';

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
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>키</TableHead>
            <TableHead>이름</TableHead>
            <TableHead>상태</TableHead>
            <TableHead>기간</TableHead>
            <TableHead>책임자</TableHead>
            <TableHead>작업</TableHead>
            {canEdit ? <TableHead className="text-right">관리</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {projects.length === 0 ? (
            <TableRow>
              <TableCell colSpan={canEdit ? 7 : 6} className="text-center text-muted-foreground">
                프로젝트가 없습니다.
              </TableCell>
            </TableRow>
          ) : null}
          {projects.map((p) => (
            <TableRow key={p.id} data-testid={`project-row-${p.key}`} className={p.archived ? 'opacity-60' : undefined}>
              <TableCell className="font-mono">
                <Link href={`/projects/${p.key}`} className="underline-offset-4 hover:underline">
                  {p.key}
                </Link>
              </TableCell>
              <TableCell>
                <span className="mr-2 inline-block size-3 rounded-sm align-middle" style={{ background: p.color }} aria-hidden />
                {p.name}
                {p.archived ? (
                  <Badge variant="secondary" className="ml-2">
                    보관
                  </Badge>
                ) : null}
              </TableCell>
              <TableCell>{PROJECT_STATUS_LABELS[p.status]}</TableCell>
              <TableCell className="text-sm">{p.startDate || p.endDate ? `${p.startDate ?? ''} ~ ${p.endDate ?? ''}` : '—'}</TableCell>
              <TableCell>{p.ownerName}</TableCell>
              <TableCell>{p.taskCount}</TableCell>
              {canEdit ? (
                <TableCell className="space-x-2 text-right">
                  {p.archived ? null : <ProjectFormDialog mode="edit" users={users} project={p} />}
                  <Button variant="ghost" size="sm" disabled={pending} onClick={() => toggleArchive(p)} aria-label={`${p.key} ${p.archived ? '보관 해제' : '보관'}`}>
                    {p.archived ? '보관 해제' : '보관'}
                  </Button>
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

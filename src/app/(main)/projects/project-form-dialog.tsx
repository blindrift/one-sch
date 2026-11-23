'use client';

import { Pencil, Plus } from 'lucide-react';
import { useState, useTransition } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { ProjectDto, UserOption } from '@/lib/schedule/dto';
import { PROJECT_STATUSES, PROJECT_STATUS_LABELS, type ProjectStatus } from '@/lib/schedule/status';
import { PROJECT_NAME_MAX } from '@/lib/validation/limits';
import { createProject, updateProject } from '@/server/actions/project';

type Props =
  | { mode: 'create'; users: UserOption[]; defaultOwnerId: string; project?: undefined }
  | { mode: 'edit'; users: UserOption[]; project: ProjectDto; defaultOwnerId?: undefined };

const DEFAULT_COLOR = '#7b68ee';

function FieldErrors({ errors }: { errors?: string[] }) {
  return errors?.map((m) => (
    <p key={m} className="text-xs text-destructive">
      {m}
    </p>
  ));
}

export function ProjectFormDialog(props: Props) {
  const { mode, users, project } = props;
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<ProjectStatus>(project?.status ?? 'PLANNED');
  const [ownerId, setOwnerId] = useState<string>(project?.ownerId ?? props.defaultOwnerId ?? '');
  const [error, setError] = useState<{ message: string; fields: Record<string, string[]> } | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(fd: FormData) {
    const common = {
      name: fd.get('name'),
      color: fd.get('color'),
      status,
      startDate: fd.get('startDate'),
      endDate: fd.get('endDate'),
      ownerId,
    };
    startTransition(async () => {
      const result =
        mode === 'create'
          ? await createProject({ ...common, key: fd.get('key') })
          : await updateProject({ ...common, id: project.id, version: project.version });
      if (result.ok) {
        setOpen(false);
        setError(null);
      } else {
        setError({ message: result.message, fields: result.fieldErrors ?? {} });
      }
    });
  }

  const title = mode === 'create' ? '프로젝트 만들기' : `프로젝트 수정 — ${project.key}`;
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setError(null);
        if (v) {
          setStatus(project?.status ?? 'PLANNED');
          setOwnerId(project?.ownerId ?? props.defaultOwnerId ?? '');
        }
      }}
    >
      <DialogTrigger asChild>
        {mode === 'create' ? (
          <Button>
            <Plus aria-hidden />
            프로젝트 만들기
          </Button>
        ) : (
          <Button variant="outline" size="sm" aria-label={`${project.key} 수정`}>
            <Pencil aria-hidden />
            수정
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>키는 만든 뒤 바꿀 수 없습니다(이슈 번호에 쓰입니다).</DialogDescription>
        </DialogHeader>
        <form action={submit} className="flex flex-col gap-3">
          {mode === 'create' ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="project-key">키</Label>
              <Input id="project-key" name="key" required maxLength={10} placeholder="예: ERP" className="uppercase" />
              <FieldErrors errors={error?.fields.key} />
            </div>
          ) : null}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="project-name">이름</Label>
            <Input id="project-name" name="name" required maxLength={PROJECT_NAME_MAX} defaultValue={project?.name} />
            <FieldErrors errors={error?.fields.name} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="project-color">색</Label>
              <Input id="project-color" name="color" type="color" defaultValue={project?.color ?? DEFAULT_COLOR} className="h-8 cursor-pointer p-1" />
              <FieldErrors errors={error?.fields.color} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="project-status">상태</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as ProjectStatus)}>
                <SelectTrigger id="project-status" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROJECT_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {PROJECT_STATUS_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="project-start">시작일</Label>
              <Input id="project-start" name="startDate" type="date" min="2000-01-01" max="2100-12-31" defaultValue={project?.startDate ?? ''} />
              <FieldErrors errors={error?.fields.startDate} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="project-end">종료일</Label>
              <Input id="project-end" name="endDate" type="date" min="2000-01-01" max="2100-12-31" defaultValue={project?.endDate ?? ''} />
              <FieldErrors errors={error?.fields.endDate} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="project-owner">책임자</Label>
            <Select value={ownerId} onValueChange={setOwnerId}>
              <SelectTrigger id="project-owner" className="w-full">
                <SelectValue placeholder="선택" />
              </SelectTrigger>
              <SelectContent>
                {users.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldErrors errors={error?.fields.ownerId} />
          </div>
          {error ? (
            <Alert variant="destructive" role="alert" data-testid="project-form-error">
              <AlertDescription>{error.message}</AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? '저장 중…' : '저장'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

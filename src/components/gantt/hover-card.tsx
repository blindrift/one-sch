'use client';

// 막대에 마우스를 올렸을 때 보이는 정보 카드의 내용. 위치·표시 시점은 gantt-chart 가 맡는다.
import { daysInclusive } from '@/lib/dates';
import type { DependencyDto, ProjectDto, TaskDto, UserOption } from '@/lib/schedule/dto';
import { isLate } from '@/lib/schedule/rollup';
import { PROJECT_STATUS_LABELS, TASK_STATUS_COLORS, TASK_STATUS_LABELS } from '@/lib/schedule/status';
import { isHttpUrl } from '@/lib/validation/limits';
import { avatarColor, initials } from './cells';

export type HoverSource = {
  task(id: string): TaskDto | undefined;
  project(id: string): ProjectDto | undefined;
  users: readonly UserOption[];
  deps: readonly DependencyDto[];
  childCount(id: string): number;
  today: string;
  canEdit: boolean;
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="og-hc-row">
      <span className="og-hc-label">{label}</span>
      <span className="og-hc-value">{children}</span>
    </div>
  );
}

function Period({ start, end, milestone }: { start: string; end: string; milestone: boolean }) {
  if (milestone) return <>{start} · 마일스톤</>;
  const days = daysInclusive(start, end);
  return (
    <>
      {start === end ? start : `${start} ~ ${end}`} <span className="og-hc-muted">({days}일)</span>
    </>
  );
}

function Progress({ value }: { value: number }) {
  return (
    <span className="og-hc-progress">
      <span className="og-hc-progress-track">
        <span className="og-hc-progress-fill" style={{ width: `${value}%` }} />
      </span>
      {value}%
    </span>
  );
}

/** 작업 카드 */
export function TaskHoverCard({ task, src }: { task: TaskDto; src: HoverSource }) {
  const project = src.project(task.projectId);
  const assignee = task.assigneeId ? src.users.find((u) => u.id === task.assigneeId) : undefined;
  const parent = task.parentId ? src.task(task.parentId) : undefined;
  const late = !task.hasChildren && isLate(task, src.today);
  const lateDays = late ? daysInclusive(task.endDate, src.today) - 1 : 0;
  const preds = src.deps.filter((d) => d.toTaskId === task.id).length;
  const succs = src.deps.filter((d) => d.fromTaskId === task.id).length;
  const children = task.hasChildren ? src.childCount(task.id) : 0;
  const url = task.url && isHttpUrl(task.url) ? task.url : null;
  const readonly = !!project?.archived;

  return (
    <div className="og-hc" data-testid="hover-card">
      <div className="og-hc-project">
        <span className="og-hc-dot" style={{ background: project?.color }} />
        {project ? `[${project.key}] ${project.name}` : ''}
        {parent ? <span className="og-hc-muted"> › {parent.title}</span> : null}
      </div>
      <div className="og-hc-title">{task.title}</div>
      <div className="og-hc-badges">
        <span className="og-hc-badge" style={{ '--c': TASK_STATUS_COLORS[task.status] } as React.CSSProperties}>
          <span className="og-hc-badge-dot" />
          {TASK_STATUS_LABELS[task.status]}
        </span>
        {late ? <span className="og-hc-badge og-hc-late">지연 {lateDays}일</span> : null}
        {task.isMilestone ? <span className="og-hc-badge og-hc-plain">◆ 마일스톤</span> : null}
        {task.hasChildren ? <span className="og-hc-badge og-hc-plain">하위 {children}개 · 자동 계산</span> : null}
      </div>
      <div className="og-hc-rows">
        <Row label="기간">
          <Period start={task.startDate} end={task.endDate} milestone={task.isMilestone} />
        </Row>
        <Row label="진행률">
          <Progress value={task.progress} />
        </Row>
        <Row label="담당자">
          {assignee ? (
            <span className="og-hc-person">
              <span className="og-hc-avatar" style={{ background: avatarColor(assignee.id) }}>
                {initials(assignee.name)}
              </span>
              {assignee.name}
            </span>
          ) : (
            <span className="og-hc-muted">없음</span>
          )}
        </Row>
        {preds || succs ? (
          <Row label="의존">
            {preds ? `선행 ${preds}` : ''}
            {preds && succs ? ' · ' : ''}
            {succs ? `후행 ${succs}` : ''}
          </Row>
        ) : null}
        {url ? (
          <Row label="링크">
            <a className="og-hc-link" href={url} target="_blank" rel="noopener noreferrer" data-testid="hover-card-url">
              {url.replace(/^https?:\/\//, '')}
            </a>
          </Row>
        ) : null}
      </div>
      {task.memo ? (
        <div className="og-hc-memo" data-testid="hover-card-memo">
          {task.memo}
        </div>
      ) : null}
      <div className="og-hc-hint">{readonly ? '보관된 프로젝트 · 읽기 전용' : src.canEdit ? '더블클릭하여 수정 · 끌어서 일정 변경' : '읽기 전용'}</div>
    </div>
  );
}

/** 프로젝트 행 카드 */
export function ProjectHoverCard({ project, tasks, src }: { project: ProjectDto; tasks: readonly TaskDto[]; src: HoverSource }) {
  const mine = tasks.filter((t) => t.projectId === project.id);
  const leaves = mine.filter((t) => !t.hasChildren);
  const done = leaves.filter((t) => t.status === 'DONE').length;
  const late = leaves.filter((t) => isLate(t, src.today)).length;
  const start = mine.reduce<string | null>((m, t) => (!m || t.startDate < m ? t.startDate : m), null) ?? project.startDate;
  const end = mine.reduce<string | null>((m, t) => (!m || t.endDate > m ? t.endDate : m), null) ?? project.endDate;
  return (
    <div className="og-hc" data-testid="hover-card">
      <div className="og-hc-project">
        <span className="og-hc-dot" style={{ background: project.color }} />
        프로젝트 · {PROJECT_STATUS_LABELS[project.status]}
        {project.archived ? ' · 보관' : ''}
      </div>
      <div className="og-hc-title">
        [{project.key}] {project.name}
      </div>
      <div className="og-hc-rows">
        {start && end ? (
          <Row label="기간">
            <Period start={start} end={end} milestone={false} />
          </Row>
        ) : null}
        <Row label="작업">
          {leaves.length}개 · 완료 {done}
          {late ? <span className="og-hc-late-text"> · 지연 {late}</span> : null}
        </Row>
      </div>
    </div>
  );
}

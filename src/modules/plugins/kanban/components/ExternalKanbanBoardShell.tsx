import React from 'react';
import { Button, Chip } from '@heroui/react';
import type { ExternalKanbanBoardViewDto, ExternalKanbanCardDto, ExternalKanbanColumnDto, ExternalKanbanRelatedWorkspaceDto } from '../boardTypes';

export function ExternalKanbanBoardShell({
  children,
  sidePanel,
  overlays,
}: {
  children: React.ReactNode;
  sidePanel?: React.ReactNode;
  overlays?: React.ReactNode;
}) {
  return (
    <main className="dark h-dvh overflow-y-auto overscroll-contain bg-neutral-950 text-neutral-100">
      <div className="flex min-h-full flex-col lg:flex-row">
        <div className="min-w-0 flex-1">{children}</div>
        {sidePanel ?? null}
      </div>
      {overlays ?? null}
    </main>
  );
}

export function ExternalKanbanColumns({
  columns,
  cards,
  renderCard,
  emptyLabel = 'No issues',
}: {
  columns: ExternalKanbanColumnDto[];
  cards: ExternalKanbanCardDto[];
  renderCard: (card: ExternalKanbanCardDto) => React.ReactNode;
  emptyLabel?: string;
}) {
  const renderColumns = withImplicitUnmappedColumn(columns, cards);
  const knownColumnIds = new Set(renderColumns.map((column) => column.id));
  return (
    <div className="grid auto-cols-[minmax(18rem,1fr)] grid-flow-col gap-4 overflow-x-auto pb-2">
      {renderColumns.map((column) => {
        const columnCards = cards.filter((card) => isCardInColumn(card, column, knownColumnIds));
        return (
          <section key={column.id} className="min-w-72 rounded-xl border border-neutral-800 bg-neutral-900/80">
            <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
              <h3 className="text-sm font-semibold text-neutral-100">{column.title}</h3>
              <Chip size="sm" variant="flat" className="bg-neutral-800 text-neutral-300">{columnCards.length}</Chip>
            </div>
            <div className="space-y-3 p-3">
              {columnCards.length === 0 ? <div className="rounded-lg border border-dashed border-neutral-800 p-3 text-sm text-neutral-500">{emptyLabel}</div> : null}
              {columnCards.map((card) => <React.Fragment key={card.id}>{renderCard(card)}</React.Fragment>)}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export function ExternalKanbanSingleIssuePage({
  boardView,
  card,
  providerLabel,
  providerColorClassName = 'bg-neutral-800 text-neutral-200',
  openInProviderLabel = 'Open in provider',
  onCreateWorkspace,
  onOpenWorkspacePanel,
}: {
  boardView: ExternalKanbanBoardViewDto;
  card: ExternalKanbanCardDto;
  providerLabel: string;
  providerColorClassName?: string;
  openInProviderLabel?: string;
  onCreateWorkspace?: (card: ExternalKanbanCardDto) => void;
  onOpenWorkspacePanel?: (workspace: ExternalKanbanRelatedWorkspaceDto) => void;
}) {
  const workspaceCount = card.relatedWorkspaces?.length ?? 0;
  const taskSummary = getTaskSummary(card);
  return (
    <main className="min-h-full px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-5xl flex-col gap-5">
        <header className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <Chip size="sm" variant="flat" className={providerColorClassName}>{providerLabel}</Chip>
            <Chip size="sm" variant="flat" className="bg-neutral-800 text-neutral-300">Single issue</Chip>
            <Chip size="sm" variant="flat" className="bg-neutral-800 text-neutral-300">Read-only</Chip>
          </div>
          <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded bg-neutral-800 px-2 py-0.5 font-mono text-sm font-semibold text-neutral-100">{card.key}</span>
                {card.statusName ? <span className="rounded bg-neutral-800 px-2 py-0.5 text-xs text-neutral-300">{card.statusName}</span> : null}
                {card.priority ? <span className="rounded bg-neutral-800 px-2 py-0.5 text-xs text-neutral-300">{card.priority}</span> : null}
              </div>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-neutral-50">{card.title}</h1>
              <p className="mt-2 text-sm text-neutral-400">{boardView.siteHostname} · {boardView.board.name ?? boardView.resource.name}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {workspaceCount === 0 ? (
                <Button
                  color="primary"
                  variant="flat"
                  isDisabled={!onCreateWorkspace}
                  onPress={() => onCreateWorkspace?.(card)}
                >
                  Create Workspace
                </Button>
              ) : null}
              <Button as="a" href={card.url} target="_blank" rel="noreferrer" variant="flat">{openInProviderLabel}</Button>
            </div>
          </div>
        </header>

        <section className="grid gap-3 rounded-2xl border border-neutral-800 bg-neutral-900/60 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <DetailStat label="Assignee" value={card.assignee?.displayName ?? 'Unassigned'} />
          <DetailStat label="Workspace" value={workspaceCount === 0 ? 'None' : workspaceCount === 1 ? 'Existing workspace' : `${workspaceCount} linked workspaces`} />
          <DetailStat label="Tasks" value={`${taskSummary.completed}/${taskSummary.total} tasks complete`} />
          <DetailStat label="Source" value={boardView.resource.name} />
        </section>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-5">
          <h2 className="text-sm font-semibold text-neutral-200">Related workspaces</h2>
          {card.relatedWorkspaces?.length ? (
            <div className="mt-3 grid gap-3">
              {card.relatedWorkspaces.map((workspace) => {
                const metrics = workspaceMetrics(workspace);
                return (
                  <article key={workspace.workspaceId} className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-emerald-50">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="font-medium">{workspace.displayName || workspace.workspaceId}{workspace.isPrimary ? <span className="ml-2 text-xs text-emerald-300">Primary</span> : null}</div>
                        {workspace.workspaceDir ? <div className="mt-1 truncate text-xs text-emerald-200/70">{workspace.workspaceDir}</div> : null}
                        <div className="mt-2 flex flex-wrap gap-2 text-xs text-emerald-100/80">
                          <span>{metrics.filesChanged}</span>
                          <span>{metrics.linesChanged}</span>
                          <span>{metrics.agentSessions}</span>
                          <span>{metrics.agentMessages}</span>
                        </div>
                      </div>
                      {onOpenWorkspacePanel ? (
                        <Button size="sm" variant="flat" onPress={() => onOpenWorkspacePanel(workspace)}>Open Workspace</Button>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="mt-3 rounded-xl border border-dashed border-neutral-800 p-4">
              <p className="text-sm text-neutral-400">No existing workspace is associated with this issue.</p>
              <Button className="mt-3" color="primary" variant="flat" isDisabled={!onCreateWorkspace} onPress={() => onCreateWorkspace?.(card)}>Create Workspace</Button>
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-5">
          <h2 className="text-sm font-semibold text-neutral-200">Related tasks</h2>
          {card.relatedBeads?.length ? (
            <ul className="mt-3 space-y-2">
              {card.relatedBeads.map((task) => (
                <li key={task.id} className="rounded-lg border border-sky-500/20 bg-sky-500/10 px-3 py-2 text-sm text-sky-100">
                  <div className="font-medium">{task.id}: {task.title}</div>
                  {task.status ? <div className="mt-1 text-xs text-sky-200/70">Status: {task.status}</div> : null}
                </li>
              ))}
            </ul>
          ) : <p className="mt-2 text-sm text-neutral-400">No tasks have been created for this issue yet.</p>}
        </section>

        {card.labels.length ? (
          <section className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-5">
            <h2 className="text-sm font-semibold text-neutral-200">Provider metadata</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {card.labels.map((label) => <span key={label} className="rounded bg-neutral-800 px-2 py-0.5 text-xs text-neutral-300">{label}</span>)}
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}

function withImplicitUnmappedColumn(columns: ExternalKanbanColumnDto[], cards: ExternalKanbanCardDto[]): ExternalKanbanColumnDto[] {
  const knownColumnIds = new Set(columns.map((column) => column.id));
  if (knownColumnIds.has('unmapped')) return columns;
  const needsUnmapped = cards.some((card) => {
    if (card.columnId) return !knownColumnIds.has(card.columnId);
    if (card.statusId) return !columns.some((column) => column.statusIds.includes(card.statusId as string));
    return true;
  });
  if (!needsUnmapped) return columns;
  return [...columns, { id: 'unmapped', title: 'Unmapped', statusIds: [] }];
}

function isCardInColumn(card: ExternalKanbanCardDto, column: ExternalKanbanColumnDto, knownColumnIds: Set<string>): boolean {
  if (card.columnId) {
    if (knownColumnIds.has(card.columnId)) return card.columnId === column.id;
    return column.id === 'unmapped';
  }
  if (card.statusId && column.statusIds.includes(card.statusId)) return true;
  return column.id === 'unmapped';
}

function DetailStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="mt-1 text-sm text-neutral-200">{value}</div>
    </div>
  );
}

function getTaskSummary(card: ExternalKanbanCardDto): { total: number; completed: number } {
  const tasks = card.relatedBeads ?? [];
  return {
    total: tasks.length,
    completed: tasks.filter((task) => isCompletedTaskStatus(task.status)).length,
  };
}

function isCompletedTaskStatus(status?: string): boolean {
  if (!status) return false;
  return ['closed', 'complete', 'completed', 'done', 'resolved'].includes(status.toLowerCase());
}

function workspaceMetrics(workspace: ExternalKanbanRelatedWorkspaceDto): { filesChanged: string; linesChanged: string; agentSessions: string; agentMessages: string } {
  const metadata = workspace.metadata ?? {};
  return {
    filesChanged: metricLabel(metadata.filesChanged, 'file', 'files', 'changed'),
    linesChanged: metricLabel(metadata.linesChanged, 'line', 'lines', 'changed'),
    agentSessions: metricLabel(metadata.agentSessions, 'agent session', 'agent sessions'),
    agentMessages: metricLabel(metadata.agentMessages, 'agent message', 'agent messages'),
  };
}

function metricLabel(value: unknown, singular: string, plural: string, suffix?: string): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return `${suffix ? `— ${plural}` : `— ${plural}`}`;
  const noun = value === 1 ? singular : plural;
  return suffix ? `${value} ${noun} ${suffix}` : `${value} ${noun}`;
}

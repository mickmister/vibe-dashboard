import React, { useEffect, useMemo, useState } from 'react';
import { Button, Card, CardBody, Chip, Spinner, Switch } from '@heroui/react';
import type { ExternalKanbanCardDto, ExternalKanbanRelatedWorkspaceDto } from '../../boardTypes';
import { ExternalKanbanBoardShell, ExternalKanbanColumns } from '../../components/ExternalKanbanBoardShell';
import { fetchExternalBeadsBoardView, type ExternalBeadsBoardApiResponse, type ExternalBeadsBoardViewDto } from '../externalTrackerBoardApi';

export function ExternalBeadsBoardRoute({ sourceDirectory }: { sourceDirectory?: string }) {
  const [showCompleted, setShowCompleted] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  return (
    <ExternalBeadsBoardLoader
      sourceDirectory={sourceDirectory}
      showCompleted={showCompleted}
      refreshToken={refreshToken}
      onShowCompletedChange={setShowCompleted}
      onRefresh={() => setRefreshToken((token) => token + 1)}
    />
  );
}

export function ExternalBeadsBoardLoader({
  sourceDirectory,
  showCompleted,
  refreshToken,
  onShowCompletedChange,
  onRefresh,
}: {
  sourceDirectory?: string;
  showCompleted: boolean;
  refreshToken: number;
  onShowCompletedChange: (showCompleted: boolean) => void;
  onRefresh: () => void;
}) {
  const [response, setResponse] = useState<ExternalBeadsBoardApiResponse | undefined>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchExternalBeadsBoardView({ sourceDirectory, showCompleted, refresh: refreshToken > 0 })
      .then((nextResponse) => {
        if (!cancelled) setResponse(nextResponse);
      })
      .catch(() => {
        if (!cancelled) {
          setResponse({
            ok: false,
            error: {
              code: 'beads_board_load_failed',
              message: 'Could not load Beads workflow.',
              userAction: 'Verify this repository has Beads initialized and try again.',
            },
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sourceDirectory, showCompleted, refreshToken]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-950 text-neutral-100">
        <Spinner color="primary" label="Loading Beads workflow…" />
      </div>
    );
  }

  if (!response) return null;
  if (!response.ok) {
    return <BeadsMessage title={response.error.message} message={response.error.userAction} />;
  }

  return (
    <ExternalBeadsBoardContent
      boardView={response.boardView}
      showCompleted={showCompleted}
      onShowCompletedChange={onShowCompletedChange}
      onRefresh={onRefresh}
    />
  );
}

export function ExternalBeadsBoardContent({
  boardView,
  showCompleted,
  onShowCompletedChange,
  onRefresh,
}: {
  boardView: ExternalBeadsBoardViewDto;
  showCompleted: boolean;
  onShowCompletedChange: (showCompleted: boolean) => void;
  onRefresh: () => void;
}) {
  const [sidePanelWorkspaceId, setSidePanelWorkspaceId] = useState<string | undefined>();
  const sortedCards = useMemo(() => [...boardView.cards].sort((left, right) => left.rank - right.rank), [boardView.cards]);
  const sidePanel = sidePanelWorkspaceId ? (
    <aside className="min-h-[60vh] border-t border-neutral-800 bg-neutral-950 lg:border-l lg:border-t-0 lg:min-w-[360px] lg:basis-[36vw]">
      <div className="flex items-center justify-between border-b border-neutral-800 p-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-neutral-500">VK workspace</p>
          <p className="text-sm font-medium text-neutral-100">{sidePanelWorkspaceId}</p>
        </div>
        <Button size="sm" variant="flat" onPress={() => setSidePanelWorkspaceId(undefined)}>Close</Button>
      </div>
      <iframe
        title="VK workspace session"
        src={`/dashboard/workspaces/${encodeURIComponent(sidePanelWorkspaceId)}`}
        className="h-[70vh] w-full lg:h-[calc(100vh-57px)]"
      />
    </aside>
  ) : undefined;

  return (
    <ExternalKanbanBoardShell sidePanel={sidePanel}>
      <div className="flex min-h-full flex-col gap-4 p-4 lg:p-6">
        <header className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <Chip size="sm" variant="flat" className="bg-orange-500/15 text-orange-200">Beads</Chip>
                <Chip size="sm" variant="flat" className="bg-neutral-800 text-neutral-300">Read-only</Chip>
              </div>
              <h1 className="mt-3 text-2xl font-semibold text-neutral-50">{boardView.board.name ?? 'Beads workflow'}</h1>
              <p className="mt-1 text-sm text-neutral-400">{boardView.resource.sourceDirectory}</p>
              <p className="mt-2 text-xs text-neutral-500">
                {boardView.pagination.issueCount} visible beads · refreshed {boardView.diagnostics?.lastFetchedAt ?? 'unknown'}
                {boardView.diagnostics?.cache === 'stale' ? ' · showing stale data after refresh error' : null}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Switch isSelected={showCompleted} onValueChange={onShowCompletedChange} size="sm">Show closed/done</Switch>
              <Button size="sm" variant="flat" onPress={onRefresh}>Refresh</Button>
            </div>
          </div>
        </header>

        {sortedCards.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-neutral-800 p-6 text-sm text-neutral-400">
            No visible beads match this view. Turn on closed/done beads or refresh if you expected work here.
          </div>
        ) : (
          <ExternalKanbanColumns
            columns={boardView.columns}
            cards={sortedCards}
            emptyLabel="No beads"
            renderCard={(card) => (
              <BeadsCard
                card={card}
                onOpenWorkspace={(workspace) => setSidePanelWorkspaceId(workspace.workspaceId)}
              />
            )}
          />
        )}
      </div>
    </ExternalKanbanBoardShell>
  );
}

export function BeadsCard({
  card,
  onOpenWorkspace,
}: {
  card: ExternalKanbanCardDto;
  onOpenWorkspace: (workspace: ExternalKanbanRelatedWorkspaceDto) => void;
}) {
  const dependencyCount = numberMetadata(card.metadata.dependencyCount);
  const dependentCount = numberMetadata(card.metadata.dependentCount);
  const workspace = card.relatedWorkspaces?.[0];
  return (
    <Card className="border border-neutral-800 bg-neutral-950/80" shadow="none">
      <CardBody className="gap-3 p-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded bg-neutral-800 px-2 py-0.5 font-mono font-semibold text-neutral-200">{card.key}</span>
          {card.priority ? <span className="rounded bg-neutral-800 px-2 py-0.5 text-neutral-300">P{card.priority}</span> : null}
          {card.assignee?.displayName ? <span className="rounded bg-neutral-800 px-2 py-0.5 text-neutral-300">{card.assignee.displayName}</span> : null}
        </div>
        <h3 className="text-sm font-medium leading-5 text-neutral-100">{card.title}</h3>
        <div className="flex flex-wrap gap-2 text-xs text-neutral-400">
          {dependencyCount > 0 ? <span>{dependencyCount} blockers</span> : null}
          {dependentCount > 0 ? <span>{dependentCount} children</span> : null}
          {typeof card.metadata.ageDays === 'number' ? <span>{card.metadata.ageDays}d old</span> : null}
        </div>
        {card.labels.length ? (
          <div className="flex flex-wrap gap-1">
            {card.labels.slice(0, 4).map((label) => <span key={label} className="rounded bg-neutral-800 px-1.5 py-0.5 text-xs text-neutral-300">{label}</span>)}
          </div>
        ) : null}
        {workspace ? (
          <Button size="sm" variant="flat" onPress={() => onOpenWorkspace(workspace)}>Open Workspace</Button>
        ) : null}
      </CardBody>
    </Card>
  );
}

function BeadsMessage({ title, message }: { title: string; message: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-950 p-6 text-neutral-100">
      <div className="max-w-lg rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-neutral-400">{message}</p>
      </div>
    </div>
  );
}

function numberMetadata(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

import React, { useEffect, useMemo, useState } from 'react';
import { Drawer, DrawerBody, DrawerContent } from '@heroui/drawer';
import { Button, Card, CardBody, Chip, Spinner } from '@heroui/react';
import type { LinearExternalViewLocator } from '../externalViewUrl';
import { fetchExternalLinearBoardView } from '../externalTrackerBoardApi';
import type { ExternalLinearBoardApiResponse, ExternalLinearBoardViewDto } from '../externalTrackerBoardApi';
import type { ExternalKanbanCardDto, ExternalKanbanColumnDto, ExternalKanbanRelatedWorkspaceDto } from '../../boardTypes';
import { ExternalKanbanBoardShell, ExternalKanbanColumns, ExternalKanbanList, ExternalKanbanSingleIssuePage } from '../../components/ExternalKanbanBoardShell';
import { ExternalWorkspaceCreateDialog } from '../../components/ExternalWorkspaceCreateDialog';

export function ExternalLinearBoardRoute({ locator }: { locator: LinearExternalViewLocator }) {
  return <ExternalLinearBoardLoader externalViewUrl={locator.originalUrl} />;
}

export function ExternalLinearBoardLoader({ externalViewUrl }: { externalViewUrl: string }) {
  const [response, setResponse] = useState<ExternalLinearBoardApiResponse | undefined>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchExternalLinearBoardView({ externalViewUrl })
      .then((nextResponse) => {
        if (!cancelled) setResponse(nextResponse);
      })
      .catch(() => {
        if (!cancelled) {
          setResponse({
            ok: false,
            error: {
              code: 'linear_board_load_failed',
              message: 'Could not load the Linear board.',
              userAction: 'Verify Linear API key setup and try again.',
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
  }, [externalViewUrl]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-950 text-neutral-100">
        <Spinner color="primary" label="Loading Linear issues…" />
      </div>
    );
  }

  if (!response) return null;
  if (!response.ok) {
    return <ExternalLinearMessage title="Could not load Linear" message={response.error.message} action={response.error.userAction} />;
  }

  return <ExternalLinearBoardContent boardView={response.boardView} />;
}

export function ExternalLinearBoardContent({ boardView }: { boardView: ExternalLinearBoardViewDto }) {
  const [selectedCardId, setSelectedCardId] = useState<string | undefined>();
  const [sidePanelWorkspaceId, setSidePanelWorkspaceId] = useState<string | undefined>();
  const [workspaceCreateCard, setWorkspaceCreateCard] = useState<ExternalKanbanCardDto | undefined>();
  const [createdWorkspacesByCardId, setCreatedWorkspacesByCardId] = useState<Record<string, ExternalKanbanRelatedWorkspaceDto[]>>({});
  const displayBoardView = useMemo(() => ({
    ...boardView,
    cards: boardView.cards.map((card) => ({
      ...card,
      relatedWorkspaces: [
        ...(card.relatedWorkspaces ?? []),
        ...(createdWorkspacesByCardId[card.id] ?? []),
      ],
    })),
  }), [boardView, createdWorkspacesByCardId]);
  const sortedCards = useMemo(() => [...displayBoardView.cards].sort((left, right) => left.rank - right.rank), [displayBoardView.cards]);
  const selectedCard = sortedCards.find((card) => card.id === selectedCardId);
  const selectedIndex = selectedCard ? sortedCards.findIndex((card) => card.id === selectedCard.id) : -1;

  const selectOffset = (offset: number) => {
    const next = sortedCards[selectedIndex + offset];
    if (next) setSelectedCardId(next.id);
  };

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

  if (boardView.viewMode === 'issue' && sortedCards[0]) {
    return (
      <ExternalKanbanBoardShell
        sidePanel={sidePanel}
        overlays={workspaceCreateCard ? (
          <ExternalWorkspaceCreateDialog
            provider="linear"
            siteHostname={displayBoardView.siteHostname}
            card={workspaceCreateCard}
            onClose={() => setWorkspaceCreateCard(undefined)}
            onCreated={(workspace) => {
              setCreatedWorkspacesByCardId((current) => ({
                ...current,
                [workspaceCreateCard.id]: [...(current[workspaceCreateCard.id] ?? []), workspace],
              }));
              setSidePanelWorkspaceId(workspace.workspaceId);
              setWorkspaceCreateCard(undefined);
            }}
          />
        ) : undefined}
      >
        <ExternalKanbanSingleIssuePage
          boardView={displayBoardView}
          card={sortedCards[0]}
          providerLabel="Linear"
          providerColorClassName="bg-purple-500/15 text-purple-200"
          openInProviderLabel="Open in Linear"
          metadataItems={linearMetadataItems(sortedCards[0])}
          onCreateWorkspace={(card) => setWorkspaceCreateCard(card)}
          onOpenWorkspacePanel={(workspace) => setSidePanelWorkspaceId(workspace.workspaceId)}
        />
      </ExternalKanbanBoardShell>
    );
  }

  return (
    <ExternalKanbanBoardShell
      sidePanel={sidePanel}
      overlays={(
        <ExternalLinearIssueDrawer
          boardView={displayBoardView}
          card={selectedCard}
          canGoPrevious={selectedIndex > 0}
          canGoNext={selectedIndex >= 0 && selectedIndex < sortedCards.length - 1}
          onPrevious={() => selectOffset(-1)}
          onNext={() => selectOffset(1)}
          onClose={() => setSelectedCardId(undefined)}
          onOpenWorkspacePanel={(workspace) => setSidePanelWorkspaceId(workspace.workspaceId)}
        />
      )}
    >
      <main className="min-w-0 p-4 sm:p-6">
        <ExternalLinearBoardHeader boardView={displayBoardView} />
        {displayBoardView.cards.length === 0 ? (
          <ExternalLinearMessage title="No visible Linear issues" message="Linear returned 0 issues for this view." action="Open the Linear URL to verify filters and API key access." compact />
        ) : displayBoardView.viewMode === 'list' ? (
          <ExternalLinearIssueList
            boardView={displayBoardView}
            onSelectCard={(card) => setSelectedCardId(card.id)}
            onOpenWorkspacePanel={(workspace) => setSidePanelWorkspaceId(workspace.workspaceId)}
          />
        ) : (
          <ExternalLinearKanbanColumns
            columns={normalizeColumns(displayBoardView)}
            cards={displayBoardView.cards}
            onSelectCard={(card) => setSelectedCardId(card.id)}
            onOpenWorkspacePanel={(workspace) => setSidePanelWorkspaceId(workspace.workspaceId)}
          />
        )}
      </main>
    </ExternalKanbanBoardShell>
  );
}

function ExternalLinearBoardHeader({ boardView }: { boardView: ExternalLinearBoardViewDto }) {
  return (
    <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <Chip size="sm" variant="flat" className="bg-purple-500/15 text-purple-200">Linear</Chip>
          <Chip size="sm" variant="flat" className="bg-neutral-800 text-neutral-300">Read-only</Chip>
        </div>
        <h1 className="mt-3 text-2xl font-semibold text-neutral-50">{boardView.board.name ?? 'Linear issues'}</h1>
        <p className="mt-1 text-sm text-neutral-400">{boardView.pagination.issueCount} issues fetched live from {boardView.siteHostname}</p>
      </div>
      <Button as="a" href={boardView.sourceUrl} target="_blank" rel="noreferrer" variant="flat" className="w-fit">Open in Linear</Button>
    </header>
  );
}

function ExternalLinearKanbanColumns({
  columns,
  cards,
  onSelectCard,
  onOpenWorkspacePanel,
}: {
  columns: ExternalKanbanColumnDto[];
  cards: ExternalKanbanCardDto[];
  onSelectCard: (card: ExternalKanbanCardDto) => void;
  onOpenWorkspacePanel: (workspace: ExternalKanbanRelatedWorkspaceDto) => void;
}) {
  return (
    <ExternalKanbanColumns
      columns={columns}
      cards={cards}
      renderCard={(card) => <ExternalLinearCard card={card} onSelect={onSelectCard} onOpenWorkspacePanel={onOpenWorkspacePanel} />}
    />
  );
}

function ExternalLinearIssueList({
  boardView,
  onSelectCard,
  onOpenWorkspacePanel,
}: {
  boardView: ExternalLinearBoardViewDto;
  onSelectCard: (card: ExternalKanbanCardDto) => void;
  onOpenWorkspacePanel: (workspace: ExternalKanbanRelatedWorkspaceDto) => void;
}) {
  return (
    <ExternalKanbanList
      list={boardView.list}
      cards={boardView.cards}
      renderCard={(card) => (
        <ExternalLinearListRow
          card={card}
          onSelect={onSelectCard}
          onOpenWorkspacePanel={onOpenWorkspacePanel}
        />
      )}
    />
  );
}

function ExternalLinearCard({
  card,
  onSelect,
  onOpenWorkspacePanel,
}: {
  card: ExternalKanbanCardDto;
  onSelect: (card: ExternalKanbanCardDto) => void;
  onOpenWorkspacePanel: (workspace: ExternalKanbanRelatedWorkspaceDto) => void;
}) {
  const taskCount = card.relatedBeads?.length ?? 0;
  const workspace = card.relatedWorkspaces?.[0];
  return (
    <div
      role="button"
      tabIndex={0}
      className="w-full rounded-xl border border-neutral-800 bg-neutral-950 p-3 text-left transition hover:border-purple-500/60 focus:outline-none focus:ring-2 focus:ring-purple-400"
      onClick={() => onSelect(card)}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(card);
        }
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="font-mono text-xs text-purple-200">{card.key}</span>
      </div>
      <p className="mt-2 text-sm font-medium text-neutral-100">{card.title}</p>
      <div className="mt-3 flex flex-wrap gap-2 text-xs text-neutral-400">
        {card.statusName ? <span>{card.statusName}</span> : null}
        {taskCount > 0 ? <span>{taskCount} {taskCount === 1 ? 'task' : 'tasks'}</span> : null}
      </div>
      <div className="mt-3">
        {workspace ? (
          <Button
            size="sm"
            variant="flat"
            onClick={(event) => {
              event.stopPropagation();
              onOpenWorkspacePanel(workspace);
            }}
          >
            Open Workspace
          </Button>
        ) : (
          <Chip size="sm" variant="flat" className="bg-neutral-800 text-neutral-400">No workspace</Chip>
        )}
      </div>
    </div>
  );
}

function ExternalLinearListRow({
  card,
  onSelect,
  onOpenWorkspacePanel,
}: {
  card: ExternalKanbanCardDto;
  onSelect: (card: ExternalKanbanCardDto) => void;
  onOpenWorkspacePanel: (workspace: ExternalKanbanRelatedWorkspaceDto) => void;
}) {
  const taskCount = card.relatedBeads?.length ?? 0;
  const workspace = card.relatedWorkspaces?.[0];
  return (
    <div
      role="button"
      tabIndex={0}
      className="flex w-full flex-col gap-3 rounded-xl border border-neutral-800 bg-neutral-950 p-3 text-left transition hover:border-purple-500/60 focus:outline-none focus:ring-2 focus:ring-purple-400 sm:flex-row sm:items-center sm:justify-between"
      onClick={() => onSelect(card)}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(card);
        }
      }}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs font-semibold text-purple-200">{card.key}</span>
          {card.statusName ? <Chip size="sm" variant="flat" className="bg-neutral-800 text-neutral-300">{card.statusName}</Chip> : null}
          {taskCount > 0 ? <span className="text-xs text-neutral-400">{taskCount} {taskCount === 1 ? 'task' : 'tasks'}</span> : null}
        </div>
        <p className="mt-1 truncate text-sm font-medium text-neutral-100">{card.title}</p>
      </div>
      <div className="shrink-0">
        {workspace ? (
          <Button
            size="sm"
            variant="flat"
            onClick={(event) => {
              event.stopPropagation();
              onOpenWorkspacePanel(workspace);
            }}
          >
            Open Workspace
          </Button>
        ) : (
          <Chip size="sm" variant="flat" className="bg-neutral-800 text-neutral-400">No workspace</Chip>
        )}
      </div>
    </div>
  );
}

function ExternalLinearIssueDrawer({
  boardView,
  card,
  canGoPrevious,
  canGoNext,
  onPrevious,
  onNext,
  onClose,
  onOpenWorkspacePanel,
}: {
  boardView: ExternalLinearBoardViewDto;
  card?: ExternalKanbanCardDto;
  canGoPrevious: boolean;
  canGoNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
  onOpenWorkspacePanel: (workspace: ExternalKanbanRelatedWorkspaceDto) => void;
}) {
  return (
    <Drawer isOpen={Boolean(card)} onOpenChange={(open) => { if (!open) onClose(); }} placement="right" size="2xl" classNames={{ base: 'w-full max-w-full sm:max-w-2xl bg-neutral-950 text-neutral-100' }}>
      <DrawerContent>
        {card ? (
          <DrawerBody className="min-h-0 overflow-y-auto p-0">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-neutral-800 bg-neutral-950/95 p-3 backdrop-blur">
              <div className="flex items-center gap-2">
                <Button size="sm" variant="flat" isDisabled={!canGoPrevious} onPress={onPrevious} aria-label="Previous issue">←</Button>
                <Button size="sm" variant="flat" isDisabled={!canGoNext} onPress={onNext} aria-label="Next issue">→</Button>
              </div>
              <Button size="sm" variant="flat" onPress={onClose}>Close</Button>
            </div>
            <div className="space-y-6 p-5">
              <div>
                <Chip size="sm" variant="flat" className="bg-purple-500/15 text-purple-200">{card.key}</Chip>
                <h2 className="mt-3 text-2xl font-semibold text-neutral-50">{card.title}</h2>
                <p className="mt-2 text-sm text-neutral-400">{card.statusName ?? 'No status'} · {boardView.board.name ?? 'Linear issues'}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Detail label="Assignee" value={card.assignee?.displayName ?? 'Unassigned'} />
                <Detail label="Priority" value={card.priority ?? 'No priority'} />
                <Detail label="Project" value={String(card.metadata.projectName ?? 'No project')} />
                <Detail label="Labels" value={card.labels.length > 0 ? card.labels.join(', ') : 'No labels'} />
              </div>
              <section>
                <h3 className="text-sm font-semibold text-neutral-200">Related tasks</h3>
                {card.relatedBeads?.length ? (
                  <ul className="mt-2 space-y-2">
                    {card.relatedBeads.map((task) => <li key={task.id} className="rounded-lg border border-neutral-800 p-2 text-sm">{task.title} <span className="text-neutral-500">({task.status ?? 'unknown'})</span></li>)}
                  </ul>
                ) : <p className="mt-2 text-sm text-neutral-500">No linked tasks.</p>}
              </section>
              <section>
                <h3 className="text-sm font-semibold text-neutral-200">Related workspaces</h3>
                {card.relatedWorkspaces?.length ? (
                  <div className="mt-2 space-y-2">
                    {card.relatedWorkspaces.map((workspace) => (
                      <div key={workspace.workspaceId} className="flex items-center justify-between rounded-lg border border-neutral-800 p-2">
                        <span className="text-sm">{workspace.displayName ?? workspace.workspaceId}</span>
                        <Button size="sm" variant="flat" onPress={() => onOpenWorkspacePanel(workspace)}>Open Workspace</Button>
                      </div>
                    ))}
                  </div>
                ) : <p className="mt-2 text-sm text-neutral-500">No linked workspace.</p>}
              </section>
              <Button as="a" href={card.url} target="_blank" rel="noreferrer" color="primary" variant="flat">Open in Linear</Button>
            </div>
          </DrawerBody>
        ) : null}
      </DrawerContent>
    </Drawer>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-neutral-800 p-3">
      <p className="text-xs uppercase tracking-wide text-neutral-500">{label}</p>
      <p className="mt-1 text-sm text-neutral-200">{value}</p>
    </div>
  );
}

function ExternalLinearMessage({ title, message, action, compact = false }: { title: string; message: string; action?: string; compact?: boolean }) {
  return (
    <div className={compact ? '' : 'flex min-h-screen items-center justify-center bg-neutral-950 p-6 text-neutral-100'}>
      <Card className="border border-neutral-800 bg-neutral-900">
        <CardBody className="gap-3 p-6">
          <Chip size="sm" variant="flat" className="w-fit bg-purple-500/15 text-purple-200">Linear</Chip>
          <h1 className="text-xl font-semibold text-neutral-50">{title}</h1>
          <p className="text-sm text-neutral-300">{message}</p>
          {action ? <p className="text-sm text-neutral-500">{action}</p> : null}
        </CardBody>
      </Card>
    </div>
  );
}

function normalizeColumns(boardView: ExternalLinearBoardViewDto): ExternalKanbanColumnDto[] {
  if (boardView.columns.length > 0) return boardView.columns;
  return [{ id: 'linear-status-unknown', title: 'No status', statusIds: [] }];
}

function linearMetadataItems(card: ExternalKanbanCardDto): Array<{ label: string; value: string }> {
  const projectName = card.metadata.projectName;
  return typeof projectName === 'string' && projectName.trim()
    ? [{ label: 'Project', value: projectName }]
    : [];
}

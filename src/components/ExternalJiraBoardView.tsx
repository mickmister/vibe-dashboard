import React, { useEffect, useMemo, useState } from 'react';
import type { DashboardExternalViewParseResult } from '../lib/externalViewUrl';
import { fetchExternalJiraBoardView } from '../lib/externalTrackerBoardApi';
import type { ExternalJiraBoardApiResponse, ExternalJiraBoardViewDto, ExternalKanbanCardDto, ExternalKanbanColumnDto } from '../lib/externalTrackerBoardApi';

export function ExternalJiraBoardRoute({ parseResult }: { parseResult: DashboardExternalViewParseResult }) {
  if (parseResult.status !== 'ok') {
    return <ExternalTrackerMessage title="Unsupported external view" message={messageForUnsupportedReason(parseResult.reason)} action="Open a supported Jira board URL and launch VD again." />;
  }

  if (parseResult.locator.provider !== 'jira' || parseResult.locator.viewKind !== 'board') {
    return <ExternalTrackerMessage title="Unsupported external view" message="This read-only view currently supports Jira board URLs only." action="Open a Jira board URL and launch VD again." />;
  }

  return <ExternalJiraBoardLoader externalViewUrl={parseResult.locator.originalUrl} />;
}

export function ExternalJiraBoardLoader({ externalViewUrl }: { externalViewUrl: string }) {
  const [response, setResponse] = useState<ExternalJiraBoardApiResponse | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    setResponse(undefined);

    fetchExternalJiraBoardView({ externalViewUrl })
      .then((nextResponse) => {
        if (!cancelled) setResponse(nextResponse);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [externalViewUrl]);

  if (loading) {
    return <ExternalTrackerMessage title="Loading Jira board…" message="Fetching the latest columns and issues from Jira." />;
  }

  if (error) {
    return <ExternalTrackerMessage title="Could not load Jira board" message={error} action="Check your connection and try again." />;
  }

  if (!response) {
    return <ExternalTrackerMessage title="Could not load Jira board" message="The external tracker API returned no response." action="Try again." />;
  }

  if (!response.ok) {
    return <ExternalTrackerMessage title="Could not load Jira board" message={response.error.message} action={response.error.userAction} code={response.error.code} />;
  }

  return <ExternalJiraBoardContent boardView={response.boardView} />;
}

export function ExternalJiraBoardContent({ boardView, initialSelectedCardId }: { boardView: ExternalJiraBoardViewDto; initialSelectedCardId?: string }) {
  const [selectedCardId, setSelectedCardId] = useState<string | undefined>(initialSelectedCardId);
  const columns = useMemo(() => normalizeRenderableColumns(boardView), [boardView]);
  const renderableLanes = useMemo(() => createRenderableSwimlanes(boardView), [boardView]);
  const selectedCardIndex = selectedCardId ? boardView.cards.findIndex((card) => card.id === selectedCardId) : -1;
  const selectedCard = selectedCardIndex >= 0 ? boardView.cards[selectedCardIndex] : undefined;

  return (
    <ExternalJiraBoardShell
      boardView={boardView}
      columns={columns}
      renderableLanes={renderableLanes}
      selectedCard={selectedCard}
      selectedCardIndex={selectedCardIndex}
      onSelectCard={(card) => setSelectedCardId(card.id)}
      onCloseCard={() => setSelectedCardId(undefined)}
      onNextCard={() => setSelectedCardId(boardView.cards[selectedCardIndex + 1]?.id)}
      onPreviousCard={() => setSelectedCardId(boardView.cards[selectedCardIndex - 1]?.id)}
    />
  );
}

export function ExternalJiraBoardShell({
  boardView,
  columns,
  onCloseCard,
  onNextCard,
  onPreviousCard,
  onSelectCard,
  renderableLanes,
  selectedCard,
  selectedCardIndex,
}: {
  boardView: ExternalJiraBoardViewDto;
  columns: ExternalKanbanColumnDto[];
  onCloseCard: () => void;
  onNextCard: () => void;
  onPreviousCard: () => void;
  onSelectCard: (card: ExternalKanbanCardDto) => void;
  renderableLanes: Array<{ id: string; title: string; cards: ExternalKanbanCardDto[] }>;
  selectedCard?: ExternalKanbanCardDto;
  selectedCardIndex: number;
}) {
  const issueCount = boardView.pagination.issueCount;
  const hasLanes = renderableLanes.length > 0;

  return (
    <main className="dark min-h-screen bg-neutral-950 text-neutral-100">
      <ExternalJiraBoardHeader boardView={boardView} />
      <ExternalJiraBoardBody
        cards={boardView.cards}
        columns={columns}
        hasIssues={issueCount > 0}
        onSelectCard={onSelectCard}
        renderableLanes={renderableLanes}
        showSwimlanes={hasLanes}
      />
      {selectedCard ? (
        <ExternalJiraIssueDetailSheet
          boardView={boardView}
          canGoNext={selectedCardIndex < boardView.cards.length - 1}
          canGoPrevious={selectedCardIndex > 0}
          card={selectedCard}
          cardIndex={selectedCardIndex}
          onClose={onCloseCard}
          onNext={onNextCard}
          onPrevious={onPreviousCard}
          totalCards={boardView.cards.length}
        />
      ) : null}
    </main>
  );
}

export function ExternalJiraBoardHeader({ boardView }: { boardView: ExternalJiraBoardViewDto }) {
  const swimlanes = boardView.swimlanes;
  const issueCount = boardView.pagination.issueCount;

  return (
    <header className="border-b border-neutral-800 bg-neutral-950/95 px-6 py-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-300">Read-only Jira board</div>
          <h1 className="mt-2 text-2xl font-semibold">{boardView.board.name || `Jira board ${boardView.board.id}`}</h1>
          <p className="mt-1 text-sm text-neutral-400">
            {boardView.resource.name} · {boardView.siteHostname} · {issueCount} {issueCount === 1 ? 'issue' : 'issues'} fetched live
          </p>
        </div>
        <a className="rounded-lg border border-neutral-700 px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-900" href={boardView.sourceUrl} rel="noreferrer" target="_blank">
          Open in Jira
        </a>
      </div>
      <div className="mt-4 rounded-lg border border-neutral-800 bg-neutral-900/70 px-3 py-2 text-sm text-neutral-300">
        Swimlanes: <span className="font-medium text-neutral-100">{swimlanes.fidelity}</span>
        {swimlanes.reason ? <span className="text-neutral-500"> — {swimlanes.reason}</span> : null}
      </div>
    </header>
  );
}

export function ExternalJiraBoardBody({
  cards,
  columns,
  hasIssues,
  onSelectCard,
  renderableLanes,
  showSwimlanes,
}: {
  cards: ExternalKanbanCardDto[];
  columns: ExternalKanbanColumnDto[];
  hasIssues: boolean;
  onSelectCard: (card: ExternalKanbanCardDto) => void;
  renderableLanes: Array<{ id: string; title: string; cards: ExternalKanbanCardDto[] }>;
  showSwimlanes: boolean;
}) {
  if (!hasIssues) {
    return (
      <section className="p-6">
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-6 text-neutral-300">This Jira board has no visible issues.</div>
      </section>
    );
  }

  if (showSwimlanes) {
    return (
      <section className="space-y-6 p-6">
        {renderableLanes.map((lane) => (
          <ExternalJiraSwimlane key={lane.id} lane={lane} columns={columns} onSelectCard={onSelectCard} />
        ))}
      </section>
    );
  }

  return (
    <section className="p-6">
      <ExternalJiraKanbanColumns columns={columns} cards={cards} onSelectCard={onSelectCard} />
    </section>
  );
}

export function ExternalJiraSwimlane({ lane, columns, onSelectCard }: { lane: { id: string; title: string; cards: ExternalKanbanCardDto[] }; columns: ExternalKanbanColumnDto[]; onSelectCard: (card: ExternalKanbanCardDto) => void }) {
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-950/60 p-4">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-neutral-300">{lane.title}</h2>
      <ExternalJiraKanbanColumns columns={columns} cards={lane.cards} onSelectCard={onSelectCard} />
    </div>
  );
}

export function ExternalJiraKanbanColumns({ columns, cards, onSelectCard }: { columns: ExternalKanbanColumnDto[]; cards: ExternalKanbanCardDto[]; onSelectCard: (card: ExternalKanbanCardDto) => void }) {
  const knownColumnIds = new Set(columns.map((column) => column.id));
  return (
    <div className="grid auto-cols-[minmax(18rem,1fr)] grid-flow-col gap-4 overflow-x-auto pb-2">
      {columns.map((column) => {
        const columnCards = cards.filter((card) => (
          card.columnId === column.id ||
          (column.id === UNMAPPED_COLUMN_ID && (!card.columnId || !knownColumnIds.has(card.columnId)))
        ));
        return (
          <section key={column.id} className="min-w-72 rounded-xl border border-neutral-800 bg-neutral-900/80">
            <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
              <h3 className="text-sm font-semibold text-neutral-100">{column.title}</h3>
              <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-xs text-neutral-300">{columnCards.length}</span>
            </div>
            <div className="space-y-3 p-3">
              {columnCards.length === 0 ? <div className="rounded-lg border border-dashed border-neutral-800 p-3 text-sm text-neutral-500">No issues</div> : null}
              {columnCards.map((card) => <ExternalJiraCard key={card.id} card={card} onSelect={onSelectCard} />)}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function createRenderableSwimlanes(boardView: ExternalJiraBoardViewDto): Array<{ id: string; title: string; cards: ExternalKanbanCardDto[] }> {
  if (boardView.swimlanes.lanes.length === 0) return [];

  const assignedIssueKeys = new Set<string>();
  const lanes = boardView.swimlanes.lanes.map((lane) => {
    for (const issueKey of lane.issueKeys) assignedIssueKeys.add(issueKey);
    return {
      id: lane.id,
      title: lane.title,
      cards: boardView.cards.filter((card) => lane.issueKeys.includes(card.key)),
    };
  });

  const unassignedCards = boardView.cards.filter((card) => !assignedIssueKeys.has(card.key));
  if (unassignedCards.length > 0) {
    lanes.push({ id: 'no-swimlane', title: 'Other issues', cards: unassignedCards });
  }

  return lanes;
}

export function ExternalJiraCard({ card, onSelect }: { card: ExternalKanbanCardDto; onSelect: (card: ExternalKanbanCardDto) => void }) {
  const workspaceCount = card.relatedWorkspaces?.length ?? 0;
  const beadCount = card.relatedBeads?.length ?? 0;
  const completedBeadCount = card.relatedBeads?.filter((bead) => isCompletedBeadStatus(bead.status)).length ?? 0;

  return (
    <article
      className="cursor-pointer rounded-lg border border-neutral-800 bg-neutral-950 p-3 text-left shadow-sm transition hover:border-sky-500/40 hover:bg-neutral-900 focus:outline-none focus:ring-2 focus:ring-sky-500/70"
      onClick={() => onSelect(card)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(card);
        }
      }}
      role="button"
      tabIndex={0}
    >
      <span className="text-xs font-semibold text-sky-300">{card.key}</span>
      <h4 className="mt-1 text-sm font-medium leading-5 text-neutral-100">{card.title}</h4>
      <div className="mt-3 flex flex-wrap gap-2 text-xs text-neutral-400">
        {card.issueType ? <span>{card.issueType}</span> : null}
        {card.priority ? <span>{card.priority}</span> : null}
        {card.assignee ? <span>{card.assignee.displayName}</span> : null}
      </div>
      {card.labels.length ? (
        <div className="mt-3 flex flex-wrap gap-1">
          {card.labels.map((label) => <span key={label} className="rounded bg-neutral-800 px-2 py-0.5 text-[11px] text-neutral-300">{label}</span>)}
        </div>
      ) : null}
      <div className="mt-3 grid gap-1.5 rounded-md border border-neutral-800 bg-neutral-900/70 px-2 py-1.5 text-[11px] text-neutral-300">
        <div>
          <span className="font-medium text-neutral-200">Workspace:</span>{' '}
          {workspaceCount === 0 ? 'None' : workspaceCount === 1 ? 'Existing workspace' : `${workspaceCount} linked workspaces`}
        </div>
        <div>
          <span className="font-medium text-neutral-200">Beads:</span>{' '}
          {beadCount} created · {completedBeadCount} completed
        </div>
      </div>
      {card.relatedWorkspaces?.length ? (
        <div className="mt-3 rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2 py-1.5 text-xs text-emerald-100">
          <div className="font-medium text-emerald-200">Related workspaces</div>
          <ul className="mt-1 space-y-1">
            {card.relatedWorkspaces.map((workspace) => (
              <li key={workspace.workspaceId} className="truncate" title={workspace.workspaceDir ?? workspace.workspaceId}>
                {workspace.displayName || workspace.workspaceId}
                {workspace.isPrimary ? <span className="ml-1 text-emerald-300">Primary</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {card.relatedBeads?.length ? (
        <div className="mt-3 rounded-md border border-sky-500/20 bg-sky-500/10 px-2 py-1.5 text-xs text-sky-100">
          <div className="font-medium text-sky-200">Related beads</div>
          <ul className="mt-1 space-y-1">
            {card.relatedBeads.map((bead) => (
              <li key={bead.id} className="truncate" title={bead.id}>
                {bead.id}: {bead.title}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </article>
  );
}

export function ExternalJiraIssueDetailSheet({
  boardView,
  canGoNext,
  canGoPrevious,
  card,
  cardIndex,
  onClose,
  onNext,
  onPrevious,
  totalCards,
}: {
  boardView: ExternalJiraBoardViewDto;
  canGoNext: boolean;
  canGoPrevious: boolean;
  card: ExternalKanbanCardDto;
  cardIndex: number;
  onClose: () => void;
  onNext: () => void;
  onPrevious: () => void;
  totalCards: number;
}) {
  const workspaceCount = card.relatedWorkspaces?.length ?? 0;
  const beadCount = card.relatedBeads?.length ?? 0;
  const completedBeadCount = card.relatedBeads?.filter((bead) => isCompletedBeadStatus(bead.status)).length ?? 0;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 text-neutral-100 sm:bg-black/40" role="dialog" aria-modal="true" aria-label={`${card.key} issue details`}>
      <aside className="ml-auto flex h-dvh w-full flex-col border-l border-neutral-800 bg-neutral-950 shadow-2xl sm:max-w-xl">
        <header className="border-b border-neutral-800 bg-neutral-950/95 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1">
              <button type="button" className="rounded-md border border-neutral-800 px-2 py-1 text-sm text-neutral-200 hover:bg-neutral-900 disabled:cursor-not-allowed disabled:opacity-40" disabled={!canGoPrevious} onClick={onPrevious} aria-label="Previous issue">←</button>
              <button type="button" className="rounded-md border border-neutral-800 px-2 py-1 text-sm text-neutral-200 hover:bg-neutral-900 disabled:cursor-not-allowed disabled:opacity-40" disabled={!canGoNext} onClick={onNext} aria-label="Next issue">→</button>
              <span className="ml-2 text-xs text-neutral-500">{cardIndex + 1} / {totalCards}</span>
            </div>
            <button type="button" className="rounded-md border border-neutral-800 px-2 py-1 text-sm text-neutral-200 hover:bg-neutral-900" onClick={onClose}>Close</button>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-5">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-300">{boardView.board.name || `Jira board ${boardView.board.id}`}</div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="rounded bg-sky-500/10 px-2 py-0.5 text-sm font-semibold text-sky-200">{card.key}</span>
            {card.statusName ? <span className="rounded bg-neutral-800 px-2 py-0.5 text-xs text-neutral-300">{card.statusName}</span> : null}
            {card.issueType ? <span className="rounded bg-neutral-800 px-2 py-0.5 text-xs text-neutral-300">{card.issueType}</span> : null}
            {card.priority ? <span className="rounded bg-neutral-800 px-2 py-0.5 text-xs text-neutral-300">{card.priority}</span> : null}
          </div>
          <h2 className="mt-4 text-2xl font-semibold leading-8 text-neutral-50">{card.title}</h2>
          <dl className="mt-5 grid gap-3 rounded-xl border border-neutral-800 bg-neutral-900/60 p-4 text-sm sm:grid-cols-2">
            <div><dt className="text-xs uppercase tracking-wide text-neutral-500">Assignee</dt><dd className="mt-1 text-neutral-200">{card.assignee?.displayName ?? 'Unassigned'}</dd></div>
            <div><dt className="text-xs uppercase tracking-wide text-neutral-500">Workspace</dt><dd className="mt-1 text-neutral-200">{workspaceCount === 0 ? 'None' : workspaceCount === 1 ? 'Existing workspace' : `${workspaceCount} linked workspaces`}</dd></div>
            <div><dt className="text-xs uppercase tracking-wide text-neutral-500">Beads</dt><dd className="mt-1 text-neutral-200">{beadCount} created · {completedBeadCount} completed</dd></div>
            <div><dt className="text-xs uppercase tracking-wide text-neutral-500">Source</dt><dd className="mt-1 text-neutral-200">{boardView.siteHostname}</dd></div>
          </dl>
          {card.labels.length ? (
            <section className="mt-5">
              <h3 className="text-sm font-semibold text-neutral-200">Labels</h3>
              <div className="mt-2 flex flex-wrap gap-1">
                {card.labels.map((label) => <span key={label} className="rounded bg-neutral-800 px-2 py-0.5 text-xs text-neutral-300">{label}</span>)}
              </div>
            </section>
          ) : null}
          <section className="mt-5 rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
            <h3 className="text-sm font-semibold text-neutral-200">Related workspaces</h3>
            {card.relatedWorkspaces?.length ? (
              <ul className="mt-3 space-y-2">
                {card.relatedWorkspaces.map((workspace) => (
                  <li key={workspace.workspaceId} className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">
                    <div className="font-medium">{workspace.displayName || workspace.workspaceId}{workspace.isPrimary ? <span className="ml-2 text-xs text-emerald-300">Primary</span> : null}</div>
                    {workspace.workspaceDir ? <div className="mt-1 truncate text-xs text-emerald-200/70">{workspace.workspaceDir}</div> : null}
                  </li>
                ))}
              </ul>
            ) : <p className="mt-2 text-sm text-neutral-400">No existing workspace is associated with this issue.</p>}
          </section>
          <section className="mt-5 rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
            <h3 className="text-sm font-semibold text-neutral-200">Related beads</h3>
            {card.relatedBeads?.length ? (
              <ul className="mt-3 space-y-2">
                {card.relatedBeads.map((bead) => (
                  <li key={bead.id} className="rounded-lg border border-sky-500/20 bg-sky-500/10 px-3 py-2 text-sm text-sky-100">
                    <div className="font-medium">{bead.id}: {bead.title}</div>
                    {bead.status ? <div className="mt-1 text-xs text-sky-200/70">Status: {bead.status}</div> : null}
                  </li>
                ))}
              </ul>
            ) : <p className="mt-2 text-sm text-neutral-400">No beads have been created for this issue yet.</p>}
          </section>
          <div className="mt-6">
            <a className="inline-flex rounded-lg border border-neutral-700 px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-900" href={card.url} rel="noreferrer" target="_blank">Open in Jira</a>
          </div>
        </div>
      </aside>
    </div>
  );
}

function isCompletedBeadStatus(status: string | undefined): boolean {
  if (!status) return false;
  return ['closed', 'complete', 'completed', 'done', 'resolved'].includes(status.toLowerCase());
}

export function ExternalTrackerMessage({ title, message, action, code }: { title: string; message: string; action?: string; code?: string }) {
  return (
    <main className="dark flex min-h-screen items-center justify-center bg-neutral-950 p-6 text-neutral-100">
      <section className="w-full max-w-xl rounded-2xl border border-neutral-800 bg-neutral-900 p-6 shadow-2xl">
        {code ? <div className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">{code}</div> : null}
        <h1 className="mt-2 text-2xl font-semibold">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-neutral-300">{message}</p>
        {action ? <p className="mt-3 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-400">{action}</p> : null}
      </section>
    </main>
  );
}

const UNMAPPED_COLUMN_ID = 'unmapped';

function normalizeRenderableColumns(boardView: ExternalJiraBoardViewDto): ExternalKanbanColumnDto[] {
  if (!boardView.columns.length) return [{ id: UNMAPPED_COLUMN_ID, title: 'Issues', statusIds: [] }];

  const columns = [...boardView.columns];
  const knownColumnIds = new Set(columns.map((column) => column.id));
  if (boardView.cards.some((card) => !card.columnId || !knownColumnIds.has(card.columnId))) {
    return [...columns, { id: UNMAPPED_COLUMN_ID, title: 'Unmapped', statusIds: [] }];
  }
  return columns;
}

function messageForUnsupportedReason(reason: string): string {
  switch (reason) {
    case 'malformed_url':
      return 'The external URL was malformed.';
    case 'unsupported_jira_url':
      return 'The Jira URL is not a supported board URL.';
    case 'unsupported_github_url':
      return 'GitHub external views are not part of this Jira board milestone.';
    case 'unsupported_provider_url':
      return 'This external provider is not supported yet.';
    case 'missing_external_view_url':
    default:
      return 'No external view URL was provided.';
  }
}

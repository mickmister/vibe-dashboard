import React, { useEffect, useMemo, useState } from 'react';
import { Drawer, DrawerBody, DrawerContent } from '@heroui/drawer';
import { Button, Card, CardBody, Checkbox, Chip, Input, Select, SelectItem, Spinner } from '@heroui/react';
import type { DashboardExternalViewParseResult } from '../externalViewUrl';
import { fetchExternalJiraBoardView } from '../externalTrackerBoardApi';
import { setOtelAttributes, withOtelSpan } from '../../../../../lib/otel';
import type { ExternalJiraBoardApiResponse, ExternalJiraBoardViewDto, ExternalKanbanCardDto, ExternalKanbanColumnDto } from '../externalTrackerBoardApi';
import { bulkCreateJiraTicketsFromWorkspaces, createExternalIssueWorkspace, fetchBulkJiraWorkspaceConversionOptions, fetchExternalWorkspaceCreateOptions, fetchExternalWorkspaceMetrics, fetchExternalWorkspaceRepoBranches, registerExternalWorkspaceRepo } from '../externalWorkspaceCreateApi';
import type { BulkJiraRepoProjectMappingDto, BulkJiraWorkspaceConversionResultDto, BulkJiraWorkspaceConversionWorkspaceDto, ExternalWorkspaceCandidateRepoDto, ExternalWorkspaceCreateOptionsDto, ExternalWorkspaceMetricsDto, VkBranchDto, VkExecutorConfigDto, VkRepoDto } from '../externalWorkspaceCreateApi';
import { cloneExternalWorkspaceRepo } from '../../../../../lib/repoCloneApi';
import { REPO_CLONE_HELPER_TEXT, REPO_CLONE_LABEL, REPO_CLONE_PLACEHOLDER } from '../../../../../lib/repoCloneUi';

type ExternalRelatedWorkspace = NonNullable<ExternalKanbanCardDto['relatedWorkspaces']>[number];

export function ExternalJiraBoardRoute({ parseResult }: { parseResult: DashboardExternalViewParseResult }) {
  if (parseResult.status !== 'ok') {
    return <ExternalTrackerMessage title="Unsupported external view" message={messageForUnsupportedReason(parseResult.reason)} action="Open a supported Jira board URL and launch VD again." />;
  }

  if (parseResult.locator.provider !== 'jira') {
    return <ExternalTrackerMessage title="Unsupported external view" message="This read-only view currently supports Jira URLs only." action="Open a Jira board URL and launch VD again." />;
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

    withOtelSpan('external_jira.client_load_board', {}, async (span) => {
      const nextResponse = await fetchExternalJiraBoardView({ externalViewUrl });
      setOtelAttributes(span, nextResponse.ok ? { 'jira.issue_count': nextResponse.boardView.pagination.issueCount } : { 'vd.error_code': nextResponse.error.code });
      if (!cancelled) setResponse(nextResponse);
      if (nextResponse.ok) {
        loadWorkspaceMetricsForBoard(nextResponse.boardView, (boardView) => {
          if (!cancelled) setResponse({ ok: true, boardView });
        });
      }
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



export function mergeWorkspaceMetricsIntoBoardView(
  boardView: ExternalJiraBoardViewDto,
  metricsByWorkspaceId: Record<string, ExternalWorkspaceMetricsDto>,
): ExternalJiraBoardViewDto {
  return {
    ...boardView,
    cards: boardView.cards.map((card) => ({
      ...card,
      relatedWorkspaces: card.relatedWorkspaces?.map((workspace) => {
        const metrics = metricsByWorkspaceId[workspace.workspaceId];
        return metrics ? { ...workspace, metadata: { ...workspace.metadata, ...metrics } } : workspace;
      }),
    })),
  };
}

function workspaceIdsForBoard(boardView: ExternalJiraBoardViewDto): string[] {
  return [...new Set(boardView.cards.flatMap((card) => card.relatedWorkspaces?.map((workspace) => workspace.workspaceId) ?? []))];
}

async function loadWorkspaceMetricsForBoard(boardView: ExternalJiraBoardViewDto, apply: (boardView: ExternalJiraBoardViewDto) => void): Promise<void> {
  const workspaceIds = workspaceIdsForBoard(boardView);
  if (workspaceIds.length === 0) return;
  const result = await withOtelSpan('external_jira.client_load_workspace_metrics', { 'vd.workspace_count': workspaceIds.length }, () => fetchExternalWorkspaceMetrics(workspaceIds)).catch(() => undefined);
  if (result?.ok) apply(mergeWorkspaceMetricsIntoBoardView(boardView, result.metricsByWorkspaceId));
}

export type ExternalJiraColumnVisibility = {
  showBacklog: boolean;
  showDone: boolean;
};

const DEFAULT_COLUMN_VISIBILITY: ExternalJiraColumnVisibility = { showBacklog: false, showDone: false };

const jiraFieldClassNames = {
  base: 'justify-end',
  inputWrapper: 'h-8 min-h-8 border border-neutral-700 bg-neutral-950 px-2 py-0 data-[hover=true]:bg-neutral-900 group-data-[focus=true]:bg-neutral-950',
  input: 'text-[11px] text-neutral-100 placeholder:text-neutral-600',
  label: 'text-xs text-neutral-300',
};

const jiraSelectClassNames = {
  base: 'justify-end',
  trigger: 'h-8 min-h-8 rounded-lg border border-neutral-700 bg-neutral-950 px-2 pr-7 text-neutral-100 data-[hover=true]:bg-neutral-900',
  value: 'text-[11px] text-neutral-100',
  label: 'text-xs text-neutral-300',
  selectorIcon: 'right-2 text-neutral-500',
  popoverContent: 'border border-neutral-800 bg-neutral-950 text-neutral-100',
  listbox: 'text-[11px]',
};

const BULK_JIRA_ALL_REPOS_KEY = '__all_repositories__';

export function ExternalJiraBoardContent({ boardView, initialSelectedCardId, initialSidePanelWorkspaceId, initialColumnVisibility = DEFAULT_COLUMN_VISIBILITY }: { boardView: ExternalJiraBoardViewDto; initialSelectedCardId?: string; initialSidePanelWorkspaceId?: string; initialColumnVisibility?: ExternalJiraColumnVisibility }) {
  const [selectedCardId, setSelectedCardId] = useState<string | undefined>(initialSelectedCardId);
  const [sidePanelWorkspaceId, setSidePanelWorkspaceId] = useState<string | undefined>(initialSidePanelWorkspaceId);
  const [createdPanelWorkspace, setCreatedPanelWorkspace] = useState<ExternalRelatedWorkspace | undefined>();
  const [workspaceCreateCard, setWorkspaceCreateCard] = useState<ExternalKanbanCardDto | undefined>();
  const [bulkConvertOpen, setBulkConvertOpen] = useState(false);
  const [columnVisibility, setColumnVisibility] = useState<ExternalJiraColumnVisibility>(initialColumnVisibility);
  const allColumns = useMemo(() => normalizeRenderableColumns(boardView), [boardView]);
  const columns = useMemo(() => getVisibleExternalJiraColumns(allColumns, columnVisibility), [allColumns, columnVisibility]);
  const visibleCards = useMemo(() => getVisibleExternalJiraCards(boardView.cards, allColumns, columnVisibility), [allColumns, boardView.cards, columnVisibility]);
  const renderableLanes = useMemo(() => createRenderableSwimlanes(boardView, visibleCards), [boardView, visibleCards]);
  const selectedCardIndex = selectedCardId ? boardView.cards.findIndex((card) => card.id === selectedCardId) : -1;
  const selectedCard = selectedCardIndex >= 0 ? boardView.cards[selectedCardIndex] : undefined;
  const sidePanelWorkspace = useMemo(() => findWorkspaceById(boardView, sidePanelWorkspaceId) ?? (createdPanelWorkspace?.workspaceId === sidePanelWorkspaceId ? createdPanelWorkspace : undefined), [boardView, createdPanelWorkspace, sidePanelWorkspaceId]);

  return (
    <ExternalJiraBoardShell
      boardView={boardView}
      allColumns={allColumns}
      columnVisibility={columnVisibility}
      columns={columns}
      visibleCards={visibleCards}
      renderableLanes={renderableLanes}
      selectedCard={selectedCard}
      selectedCardIndex={selectedCardIndex}
      sidePanelWorkspace={sidePanelWorkspace}
      onColumnVisibilityChange={setColumnVisibility}
      onSelectCard={(card) => setSelectedCardId(card.id)}
      onCloseCard={() => setSelectedCardId(undefined)}
      onCloseWorkspaceCreate={() => setWorkspaceCreateCard(undefined)}
      onCloseWorkspacePanel={() => setSidePanelWorkspaceId(undefined)}
      onCloseBulkConvert={() => setBulkConvertOpen(false)}
      onCreateWorkspace={(card) => setWorkspaceCreateCard(card)}
      onOpenBulkConvert={() => setBulkConvertOpen(true)}
      onNextCard={() => setSelectedCardId(boardView.cards[selectedCardIndex + 1]?.id)}
      onOpenWorkspacePanel={(workspace) => setSidePanelWorkspaceId(workspace.workspaceId)}
      onPreviousCard={() => setSelectedCardId(boardView.cards[selectedCardIndex - 1]?.id)}
      onWorkspaceCreated={(workspace) => {
        setCreatedPanelWorkspace(workspace);
        setSidePanelWorkspaceId(workspace.workspaceId);
        setWorkspaceCreateCard(undefined);
      }}
      bulkConvertOpen={bulkConvertOpen}
      workspaceCreateCard={workspaceCreateCard}
    />
  );
}

export function ExternalJiraBoardShell({
  boardView,
  allColumns,
  columnVisibility,
  columns,
  visibleCards,
  onCloseCard,
  onCloseWorkspaceCreate,
  onCloseBulkConvert,
  onCloseWorkspacePanel,
  onColumnVisibilityChange,
  onCreateWorkspace,
  onOpenBulkConvert,
  onNextCard,
  onOpenWorkspacePanel,
  onPreviousCard,
  onSelectCard,
  renderableLanes,
  selectedCard,
  selectedCardIndex,
  sidePanelWorkspace,
  onWorkspaceCreated,
  bulkConvertOpen,
  workspaceCreateCard,
}: {
  boardView: ExternalJiraBoardViewDto;
  allColumns: ExternalKanbanColumnDto[];
  columnVisibility: ExternalJiraColumnVisibility;
  columns: ExternalKanbanColumnDto[];
  visibleCards: ExternalKanbanCardDto[];
  onCloseCard: () => void;
  onCloseWorkspaceCreate: () => void;
  onCloseBulkConvert: () => void;
  onCloseWorkspacePanel: () => void;
  onColumnVisibilityChange: (visibility: ExternalJiraColumnVisibility) => void;
  onCreateWorkspace: (card: ExternalKanbanCardDto) => void;
  onOpenBulkConvert: () => void;
  onNextCard: () => void;
  onOpenWorkspacePanel: (workspace: ExternalRelatedWorkspace) => void;
  onPreviousCard: () => void;
  onSelectCard: (card: ExternalKanbanCardDto) => void;
  renderableLanes: Array<{ id: string; title: string; cards: ExternalKanbanCardDto[] }>;
  selectedCard?: ExternalKanbanCardDto;
  selectedCardIndex: number;
  sidePanelWorkspace?: ExternalRelatedWorkspace;
  onWorkspaceCreated: (workspace: ExternalRelatedWorkspace) => void;
  bulkConvertOpen: boolean;
  workspaceCreateCard?: ExternalKanbanCardDto;
}) {
  const hiddenIssueCount = boardView.cards.length - visibleCards.length;
  const hasLanes = renderableLanes.length > 0;

  return (
    <main className="dark h-dvh overflow-y-auto overscroll-contain bg-neutral-950 text-neutral-100">
      <div className="flex min-h-full flex-col lg:flex-row">
        <div className="min-w-0 flex-1">
          <ExternalJiraBoardHeader
            boardView={boardView}
            columnVisibility={columnVisibility}
            columns={allColumns}
            onBulkConvert={onOpenBulkConvert}
            onColumnVisibilityChange={onColumnVisibilityChange}
          />
          <ExternalJiraBoardBody
            cards={visibleCards}
            columns={columns}
            diagnostics={boardView.diagnostics}
            hasIssues={visibleCards.length > 0}
            hiddenIssueCount={hiddenIssueCount}
            onCreateWorkspace={onCreateWorkspace}
            onOpenWorkspacePanel={onOpenWorkspacePanel}
            onSelectCard={onSelectCard}
            renderableLanes={renderableLanes}
            showSwimlanes={hasLanes}
          />
        </div>
        {sidePanelWorkspace ? (
          <ExternalVKSessionSidePanel workspace={sidePanelWorkspace} onClose={onCloseWorkspacePanel} />
        ) : null}
      </div>
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
      {workspaceCreateCard ? (
        <ExternalWorkspaceCreateDialog
          boardView={boardView}
          card={workspaceCreateCard}
          onClose={onCloseWorkspaceCreate}
          onCreated={onWorkspaceCreated}
        />
      ) : null}
      {bulkConvertOpen ? (
        <BulkJiraWorkspaceConversionDialog boardView={boardView} onClose={onCloseBulkConvert} />
      ) : null}
    </main>
  );
}

export function ExternalJiraBoardHeader({ boardView, columns, columnVisibility, onBulkConvert, onColumnVisibilityChange }: { boardView: ExternalJiraBoardViewDto; columns: ExternalKanbanColumnDto[]; columnVisibility: ExternalJiraColumnVisibility; onBulkConvert?: () => void; onColumnVisibilityChange: (visibility: ExternalJiraColumnVisibility) => void }) {
  return (
    <header className="relative overflow-hidden border-b border-neutral-800 bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.18),transparent_30%),linear-gradient(135deg,rgba(15,23,42,0.98),rgba(10,10,10,0.98))] px-6 py-5">
      <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-sky-400/60 to-transparent" />
      <div className="relative flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Chip size="sm" variant="flat" className="border border-sky-400/20 bg-sky-500/10 text-sky-100">Jira board</Chip>
            <Chip size="sm" variant="flat" className="border border-emerald-400/20 bg-emerald-500/10 text-emerald-100">{boardView.cards.length} issues</Chip>
          </div>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-neutral-50">{boardView.board.name || `Jira board ${boardView.board.id}`}</h1>
          <p className="mt-1 text-sm text-neutral-400">{boardView.resource.name}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <ExternalJiraColumnVisibilityControls columns={columns} visibility={columnVisibility} onChange={onColumnVisibilityChange} />
          <Button size="sm" color="success" variant="flat" className="border border-emerald-400/30 bg-emerald-500/15 text-emerald-50" onClick={onBulkConvert}>
            Create Jira tickets
          </Button>
          <Button as="a" size="sm" variant="bordered" className="border-neutral-700 text-neutral-100" href={boardView.sourceUrl} rel="noreferrer" target="_blank">
            Open in Jira
          </Button>
        </div>
      </div>
    </header>
  );
}

export function ExternalJiraColumnVisibilityControls({ columns, visibility, onChange }: { columns: ExternalKanbanColumnDto[]; visibility: ExternalJiraColumnVisibility; onChange: (visibility: ExternalJiraColumnVisibility) => void }) {
  const hasBacklog = columns.some(isBacklogColumn);
  const hasDone = columns.some(isDoneColumn);
  if (!hasBacklog && !hasDone) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-full border border-neutral-800 bg-neutral-900/70 px-2 py-1 shadow-lg shadow-black/10" aria-label="Column visibility">
      <span className="px-1 text-xs font-medium uppercase tracking-wide text-neutral-500">Columns</span>
      {hasBacklog ? (
        <Button
          size="sm"
          variant={visibility.showBacklog ? 'flat' : 'light'}
          className={columnToggleClassName(visibility.showBacklog)}
          aria-pressed={visibility.showBacklog}
          onClick={() => onChange({ ...visibility, showBacklog: !visibility.showBacklog })}
        >
          {visibility.showBacklog ? 'Hide Backlog' : 'Show Backlog'}
        </Button>
      ) : null}
      {hasDone ? (
        <Button
          size="sm"
          variant={visibility.showDone ? 'flat' : 'light'}
          className={columnToggleClassName(visibility.showDone)}
          aria-pressed={visibility.showDone}
          onClick={() => onChange({ ...visibility, showDone: !visibility.showDone })}
        >
          {visibility.showDone ? 'Hide Done' : 'Show Done'}
        </Button>
      ) : null}
    </div>
  );
}

export function ExternalJiraBoardBody({
  cards,
  columns,
  diagnostics,
  hasIssues,
  hiddenIssueCount,
  onCreateWorkspace,
  onOpenWorkspacePanel,
  onSelectCard,
  renderableLanes,
  showSwimlanes,
}: {
  cards: ExternalKanbanCardDto[];
  columns: ExternalKanbanColumnDto[];
  diagnostics?: ExternalJiraBoardViewDto['diagnostics'];
  hasIssues: boolean;
  hiddenIssueCount: number;
  onCreateWorkspace: (card: ExternalKanbanCardDto) => void;
  onOpenWorkspacePanel: (workspace: ExternalRelatedWorkspace) => void;
  onSelectCard: (card: ExternalKanbanCardDto) => void;
  renderableLanes: Array<{ id: string; title: string; cards: ExternalKanbanCardDto[] }>;
  showSwimlanes: boolean;
}) {
  if (!hasIssues) {
    return (
      <section className="p-6">
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-6 text-neutral-300">
          <p>{hiddenIssueCount > 0 ? `${hiddenIssueCount} issues are in hidden Backlog/Done columns.` : 'This Jira board has no visible issues.'}</p>
          {hiddenIssueCount > 0 ? <p className="mt-2 text-sm text-neutral-400">Use the column controls above to show Backlog or Done.</p> : null}
          {diagnostics ? <ExternalJiraDiagnosticsPanel diagnostics={diagnostics} /> : null}
        </div>
      </section>
    );
  }

  if (showSwimlanes) {
    return (
      <section className="space-y-6 p-6">
        {renderableLanes.map((lane) => (
          <ExternalJiraSwimlane key={lane.id} lane={lane} columns={columns} onCreateWorkspace={onCreateWorkspace} onOpenWorkspacePanel={onOpenWorkspacePanel} onSelectCard={onSelectCard} />
        ))}
      </section>
    );
  }

  return (
    <section className="p-6">
      <ExternalJiraKanbanColumns columns={columns} cards={cards} onCreateWorkspace={onCreateWorkspace} onOpenWorkspacePanel={onOpenWorkspacePanel} onSelectCard={onSelectCard} />
    </section>
  );
}

export function ExternalJiraSwimlane({ lane, columns, onCreateWorkspace, onOpenWorkspacePanel, onSelectCard }: { lane: { id: string; title: string; cards: ExternalKanbanCardDto[] }; columns: ExternalKanbanColumnDto[]; onCreateWorkspace: (card: ExternalKanbanCardDto) => void; onOpenWorkspacePanel: (workspace: ExternalRelatedWorkspace) => void; onSelectCard: (card: ExternalKanbanCardDto) => void }) {
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-950/60 p-4">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-neutral-300">{lane.title}</h2>
      <ExternalJiraKanbanColumns columns={columns} cards={lane.cards} onCreateWorkspace={onCreateWorkspace} onOpenWorkspacePanel={onOpenWorkspacePanel} onSelectCard={onSelectCard} />
    </div>
  );
}

export function ExternalJiraDiagnosticsPanel({ diagnostics }: { diagnostics: NonNullable<ExternalJiraBoardViewDto['diagnostics']> }) {
  const authLabel = diagnostics.authSource === 'bot' ? 'bot credentials' : diagnostics.authSource === 'oauth' ? 'OAuth credentials' : 'unknown credentials';
  const modeLabel = diagnostics.jiraMode === 'project-search' ? 'project search' : 'Agile board';

  return (
    <div className="mt-4 rounded-lg border border-neutral-800 bg-neutral-950/70 p-3 text-sm text-neutral-300">
      <div className="font-medium text-neutral-100">Load diagnostics</div>
      <p className="mt-1">
        Loaded using {authLabel}; mode {modeLabel}; Jira returned {diagnostics.issueCount} visible issues.
      </p>
      <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
        <div><dt className="text-neutral-500">Site</dt><dd className="text-neutral-200">{diagnostics.siteHostname}</dd></div>
        <div><dt className="text-neutral-500">View kind</dt><dd className="text-neutral-200">{diagnostics.locatorViewKind}</dd></div>
        {diagnostics.projectKey ? <div><dt className="text-neutral-500">Project</dt><dd className="text-neutral-200">{diagnostics.projectKey}</dd></div> : null}
        {diagnostics.boardId ? <div><dt className="text-neutral-500">Board id</dt><dd className="text-neutral-200">{diagnostics.boardId}</dd></div> : null}
        <div><dt className="text-neutral-500">Endpoint family</dt><dd className="text-neutral-200">{diagnostics.endpointFamily}</dd></div>
        {diagnostics.jql ? <div className="sm:col-span-2"><dt className="text-neutral-500">JQL</dt><dd className="break-words font-mono text-neutral-200">{diagnostics.jql}</dd></div> : null}
      </dl>
    </div>
  );
}

export function ExternalJiraKanbanColumns({ columns, cards, onCreateWorkspace, onOpenWorkspacePanel, onSelectCard }: { columns: ExternalKanbanColumnDto[]; cards: ExternalKanbanCardDto[]; onCreateWorkspace: (card: ExternalKanbanCardDto) => void; onOpenWorkspacePanel: (workspace: ExternalRelatedWorkspace) => void; onSelectCard: (card: ExternalKanbanCardDto) => void }) {
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
              {columnCards.map((card) => <ExternalJiraCard key={card.id} card={card} onCreateWorkspace={onCreateWorkspace} onOpenWorkspacePanel={onOpenWorkspacePanel} onSelect={onSelectCard} />)}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function createRenderableSwimlanes(boardView: ExternalJiraBoardViewDto, cards: ExternalKanbanCardDto[] = boardView.cards): Array<{ id: string; title: string; cards: ExternalKanbanCardDto[] }> {
  if (boardView.swimlanes.lanes.length === 0) return [];

  const assignedIssueKeys = new Set<string>();
  const lanes = boardView.swimlanes.lanes.map((lane) => {
    for (const issueKey of lane.issueKeys) assignedIssueKeys.add(issueKey);
    return {
      id: lane.id,
      title: lane.title,
      cards: cards.filter((card) => lane.issueKeys.includes(card.key)),
    };
  });

  const unassignedCards = cards.filter((card) => !assignedIssueKeys.has(card.key));
  if (unassignedCards.length > 0) {
    lanes.push({ id: 'no-swimlane', title: 'Other issues', cards: unassignedCards });
  }

  return lanes;
}

export function ExternalJiraCard({ card, onCreateWorkspace, onOpenWorkspacePanel, onSelect }: { card: ExternalKanbanCardDto; onCreateWorkspace?: (card: ExternalKanbanCardDto) => void; onOpenWorkspacePanel: (workspace: ExternalRelatedWorkspace) => void; onSelect: (card: ExternalKanbanCardDto) => void }) {
  const workspaceCount = card.relatedWorkspaces?.length ?? 0;
  const taskSummary = getTaskSummary(card);
  const workspaceMetrics = getWorkspaceMetrics(card);
  const primaryWorkspace = getPrimaryWorkspace(card);

  return (
    <article
      className="cursor-pointer rounded-lg border border-neutral-800 bg-neutral-950 p-3 text-left shadow-sm transition hover:border-sky-500/40 hover:bg-neutral-900 focus:outline-none focus:ring-2 focus:ring-sky-500/70"
      onClick={(event) => {
        if (isFromNestedInteractiveControl(event.target, event.currentTarget)) return;
        onSelect(card);
      }}
      onKeyDown={(event) => {
        if (isFromNestedInteractiveControl(event.target, event.currentTarget)) return;
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
      <div className="mt-3 rounded-md border border-neutral-800 bg-neutral-900/70 px-2 py-1.5 text-[11px] text-neutral-300">
        {workspaceCount === 0 ? (
          <button
            type="button"
            className="rounded border border-emerald-500/30 px-2 py-1 text-emerald-200 hover:bg-emerald-500/10 disabled:cursor-not-allowed disabled:text-emerald-200/60"
            disabled={!onCreateWorkspace}
            onClick={(event) => {
              event.stopPropagation();
              onCreateWorkspace?.(card);
            }}
            title={onCreateWorkspace ? 'Create a VK workspace for this Jira issue.' : 'Workspace creation from Jira cards is not wired yet.'}
          >
            Create Workspace
          </button>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-neutral-200">{workspaceCount === 1 ? 'Existing workspace' : `${workspaceCount} linked workspaces`}</span>
              <button
                type="button"
                className="rounded border border-emerald-500/30 px-2 py-1 text-emerald-200 hover:bg-emerald-500/10"
                onClick={(event) => {
                  event.stopPropagation();
                  if (primaryWorkspace) onOpenWorkspacePanel(primaryWorkspace);
                }}
                title="Open a side-by-side VK session panel for this workspace."
              >
                Open Workspace
              </button>
            </div>
            <WorkspaceMetricsGrid metrics={workspaceMetrics} />
          </div>
        )}
      </div>
      {taskSummary.total > 0 ? (
        <div className="mt-3 rounded-md border border-sky-500/20 bg-sky-500/10 px-2 py-1.5 text-xs text-sky-100">
          <div className="font-medium text-sky-200">{taskSummary.completed}/{taskSummary.total} tasks complete</div>
          {taskSummary.userAssignedTask ? (
            <div className="mt-1 rounded bg-sky-400/10 px-2 py-1 text-sky-100">
              Your task: {taskSummary.userAssignedTask}
            </div>
          ) : taskSummary.implicitReviewTask ? (
            <div className="mt-1 rounded bg-sky-400/10 px-2 py-1 text-sky-100">
              Suggested review: {taskSummary.implicitReviewTask}
            </div>
          ) : null}
          {taskSummary.inProgressTask ? (
            <div className="mt-1 text-sky-100/80">In progress: {taskSummary.inProgressTask}</div>
          ) : null}
          {taskSummary.nextUpTask ? (
            <div className="mt-1 text-sky-100/70">Next up: {taskSummary.nextUpTask}</div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}


export function ExternalWorkspaceCreateDialog({
  boardView,
  card,
  onClose,
  onCreated,
}: {
  boardView: ExternalJiraBoardViewDto;
  card: ExternalKanbanCardDto;
  onClose: () => void;
  onCreated: (workspace: ExternalRelatedWorkspace) => void;
}) {
  const [options, setOptions] = useState<ExternalWorkspaceCreateOptionsDto | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [cloneUrl, setCloneUrl] = useState('');
  const [prompt, setPrompt] = useState(`Work on ${card.key}: ${card.title}`);
  const [executorConfig, setExecutorConfig] = useState<VkExecutorConfigDto>({ executor: 'CODEX' });
  const [selectedRepos, setSelectedRepos] = useState<SelectedWorkspaceRepo[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    fetchExternalWorkspaceCreateOptions()
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          setError(`${result.error.message} ${result.error.userAction}`);
          return;
        }
        setOptions(result.options);
        setExecutorConfig(result.options.defaultExecutorConfig);
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
  }, []);

  async function addRepo(candidate: ExternalWorkspaceCandidateRepoDto) {
    if (selectedRepos.some((repo) => repo.path === candidate.path)) return;
    const optimistic: SelectedWorkspaceRepo = { name: candidate.name, path: candidate.path, repoId: candidate.registeredRepoId, targetBranch: candidate.defaultTargetBranch ?? 'origin/main', branches: [], loading: true };
    setSelectedRepos((repos) => [...repos, optimistic]);
    try {
      const registered = candidate.registeredRepoId ? { ok: true as const, repo: { id: candidate.registeredRepoId, path: candidate.path, name: candidate.name, display_name: candidate.name } as VkRepoDto } : await registerExternalWorkspaceRepo(candidate.path);
      if (!registered.ok) throw new Error(`${registered.error.message} ${registered.error.userAction}`);
      const branchesResult = await fetchExternalWorkspaceRepoBranches(registered.repo.id);
      if (!branchesResult.ok) throw new Error(`${branchesResult.error.message} ${branchesResult.error.userAction}`);
      setSelectedRepos((repos) => repos.map((repo) => repo.path === candidate.path ? {
        ...repo,
        repoId: registered.repo.id,
        branches: branchesResult.branches,
        targetBranch: chooseInitialBranch(branchesResult.branches, optimistic.targetBranch),
        loading: false,
      } : repo));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setSelectedRepos((repos) => repos.filter((repo) => repo.path !== candidate.path));
    }
  }

  async function cloneRepo() {
    setError(undefined);
    const trimmed = cloneUrl.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      const result = await cloneExternalWorkspaceRepo(trimmed);
      if (!result.ok) throw new Error(`${result.error.message} ${result.error.userAction}`);
      const candidate = { name: result.repo.display_name || result.repo.name, path: result.repo.path, registeredRepoId: result.repo.id, defaultTargetBranch: result.repo.default_target_branch ?? 'origin/main' };
      setOptions((current) => current ? { ...current, repos: [...current.repos, candidate].sort((a, b) => a.name.localeCompare(b.name)) } : current);
      setCloneUrl('');
      await addRepo(candidate);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSubmitting(false);
    }
  }

  async function createWorkspace() {
    setError(undefined);
    const repos = selectedRepos.filter((repo) => repo.repoId && repo.targetBranch).map((repo) => ({ repo_id: repo.repoId as string, target_branch: repo.targetBranch }));
    if (repos.length === 0) {
      setError('Select at least one repository.');
      return;
    }
    setSubmitting(true);
    try {
      const result = await createExternalIssueWorkspace({ card, prompt, repos, executorConfig, siteHostname: boardView.siteHostname });
      if (!result.ok) throw new Error(`${result.error.message} ${result.error.userAction}`);
      onCreated({
        workspaceId: result.workspace.id,
        displayName: result.workspace.name ?? card.key,
        workspaceDir: result.workspace.container_ref ?? undefined,
        isPrimary: true,
        metadata: { source: 'external-jira-create-workspace' },
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSubmitting(false);
    }
  }

  const availableRepos = options?.repos.filter((candidate) => !selectedRepos.some((repo) => repo.path === candidate.path)) ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center" role="dialog" aria-modal="true" aria-label={`Create VK workspace for ${card.key}`}>
      <div className="max-h-[90dvh] w-full max-w-3xl overflow-y-auto rounded-xl border border-neutral-800 bg-neutral-950 p-5 text-neutral-100 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300">Create VK workspace</div>
            <h2 className="mt-2 text-xl font-semibold">{card.key}: {card.title}</h2>
            <p className="mt-1 text-sm text-neutral-400">{REPO_CLONE_HELPER_TEXT}</p>
          </div>
          <button type="button" className="rounded border border-neutral-800 px-2 py-1 text-sm hover:bg-neutral-900" onClick={onClose}>Close</button>
        </div>

        {loading ? <p className="mt-4 text-sm text-neutral-400">Loading VK workspace options…</p> : null}
        {error ? <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-100">{error}</div> : null}

        <label className="mt-4 block text-sm font-medium text-neutral-200">
          Prompt
          <textarea className="mt-2 min-h-24 w-full rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-sm text-neutral-100" value={prompt} onChange={(event) => setPrompt(event.target.value)} />
        </label>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="block text-sm font-medium text-neutral-200">
            Executor
            <select className="mt-2 w-full rounded-lg border border-neutral-800 bg-neutral-900 p-2 text-sm text-neutral-100" value={executorConfig.executor} onChange={(event) => setExecutorConfig({ executor: event.target.value as VkExecutorConfigDto['executor'] })}>
              {(options?.executors.length ? options.executors : [executorConfig.executor]).map((executor) => <option key={executor} value={executor}>{executor}</option>)}
            </select>
          </label>
          <label className="block text-sm font-medium text-neutral-200">
            {REPO_CLONE_LABEL}
            <div className="mt-2 flex gap-2">
              <input className="min-w-0 flex-1 rounded-lg border border-neutral-800 bg-neutral-900 p-2 text-sm text-neutral-100" placeholder={REPO_CLONE_PLACEHOLDER} value={cloneUrl} onChange={(event) => setCloneUrl(event.target.value)} />
              <button type="button" className="rounded-lg border border-neutral-700 px-3 py-2 text-sm hover:bg-neutral-900 disabled:cursor-not-allowed disabled:opacity-50" disabled={submitting || !cloneUrl.trim()} onClick={cloneRepo}>Clone</button>
            </div>
          </label>
        </div>

        <section className="mt-5 grid gap-4 md:grid-cols-2">
          <div>
            <h3 className="text-sm font-semibold text-neutral-200">Available repos under ~/repos</h3>
            <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-neutral-800">
              {availableRepos.length === 0 ? <p className="p-3 text-sm text-neutral-500">No more repositories found.</p> : null}
              {availableRepos.map((repo) => (
                <button key={repo.path} type="button" className="block w-full border-b border-neutral-900 px-3 py-2 text-left text-sm hover:bg-neutral-900" onClick={() => addRepo(repo)}>
                  <span className="font-medium text-neutral-100">{repo.name}</span>
                  <span className="block truncate text-xs text-neutral-500">{repo.path}</span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-neutral-200">Selected repositories</h3>
            <div className="mt-2 space-y-2">
              {selectedRepos.length === 0 ? <p className="rounded-lg border border-dashed border-neutral-800 p-3 text-sm text-neutral-500">Select at least one repository.</p> : null}
              {selectedRepos.map((repo) => (
                <div key={repo.path} className="rounded-lg border border-neutral-800 bg-neutral-900/70 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{repo.name}</div>
                      <div className="truncate text-xs text-neutral-500">{repo.path}</div>
                    </div>
                    <button type="button" className="text-xs text-neutral-400 hover:text-neutral-100" onClick={() => setSelectedRepos((repos) => repos.filter((candidate) => candidate.path !== repo.path))}>Remove</button>
                  </div>
                  <label className="mt-2 block text-xs text-neutral-400">
                    Target branch
                    <select className="mt-1 w-full rounded border border-neutral-800 bg-neutral-950 p-2 text-sm text-neutral-100" disabled={repo.loading} value={repo.targetBranch} onChange={(event) => setSelectedRepos((repos) => repos.map((candidate) => candidate.path === repo.path ? { ...candidate, targetBranch: event.target.value } : candidate))}>
                      {repo.loading ? <option value={repo.targetBranch}>Loading branches…</option> : repo.branches.map((branch) => <option key={branch.name} value={branch.name}>{branch.name}</option>)}
                    </select>
                  </label>
                </div>
              ))}
            </div>
          </div>
        </section>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="rounded-lg border border-neutral-800 px-3 py-2 text-sm hover:bg-neutral-900" onClick={onClose}>Cancel</button>
          <button type="button" className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50" disabled={submitting || !prompt.trim() || selectedRepos.some((repo) => repo.loading) || selectedRepos.length === 0} onClick={createWorkspace}>Create workspace</button>
        </div>
      </div>
    </div>
  );
}

export function BulkJiraWorkspaceConversionDialog({ boardView, onClose }: { boardView: ExternalJiraBoardViewDto; onClose: () => void }) {
  const [workspaces, setWorkspaces] = useState<BulkJiraWorkspaceConversionWorkspaceDto[]>([]);
  const [repoProjectMappings, setRepoProjectMappings] = useState<BulkJiraRepoProjectMappingDto[]>([]);
  const [selectedRepoId, setSelectedRepoId] = useState('');
  const [selectedWorkspaceIds, setSelectedWorkspaceIds] = useState<Set<string>>(() => new Set());
  const [siteHostname, setSiteHostname] = useState(boardView.siteHostname);
  const [projectKey, setProjectKey] = useState(boardView.board.projectKey ?? '');
  const [issueTypeName, setIssueTypeName] = useState('Task');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [results, setResults] = useState<BulkJiraWorkspaceConversionResultDto[] | undefined>();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    fetchBulkJiraWorkspaceConversionOptions()
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          setError(`${result.error.message} ${result.error.userAction}`);
          return;
        }
        setWorkspaces(result.options.workspaces);
        setRepoProjectMappings(result.options.repoProjectMappings);
        setSelectedWorkspaceIds(new Set(getSelectableBulkWorkspaceIds(result.options.workspaces)));
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
  }, []);

  async function submit() {
    setError(undefined);
    setResults(undefined);
    const workspaceIds = [...selectedWorkspaceIds];
    if (!workspaceIds.length) {
      setError('Select at least one unlinked workspace.');
      return;
    }
    setSubmitting(true);
    try {
      const result = await bulkCreateJiraTicketsFromWorkspaces({ siteHostname, projectKey, issueTypeName, workspaceIds, repoProjectMappingRepoId: selectedRepoId || undefined });
      if (!result.ok) throw new Error(`${result.error.message} ${result.error.userAction}`);
      setResults(result.results);
      if (selectedRepoId) {
        setRepoProjectMappings((current) => upsertRepoProjectMapping(current, { repoId: selectedRepoId, provider: 'jira', siteHostname, projectKey, issueTypeName }));
      }
      const createdOrSkipped = new Set(result.results.filter((entry) => entry.status === 'created' || entry.status === 'skipped' || entry.status === 'created_mapping_failed').map((entry) => entry.workspaceId));
      setWorkspaces((current) => current.map((workspace) => {
        const created = result.results.find((entry) => entry.workspaceId === workspace.workspaceId && entry.status === 'created');
        if (created?.status === 'created') {
          return { ...workspace, hasLinkedJiraIssue: true, linkedJiraIssues: [{ provider: 'jira', key: created.issue.key, id: created.issue.id, url: created.issue.url, site: siteHostname, isPrimary: true }] };
        }
        return workspace;
      }));
      setSelectedWorkspaceIds((current) => new Set([...current].filter((workspaceId) => !createdOrSkipped.has(workspaceId))));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSubmitting(false);
    }
  }

  const repoFilterOptions = getBulkWorkspaceRepoFilterOptions(workspaces);
  const repoSelectOptions = [{ id: BULK_JIRA_ALL_REPOS_KEY, label: 'All repositories' }, ...repoFilterOptions];
  const visibleWorkspaces = filterBulkJiraWorkspacesByRepo(workspaces, selectedRepoId);
  const selectedCount = selectedWorkspaceIds.size;
  const unlinkedCount = visibleWorkspaces.filter((workspace) => !workspace.hasLinkedJiraIssue).length;

  function changeRepoFilter(repoId: string) {
    setSelectedRepoId(repoId);
    const nextVisibleWorkspaces = filterBulkJiraWorkspacesByRepo(workspaces, repoId);
    setSelectedWorkspaceIds(new Set(getSelectableBulkWorkspaceIds(nextVisibleWorkspaces)));
    const mapping = repoProjectMappings.find((candidate) => candidate.repoId === repoId);
    if (mapping) {
      setSiteHostname(mapping.siteHostname);
      setProjectKey(mapping.projectKey);
      if (mapping.issueTypeName) setIssueTypeName(mapping.issueTypeName);
    }
  }

  const createdResultsCount = results?.filter((result) => result.status === 'created' || result.status === 'created_mapping_failed').length ?? 0;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm sm:items-center" role="dialog" aria-modal="true" aria-label="Create Jira tickets from VK workspaces">
      <div className="flex max-h-[90dvh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-100 shadow-2xl">
        <header className="shrink-0 border-b border-neutral-800">
          <div className="relative w-full overflow-hidden rounded-t-2xl bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.20),transparent_30%),linear-gradient(135deg,rgba(15,23,42,0.98),rgba(10,10,10,0.98))] px-5 py-4">
            <div className="relative flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                {createdResultsCount > 0 ? <Chip size="sm" color="success" variant="flat">🎉 {createdResultsCount} created</Chip> : null}
                <h2 className={createdResultsCount > 0 ? 'mt-2 text-2xl font-semibold tracking-tight text-neutral-50' : 'text-2xl font-semibold tracking-tight text-neutral-50'}>Create Jira tickets</h2>
              </div>
              <Button size="sm" variant="flat" className="border border-neutral-700 bg-neutral-900/80 text-neutral-100" onClick={onClose}>
                Close
              </Button>
            </div>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="space-y-4 px-5 py-4">
            {loading ? (
              <Card className="border border-neutral-800 bg-neutral-900/70 text-neutral-300" shadow="none">
                <CardBody className="flex-row items-center gap-3">
                  <Spinner size="sm" />
                  <span className="text-sm">Loading VK workspaces…</span>
                </CardBody>
              </Card>
            ) : null}
            {error ? <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-100">{error}</div> : null}

            <section className="grid items-end gap-3 rounded-2xl border border-neutral-800 bg-neutral-900/45 p-3 md:grid-cols-4">
              <Select
                label="Repository filter"
                labelPlacement="outside"
                size="sm"
                items={repoSelectOptions}
                selectedKeys={new Set([selectedRepoId || BULK_JIRA_ALL_REPOS_KEY])}
                classNames={jiraSelectClassNames}
                onSelectionChange={(keys) => {
                  if (keys === 'all') return;
                  const [nextKey] = [...keys];
                  changeRepoFilter(nextKey === BULK_JIRA_ALL_REPOS_KEY ? '' : String(nextKey ?? ''));
                }}
              >
                {(repo) => <SelectItem key={repo.id}>{repo.label}</SelectItem>}
              </Select>
              <Input
                label="Jira site hostname"
                value={siteHostname}
                onValueChange={setSiteHostname}
                placeholder="team.atlassian.net"
                size="sm"
                labelPlacement="outside"
                classNames={jiraFieldClassNames}
              />
              <Input
                label="Project key"
                value={projectKey}
                onValueChange={(value) => setProjectKey(value.toUpperCase())}
                placeholder="VD"
                size="sm"
                labelPlacement="outside"
                classNames={jiraFieldClassNames}
              />
              <Select
                label="Issue type"
                labelPlacement="outside"
                size="sm"
                items={['Task', 'Story', 'Bug'].map((issueType) => ({ id: issueType, label: issueType }))}
                selectedKeys={new Set([issueTypeName])}
                classNames={jiraSelectClassNames}
                onSelectionChange={(keys) => {
                  if (keys === 'all') return;
                  const [nextKey] = [...keys];
                  if (nextKey) setIssueTypeName(String(nextKey));
                }}
              >
                {(issueType) => <SelectItem key={issueType.id}>{issueType.label}</SelectItem>}
              </Select>
            </section>

            <section className="rounded-2xl border border-neutral-800 bg-neutral-900/35">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-800 px-4 py-3 text-sm text-neutral-400">
                <div className="flex flex-wrap items-center gap-2">
                  <Chip size="sm" variant="flat" className="bg-neutral-800 text-neutral-200">{unlinkedCount} unlinked</Chip>
                  <Chip size="sm" variant="flat" className="bg-neutral-800 text-neutral-200">{selectedCount} selected</Chip>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="flat" className="bg-neutral-800 text-neutral-100" onClick={() => setSelectedWorkspaceIds(new Set(getSelectableBulkWorkspaceIds(visibleWorkspaces)))}>
                    Select all unlinked
                  </Button>
                  <Button size="sm" variant="light" className="text-neutral-300" onClick={() => setSelectedWorkspaceIds(deselectAllBulkWorkspaceIds())}>
                    Deselect all
                  </Button>
                </div>
              </div>

              <div className="max-h-[32dvh] overflow-y-auto p-2">
                {workspaces.length === 0 && !loading ? <p className="p-6 text-center text-sm text-neutral-500">No active VK workspaces found.</p> : null}
                {workspaces.length > 0 && visibleWorkspaces.length === 0 && !loading ? <p className="p-6 text-center text-sm text-neutral-500">No workspaces match this repository filter.</p> : null}
                <div className="space-y-2">
                  {visibleWorkspaces.map((workspace) => {
                    const disabled = workspace.hasLinkedJiraIssue;
                    const selected = selectedWorkspaceIds.has(workspace.workspaceId);
                    return (
                      <label key={workspace.workspaceId} className={`block rounded-xl border p-3 text-sm transition ${disabled ? 'border-neutral-800 bg-neutral-900/40 text-neutral-500' : selected ? 'border-emerald-500/35 bg-emerald-500/10 text-neutral-100 shadow-lg shadow-emerald-950/20' : 'border-neutral-800 bg-neutral-950 text-neutral-200 hover:border-neutral-700 hover:bg-neutral-900/80'}`}>
                        <div className="flex items-start gap-3">
                          <Checkbox
                            className="mt-0.5"
                            isDisabled={disabled}
                            isSelected={selected}
                            onValueChange={(checked) => setSelectedWorkspaceIds((current) => setBulkWorkspaceSelected(current, workspace.workspaceId, checked))}
                            aria-label={`Select ${workspace.displayName}`}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium text-neutral-100">{workspace.displayName}</span>
                              <Chip size="sm" variant="flat" className="bg-neutral-800 text-neutral-300">{workspace.branch}</Chip>
                              {disabled ? <Chip size="sm" variant="flat" className="bg-sky-500/10 text-sky-200">Already linked to {workspace.linkedJiraIssues.map((issue) => issue.key).join(', ')}</Chip> : null}
                            </div>
                            {workspace.workspaceDir ? <div className="mt-1 truncate text-xs text-neutral-500">{workspace.workspaceDir}</div> : null}
                            {workspace.repos.length ? <div className="mt-1 text-xs text-neutral-500">Repos: {workspace.repos.map((repo) => `${repo.displayName || repo.name} @ ${repo.targetBranch}`).join(', ')}</div> : null}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            </section>

            {results ? <BulkJiraWorkspaceConversionResults results={results} /> : null}
          </div>
        </div>

        <footer className="flex shrink-0 justify-end gap-2 border-t border-neutral-800 bg-neutral-950/95 px-5 py-3">
          <Button variant="light" className="text-neutral-300" onClick={onClose}>Cancel</Button>
          <Button color="success" variant="flat" className="border border-emerald-400/30 bg-emerald-500/15 text-emerald-50" isLoading={submitting} isDisabled={selectedCount === 0 || !siteHostname.trim() || !projectKey.trim() || !issueTypeName.trim()} onClick={submit}>
            {submitting ? 'Creating…' : `Create ${selectedCount} Jira ticket${selectedCount === 1 ? '' : 's'}`}
          </Button>
        </footer>
      </div>
    </div>
  );
}

export function getBulkWorkspaceRepoFilterOptions(workspaces: BulkJiraWorkspaceConversionWorkspaceDto[]): Array<{ id: string; label: string }> {
  const repos = new Map<string, string>();
  for (const workspace of workspaces) {
    for (const repo of workspace.repos) {
      if (!repos.has(repo.id)) repos.set(repo.id, repo.displayName || repo.name || repo.id);
    }
  }
  return [...repos.entries()]
    .map(([id, label]) => ({ id, label }))
    .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
}

export function filterBulkJiraWorkspacesByRepo(workspaces: BulkJiraWorkspaceConversionWorkspaceDto[], repoId: string): BulkJiraWorkspaceConversionWorkspaceDto[] {
  const trimmedRepoId = repoId.trim();
  if (!trimmedRepoId) return workspaces;
  return workspaces.filter((workspace) => workspace.repos.some((repo) => repo.id === trimmedRepoId));
}

export function getSelectableBulkWorkspaceIds(workspaces: BulkJiraWorkspaceConversionWorkspaceDto[]): string[] {
  return workspaces.filter((workspace) => !workspace.hasLinkedJiraIssue).map((workspace) => workspace.workspaceId);
}

export function deselectAllBulkWorkspaceIds(): Set<string> {
  return new Set<string>();
}

export function setBulkWorkspaceSelected(current: ReadonlySet<string>, workspaceId: string, selected: boolean): Set<string> {
  const next = new Set(current);
  if (selected) next.add(workspaceId);
  else next.delete(workspaceId);
  return next;
}

export function upsertRepoProjectMapping(mappings: BulkJiraRepoProjectMappingDto[], mapping: BulkJiraRepoProjectMappingDto): BulkJiraRepoProjectMappingDto[] {
  const filtered = mappings.filter((candidate) => candidate.repoId !== mapping.repoId);
  return [...filtered, mapping];
}

export function BulkJiraWorkspaceConversionResults({ results }: { results: BulkJiraWorkspaceConversionResultDto[] }) {
  return (
    <section className="mt-4 rounded-lg border border-neutral-800 bg-neutral-900/50 p-3 text-sm">
      <h3 className="font-semibold text-neutral-100">Conversion results</h3>
      <ul className="mt-2 space-y-2">
        {results.map((result) => (
          <li key={result.workspaceId} className="rounded border border-neutral-800 bg-neutral-950 px-3 py-2">
            <span className="font-medium">{result.workspaceId}</span>
            {result.status === 'created' ? <span className="ml-2 text-emerald-200">Created <a className="underline" href={result.issue.url} target="_blank" rel="noreferrer">{result.issue.key}</a></span> : null}
            {result.status === 'created_mapping_failed' ? <span className="ml-2 text-amber-200">Created <a className="underline" href={result.issue.url} target="_blank" rel="noreferrer">{result.issue.key}</a>, but VD link failed: {result.error.message} {result.error.userAction}</span> : null}
            {result.status === 'skipped' ? <span className="ml-2 text-sky-200">Skipped; already linked to {result.linkedJiraIssues.map((issue) => issue.key).join(', ')}</span> : null}
            {result.status === 'failed' ? <span className="ml-2 text-red-200">Failed: {result.error.message} {result.error.userAction}</span> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

interface SelectedWorkspaceRepo {
  name: string;
  path: string;
  repoId?: string;
  targetBranch: string;
  branches: VkBranchDto[];
  loading: boolean;
}

function chooseInitialBranch(branches: VkBranchDto[], preferred: string): string {
  if (branches.some((branch) => branch.name === preferred)) return preferred;
  return branches.find((branch) => branch.name === 'origin/main')?.name ?? branches.find((branch) => branch.name === 'main')?.name ?? branches[0]?.name ?? preferred;
}

export function ExternalVKSessionSidePanel({ workspace, onClose }: { workspace: ExternalRelatedWorkspace; onClose: () => void }) {
  const workspaceTitle = workspace.displayName || workspace.workspaceId;
  const workspaceUrl = buildVKWorkspaceSessionUrl(workspace.workspaceId);

  return (
    <aside className="min-h-[32rem] border-t border-neutral-800 bg-neutral-950 lg:sticky lg:top-0 lg:h-screen lg:w-[min(36rem,42vw)] lg:min-w-[24rem] lg:border-l lg:border-t-0" aria-label="VK session side panel">
      <div className="flex h-full min-h-0 flex-col">
        <header className="shrink-0 border-b border-neutral-800 bg-neutral-950/95 px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300">VK session</div>
              <h2 className="mt-1 truncate text-sm font-semibold text-neutral-100">{workspaceTitle}</h2>
              {workspace.workspaceDir ? <p className="mt-1 truncate text-xs text-neutral-500">{workspace.workspaceDir}</p> : null}
            </div>
            <button type="button" className="rounded-md border border-neutral-800 px-2 py-1 text-sm text-neutral-200 hover:bg-neutral-900" onClick={onClose}>
              Close
            </button>
          </div>
        </header>
        <iframe
          className="min-h-0 flex-1 border-0 bg-neutral-900"
          src={workspaceUrl}
          title={`VK session for ${workspaceTitle}`}
        />
      </div>
    </aside>
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
  return (
    <Drawer
      isOpen
      placement="right"
      size="full"
      scrollBehavior="inside"
      backdrop="opaque"
      hideCloseButton
      onClose={onClose}
      classNames={{
        backdrop: 'bg-black/60 sm:bg-black/40',
        wrapper: 'z-50 justify-end',
        base: 'm-0 flex h-dvh w-full max-w-full flex-col rounded-none border-l border-neutral-800 bg-neutral-950 text-neutral-100 shadow-2xl sm:max-w-xl',
        body: 'px-0 py-0',
      }}
    >
      <DrawerContent aria-label={`${card.key} issue details`} data-testid="external-jira-issue-drawer">
        <ExternalJiraIssueDetailDrawerContent
          boardView={boardView}
          canGoNext={canGoNext}
          canGoPrevious={canGoPrevious}
          card={card}
          cardIndex={cardIndex}
          onClose={onClose}
          onNext={onNext}
          onPrevious={onPrevious}
          totalCards={totalCards}
        />
      </DrawerContent>
    </Drawer>
  );
}

export function ExternalJiraIssueDetailDrawerContent({
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
  const taskSummary = getTaskSummary(card);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-neutral-800 bg-neutral-950/95 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-1">
            <button type="button" className="rounded-md border border-neutral-800 px-2 py-1 text-sm text-neutral-200 hover:bg-neutral-900 disabled:cursor-not-allowed disabled:opacity-40" disabled={!canGoPrevious} onClick={onPrevious} aria-label="Previous issue">←</button>
            <button type="button" className="rounded-md border border-neutral-800 px-2 py-1 text-sm text-neutral-200 hover:bg-neutral-900 disabled:cursor-not-allowed disabled:opacity-40" disabled={!canGoNext} onClick={onNext} aria-label="Next issue">→</button>
            <span className="ml-2 text-xs text-neutral-500">{cardIndex + 1} / {totalCards}</span>
          </div>
          <button type="button" className="rounded-md border border-neutral-800 px-2 py-1 text-sm text-neutral-200 hover:bg-neutral-900" onClick={onClose}>Close</button>
        </div>
      </header>
      <DrawerBody className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        <ExternalJiraIssueDetailBodyContent boardView={boardView} card={card} />
      </DrawerBody>
    </div>
  );
}

export function ExternalJiraIssueDetailBodyContent({ boardView, card }: { boardView: ExternalJiraBoardViewDto; card: ExternalKanbanCardDto }) {
  const workspaceCount = card.relatedWorkspaces?.length ?? 0;
  const taskSummary = getTaskSummary(card);

  return (
    <>
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
        <div><dt className="text-xs uppercase tracking-wide text-neutral-500">Tasks</dt><dd className="mt-1 text-neutral-200">{taskSummary.completed}/{taskSummary.total} tasks complete</dd></div>
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
        <h3 className="text-sm font-semibold text-neutral-200">Related tasks</h3>
        {card.relatedBeads?.length ? (
          <ul className="mt-3 space-y-2">
            {card.relatedBeads.map((bead) => (
              <li key={bead.id} className="rounded-lg border border-sky-500/20 bg-sky-500/10 px-3 py-2 text-sm text-sky-100">
                <div className="font-medium">{bead.id}: {bead.title}</div>
                {bead.status ? <div className="mt-1 text-xs text-sky-200/70">Status: {bead.status}</div> : null}
              </li>
            ))}
          </ul>
        ) : <p className="mt-2 text-sm text-neutral-400">No tasks have been created for this issue yet.</p>}
      </section>
      <div className="mt-6">
        <a className="inline-flex rounded-lg border border-neutral-700 px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-900" href={card.url} rel="noreferrer" target="_blank">Open in Jira</a>
      </div>
    </>
  );
}

function WorkspaceMetricsGrid({ metrics }: { metrics: WorkspaceMetrics }) {
  return (
    <dl className="grid grid-cols-2 gap-1 text-[10px] text-neutral-400">
      <div><dt>Files changed</dt><dd className="font-medium text-neutral-200">{metrics.filesChanged}</dd></div>
      <div><dt>Lines changed</dt><dd className="font-medium text-neutral-200">{metrics.linesChanged}</dd></div>
      <div><dt>Agent sessions</dt><dd className="font-medium text-neutral-200">{metrics.agentSessions}</dd></div>
      <div><dt>Agent messages</dt><dd className="font-medium text-neutral-200">{metrics.agentMessages}</dd></div>
    </dl>
  );
}

interface WorkspaceMetrics {
  filesChanged: number | string;
  linesChanged: number | string;
  agentSessions: number | string;
  agentMessages: number | string;
}

function getWorkspaceMetrics(card: ExternalKanbanCardDto): WorkspaceMetrics {
  const metadata = card.relatedWorkspaces?.[0]?.metadata;
  return {
    filesChanged: readMetric(metadata, 'filesChanged'),
    linesChanged: readMetric(metadata, 'linesChanged'),
    agentSessions: readMetric(metadata, 'agentSessions'),
    agentMessages: readMetric(metadata, 'agentMessages'),
  };
}

function getPrimaryWorkspace(card: ExternalKanbanCardDto): ExternalRelatedWorkspace | undefined {
  return card.relatedWorkspaces?.find((workspace) => workspace.isPrimary) ?? card.relatedWorkspaces?.[0];
}

function findWorkspaceById(boardView: ExternalJiraBoardViewDto, workspaceId: string | undefined): ExternalRelatedWorkspace | undefined {
  if (!workspaceId) return undefined;
  for (const card of boardView.cards) {
    const workspace = card.relatedWorkspaces?.find((candidate) => candidate.workspaceId === workspaceId);
    if (workspace) return workspace;
  }
  return undefined;
}

export function buildVKWorkspaceSessionUrl(
  workspaceId: string,
  locationLike: Pick<Location, 'protocol' | 'hostname'> | undefined = typeof window === 'undefined' ? undefined : window.location,
): string {
  const workspacePath = `/workspaces/${encodeURIComponent(workspaceId)}`;
  const hostname = locationLike?.hostname;
  if (!hostname) return workspacePath;

  const baseHostname = stripPortSubdomain(hostname);
  if (baseHostname === hostname) return workspacePath;

  return `${locationLike.protocol}//${baseHostname}${workspacePath}`;
}

export function stripPortSubdomain(hostname: string): string {
  return hostname.replace(/^port-[^.]+\./, '');
}

function readMetric(metadata: Record<string, unknown> | undefined, key: string): number | string {
  const value = metadata?.[key];
  return typeof value === 'number' || typeof value === 'string' ? value : '—';
}

function getTaskSummary(card: ExternalKanbanCardDto) {
  const tasks = card.relatedBeads ?? [];
  const completedTasks = tasks.filter((task) => isCompletedBeadStatus(task.status));
  const inProgressTask = tasks.find((task) => isInProgressTaskStatus(task.status));
  const userAssignedTask = tasks.find((task) => isUserAssignedTask(task) && !isCompletedBeadStatus(task.status));
  const nextUpTask = tasks.find((task) => task !== userAssignedTask && !isCompletedBeadStatus(task.status) && !isInProgressTaskStatus(task.status));
  const mostRecentCompleted = [...completedTasks].reverse()[0];
  return {
    total: tasks.length,
    completed: completedTasks.length,
    inProgressTask: inProgressTask?.title,
    nextUpTask: nextUpTask?.title,
    userAssignedTask: userAssignedTask?.title,
    implicitReviewTask: userAssignedTask || !mostRecentCompleted ? undefined : `Review "${mostRecentCompleted.title}"`,
  };
}

function isCompletedBeadStatus(status: string | undefined): boolean {
  if (!status) return false;
  return ['closed', 'complete', 'completed', 'done', 'resolved'].includes(status.toLowerCase());
}

function isInProgressTaskStatus(status: string | undefined): boolean {
  if (!status) return false;
  return ['in_progress', 'in-progress', 'doing', 'started'].includes(status.toLowerCase());
}

function isUserAssignedTask(task: NonNullable<ExternalKanbanCardDto['relatedBeads']>[number]): boolean {
  const metadata = task.externalIssue.metadata;
  return metadata?.assignedToCurrentUser === true || metadata?.userAssigned === true || metadata?.assignee === 'you';
}

export function isFromNestedInteractiveControl(target: EventTarget | null, currentTarget: EventTarget): boolean {
  if (target === currentTarget || !target) return false;
  const closest = (target as { closest?: unknown }).closest;
  if (typeof closest !== 'function') return false;
  const interactive = closest.call(target, 'button,a,input,select,textarea,summary,[role="link"],[data-card-interactive="true"]');
  return Boolean(interactive && interactive !== currentTarget);
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


export function getVisibleExternalJiraColumns(columns: ExternalKanbanColumnDto[], visibility: ExternalJiraColumnVisibility): ExternalKanbanColumnDto[] {
  return columns.filter((column) => {
    if (!visibility.showBacklog && isBacklogColumn(column)) return false;
    if (!visibility.showDone && isDoneColumn(column)) return false;
    return true;
  });
}

export function getVisibleExternalJiraCards(cards: ExternalKanbanCardDto[], columns: ExternalKanbanColumnDto[], visibility: ExternalJiraColumnVisibility): ExternalKanbanCardDto[] {
  const hiddenColumnIds = new Set(columns.filter((column) => (
    (!visibility.showBacklog && isBacklogColumn(column)) ||
    (!visibility.showDone && isDoneColumn(column))
  )).map((column) => column.id));
  if (hiddenColumnIds.size === 0) return cards;
  return cards.filter((card) => !card.columnId || !hiddenColumnIds.has(card.columnId));
}

function isBacklogColumn(column: ExternalKanbanColumnDto): boolean {
  return normalizeColumnTitle(column.title) === 'backlog';
}

function isDoneColumn(column: ExternalKanbanColumnDto): boolean {
  return normalizeColumnTitle(column.title) === 'done';
}

function normalizeColumnTitle(title: string): string {
  return title.trim().toLowerCase();
}

function columnToggleClassName(active: boolean): string {
  return [
    'rounded-md border px-2.5 py-1 text-xs font-medium transition',
    active ? 'border-sky-500/50 bg-sky-500/15 text-sky-100' : 'border-neutral-700 bg-neutral-950 text-neutral-300 hover:bg-neutral-800',
  ].join(' ');
}

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
    case 'unsupported_provider_url':
      return 'This external provider is not supported yet.';
    case 'missing_external_view_url':
    default:
      return 'No external view URL was provided.';
  }
}

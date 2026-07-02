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

export function ExternalJiraBoardContent({ boardView }: { boardView: ExternalJiraBoardViewDto }) {
  const columns = useMemo(() => normalizeRenderableColumns(boardView), [boardView]);
  const swimlanes = boardView.swimlanes;
  const issueCount = boardView.pagination.issueCount;
  const renderableLanes = useMemo(() => createRenderableSwimlanes(boardView), [boardView]);
  const hasLanes = renderableLanes.length > 0;

  return (
    <main className="dark min-h-screen bg-neutral-950 text-neutral-100">
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

      {issueCount === 0 ? (
        <section className="p-6">
          <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-6 text-neutral-300">This Jira board has no visible issues.</div>
        </section>
      ) : hasLanes ? (
        <section className="space-y-6 p-6">
          {renderableLanes.map((lane) => (
            <div key={lane.id} className="rounded-xl border border-neutral-800 bg-neutral-950/60 p-4">
              <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-neutral-300">{lane.title}</h2>
              <KanbanColumns columns={columns} cards={lane.cards} />
            </div>
          ))}
        </section>
      ) : (
        <section className="p-6">
          <KanbanColumns columns={columns} cards={boardView.cards} />
        </section>
      )}
    </main>
  );
}

function KanbanColumns({ columns, cards }: { columns: ExternalKanbanColumnDto[]; cards: ExternalKanbanCardDto[] }) {
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
              {columnCards.map((card) => <JiraCard key={card.id} card={card} />)}
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

function JiraCard({ card }: { card: ExternalKanbanCardDto }) {
  return (
    <article className="rounded-lg border border-neutral-800 bg-neutral-950 p-3 shadow-sm">
      <a className="text-xs font-semibold text-sky-300 hover:text-sky-200" href={card.url} rel="noreferrer" target="_blank">{card.key}</a>
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
    </article>
  );
}

function ExternalTrackerMessage({ title, message, action, code }: { title: string; message: string; action?: string; code?: string }) {
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

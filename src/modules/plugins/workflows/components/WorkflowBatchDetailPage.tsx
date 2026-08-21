import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { StandaloneDashboardPage } from '../../../../components/StandaloneDashboardPage';
import { fetchWorkflowBatchDetail, type WorkflowBatchDetailItem, type WorkflowBatchDetailModel } from '../client/workflowsHomeApi';
import { MultiRunItemList, MultiRunProgressSummary, safeWorkflowText, type WorkflowProgressCount, type WorkflowProgressItem } from './WorkflowMultiRunProgress';
import { workflowRouteHref } from './workflowRouteContext';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'pending', label: 'Pending' },
  { id: 'running', label: 'Running' },
  { id: 'completed', label: 'Complete' },
  { id: 'problem', label: 'Failed/blocked' },
] as const;

type BatchFilter = typeof FILTERS[number]['id'];

export function WorkflowBatchDetailPage(): React.ReactElement {
  const { batchId = '' } = useParams();
  const [routeParams] = useSearchParams();
  const [batch, setBatch] = useState<WorkflowBatchDetailModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!batchId) {
      setError('Batch is required.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setBatch(await fetchWorkflowBatchDetail(batchId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [batchId]);

  return <WorkflowBatchDetailView batch={batch} loading={loading} error={error} onRefresh={() => void load()} routeParams={routeParams} />;
}

export function WorkflowBatchDetailView({ batch, loading, error, onRefresh, routeParams }: { batch: WorkflowBatchDetailModel | null; loading: boolean; error: string | null; onRefresh: () => void; routeParams?: URLSearchParams }): React.ReactElement {
  const [filter, setFilter] = useState<BatchFilter>('all');
  const filteredItems = useMemo(() => filterBatchItems(batch?.items ?? [], filter), [batch?.items, filter]);
  const progressCounts = batch ? batchProgressCounts(batch) : [];
  const currentItem = batch ? batchCurrentItem(batch.items, routeParams) : null;
  const progressItems = useMemo(() => filteredItems.map((item) => batchProgressItem(item, routeParams)), [filteredItems, routeParams]);
  return (
    <StandaloneDashboardPage contentClassName="mx-auto max-w-6xl space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
        <div>
          <div className="text-xs uppercase tracking-wide text-cyan-300">Workflow batch</div>
          <h1 className="mt-1 text-2xl font-semibold">{safeWorkflowText(batch?.workflowName ?? 'Workflow batch', 160)}</h1>
          {batch ? <p className="mt-2 text-sm text-zinc-400">{batchProgressSummary(batch)}</p> : null}
        </div>
        <button className="rounded-md border border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-800 disabled:opacity-50" onClick={onRefresh} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
      </header>

      {error ? <div role="alert" className="rounded-lg border border-amber-900 bg-amber-950/30 p-4 text-sm text-amber-100">{safeWorkflowText(error)}</div> : null}

      {batch ? (
        <>
          <MultiRunProgressSummary
            eyebrow="Batch run"
            title={batch.workflowName}
            status={batch.status}
            description={batch.capacity.explanation ?? 'Batch run progress across queued workflow items.'}
            counts={progressCounts}
            currentItem={currentItem}
          />

          <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5" aria-label="Batch capacity">
            <h2 className="text-lg font-semibold">Capacity and backpressure</h2>
            <div className="mt-3 grid gap-3 text-sm md:grid-cols-2">
              <CapacityValue label="Workspace active runs" value={`${batch.capacity.workspaceActiveRuns} / ${batch.capacity.workspaceActiveRunLimit}`} />
              <CapacityValue label="Global active runs" value={`${batch.capacity.globalActiveRuns} / ${batch.capacity.globalActiveRunLimit}`} />
            </div>
            {batch.capacity.explanation ? <p className="mt-3 rounded-md border border-cyan-900/60 bg-cyan-950/20 p-3 text-sm text-cyan-100">{safeWorkflowText(batch.capacity.explanation)}</p> : null}
          </section>

          <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Batch run items</h2>
                <p className="mt-1 text-sm text-zinc-400">Each row follows the same progress pattern as meta-workflow child items.</p>
              </div>
              <div className="flex flex-wrap gap-2" aria-label="Batch item filters">
                {FILTERS.map((option) => <button key={option.id} type="button" className={`rounded-md border px-3 py-1.5 text-sm ${filter === option.id ? 'border-cyan-500 bg-cyan-950/50 text-cyan-100' : 'border-zinc-700 text-zinc-300 hover:bg-zinc-800'}`} onClick={() => setFilter(option.id)}>{option.label}</button>)}
              </div>
            </div>
            <div className="mt-4">
              <MultiRunItemList title="Batch run item progress" description="Open completed or running child workflow pages when a clean run link is available." items={progressItems} emptyText="No items match this filter." />
            </div>
            <p className="mt-3 text-xs text-zinc-500">Item recovery controls are intentionally deferred until retry and cancellation semantics are designed.</p>
          </section>
        </>
      ) : !loading && !error ? <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-950 p-6 text-sm text-zinc-400">Batch details are not available.</div> : null}
    </StandaloneDashboardPage>
  );
}

function CapacityValue({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3"><div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div><div className="mt-1 font-medium text-zinc-100">{value}</div></div>;
}

function filterBatchItems(items: WorkflowBatchDetailItem[], filter: BatchFilter): WorkflowBatchDetailItem[] {
  if (filter === 'all') return items;
  if (filter === 'problem') return items.filter((item) => item.status === 'failed' || item.status === 'blocked' || item.status === 'cancelled');
  return items.filter((item) => item.status === filter);
}

function formatTime(value: number | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString();
}


function batchProgressSummary(batch: WorkflowBatchDetailModel): string {
  const problem = batch.counts.failed + batch.counts.blocked + batch.counts.cancelled;
  return `${batch.counts.completed} complete · ${batch.counts.running} running · ${batch.counts.pending} pending · ${problem} failed/blocked`;
}

function batchProgressCounts(batch: WorkflowBatchDetailModel): WorkflowProgressCount[] {
  const problem = batch.counts.failed + batch.counts.blocked + batch.counts.cancelled;
  return [
    { label: 'Complete', value: batch.counts.completed, tone: 'success' },
    { label: 'Running', value: batch.counts.running, tone: 'active' },
    { label: 'Pending', value: batch.counts.pending, tone: 'muted' },
    { label: 'Failed/blocked', value: problem, tone: problem ? 'warning' : 'muted' },
    { label: 'Total', value: batch.counts.total },
  ];
}

function batchCurrentItem(items: WorkflowBatchDetailItem[], routeParams?: URLSearchParams): WorkflowProgressItem | null {
  const item = items.find((candidate) => candidate.status === 'running') ?? items.find((candidate) => candidate.status === 'blocked' || candidate.status === 'failed') ?? items.find((candidate) => candidate.status === 'pending') ?? null;
  return item ? batchProgressItem(item, routeParams) : null;
}

function batchProgressItem(item: WorkflowBatchDetailItem, routeParams?: URLSearchParams): WorkflowProgressItem {
  const fieldErrors = item.error?.fieldErrors ? Object.entries(item.error.fieldErrors) : [];
  const reason = [
    item.error?.message,
    ...fieldErrors.map(([field, message]) => `${field}: ${message}`),
    item.pendingReason,
  ].filter(Boolean).join(' ');
  return {
    id: item.batchItemId,
    indexLabel: `Line ${item.lineNumber}`,
    title: item.inputSummary || 'No input summary available.',
    status: item.status,
    summary: item.runId ? 'Child workflow run is available.' : null,
    reason: reason || null,
    href: item.runUrl ? workflowRouteHref(item.runUrl, routeParams) : null,
    hrefLabel: 'Open run story',
    timestamps: [
      `Updated ${formatTime(item.updatedAt)}`,
      item.startedAt ? `Started ${formatTime(item.startedAt)}` : null,
      item.completedAt ? `Completed ${formatTime(item.completedAt)}` : null,
    ].filter((value): value is string => Boolean(value)),
  };
}

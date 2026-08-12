import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router';
import { StandaloneDashboardPage } from '../../../../components/StandaloneDashboardPage';
import { fetchWorkflowBatchDetail, type WorkflowBatchDetailItem, type WorkflowBatchDetailModel } from '../client/workflowsHomeApi';

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

  return <WorkflowBatchDetailView batch={batch} loading={loading} error={error} onRefresh={() => void load()} />;
}

export function WorkflowBatchDetailView({ batch, loading, error, onRefresh }: { batch: WorkflowBatchDetailModel | null; loading: boolean; error: string | null; onRefresh: () => void }): React.ReactElement {
  const [filter, setFilter] = useState<BatchFilter>('all');
  const items = useMemo(() => filterBatchItems(batch?.items ?? [], filter), [batch?.items, filter]);
  return (
    <StandaloneDashboardPage contentClassName="mx-auto max-w-6xl space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
        <div>
          <div className="text-xs uppercase tracking-wide text-cyan-300">Workflow batch</div>
          <h1 className="mt-1 text-2xl font-semibold">{batch?.workflowName ?? 'Workflow batch'}</h1>
          {batch ? <p className="mt-2 text-sm text-zinc-400">{batch.counts.completed} complete · {batch.counts.running} running · {batch.counts.pending} pending · {batch.counts.failed + batch.counts.blocked + batch.counts.cancelled} failed/blocked</p> : null}
        </div>
        <button className="rounded-md border border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-800 disabled:opacity-50" onClick={onRefresh} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
      </header>

      {error ? <div role="alert" className="rounded-lg border border-amber-900 bg-amber-950/30 p-4 text-sm text-amber-100">{error}</div> : null}

      {batch ? (
        <>
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5" aria-label="Batch capacity">
            <h2 className="text-lg font-semibold">Capacity and backpressure</h2>
            <div className="mt-3 grid gap-3 text-sm md:grid-cols-2">
              <CapacityValue label="Workspace active runs" value={`${batch.capacity.workspaceActiveRuns} / ${batch.capacity.workspaceActiveRunLimit}`} />
              <CapacityValue label="Global active runs" value={`${batch.capacity.globalActiveRuns} / ${batch.capacity.globalActiveRunLimit}`} />
            </div>
            {batch.capacity.explanation ? <p className="mt-3 rounded-md border border-cyan-900/60 bg-cyan-950/20 p-3 text-sm text-cyan-100">{batch.capacity.explanation}</p> : null}
          </section>

          <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Batch items</h2>
              <div className="flex flex-wrap gap-2" aria-label="Batch item filters">
                {FILTERS.map((option) => <button key={option.id} type="button" className={`rounded-md border px-3 py-1.5 text-sm ${filter === option.id ? 'border-cyan-500 bg-cyan-950/50 text-cyan-100' : 'border-zinc-700 text-zinc-300 hover:bg-zinc-800'}`} onClick={() => setFilter(option.id)}>{option.label}</button>)}
              </div>
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[760px] border-separate border-spacing-y-2 text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-zinc-500">
                  <tr><th className="px-3 py-2">Line</th><th className="px-3 py-2">Input</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Run</th><th className="px-3 py-2">Error</th><th className="px-3 py-2">Timestamps</th></tr>
                </thead>
                <tbody>
                  {items.map((item) => <BatchDetailRow key={item.batchItemId} item={item} />)}
                </tbody>
              </table>
              {!items.length ? <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-950 p-6 text-sm text-zinc-400">No items match this filter.</div> : null}
            </div>
            <p className="mt-3 text-xs text-zinc-500">Item recovery controls are intentionally deferred until retry and cancellation semantics are designed.</p>
          </section>
        </>
      ) : !loading && !error ? <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-950 p-6 text-sm text-zinc-400">Batch details are not available.</div> : null}
    </StandaloneDashboardPage>
  );
}

function BatchDetailRow({ item }: { item: WorkflowBatchDetailItem }) {
  const isProblem = item.status === 'failed' || item.status === 'blocked' || item.status === 'cancelled';
  const fieldErrors = item.error?.fieldErrors ? Object.entries(item.error.fieldErrors) : [];
  return (
    <tr className={`align-top ${isProblem ? 'bg-amber-950/20' : 'bg-zinc-950'}`}>
      <td className="rounded-l-lg border-y border-l border-zinc-800 px-3 py-3 font-medium">Line {item.lineNumber}</td>
      <td className="border-y border-zinc-800 px-3 py-3 text-zinc-200">{item.inputSummary}</td>
      <td className="border-y border-zinc-800 px-3 py-3"><span className={isProblem ? 'text-amber-200' : 'text-zinc-200'}>{humanBatchItemStatus(item.status)}</span>{item.pendingReason ? <p className="mt-1 text-xs text-cyan-200">{item.pendingReason}</p> : null}</td>
      <td className="border-y border-zinc-800 px-3 py-3">{item.runUrl ? <a className="text-cyan-200 underline-offset-2 hover:underline" href={item.runUrl}>Open run</a> : <span className="text-zinc-500">Not launched yet</span>}</td>
      <td className="border-y border-zinc-800 px-3 py-3 text-amber-100">{item.error ? <div><p>{item.error.message}</p>{fieldErrors.length ? <ul className="mt-1 list-disc pl-5 text-amber-200">{fieldErrors.map(([field, message]) => <li key={field}>{field}: {message}</li>)}</ul> : null}</div> : <span className="text-zinc-500">None</span>}</td>
      <td className="rounded-r-lg border-y border-r border-zinc-800 px-3 py-3 text-zinc-400"><div>Updated {formatTime(item.updatedAt)}</div>{item.startedAt ? <div>Started {formatTime(item.startedAt)}</div> : null}{item.completedAt ? <div>Completed {formatTime(item.completedAt)}</div> : null}</td>
    </tr>
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

function humanBatchItemStatus(status: string): string {
  if (status === 'completed') return 'Complete';
  if (status === 'running') return 'Running';
  if (status === 'pending') return 'Pending';
  if (status === 'blocked') return 'Blocked';
  if (status === 'cancelled') return 'Cancelled';
  return 'Failed';
}

function formatTime(value: number | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString();
}

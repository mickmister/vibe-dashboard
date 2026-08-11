import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { fetchWorkspaceWorkflowsHome, type WorkspaceWorkflowsHomeModel, type WorkspaceWorkflowAttentionSummary, type WorkspaceWorkflowRunSummary, type WorkspaceWorkflowSummary } from '../client/workflowsHomeApi';

export function WorkspaceWorkflowsPage(): React.ReactElement {
  const [params] = useSearchParams();
  const workspaceId = params.get('workspaceId') || params.get('workspace') || '';
  const [home, setHome] = useState<WorkspaceWorkflowsHomeModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!workspaceId) {
      setError('Workspace is required.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setHome(await fetchWorkspaceWorkflowsHome(workspaceId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [workspaceId]);

  return <WorkspaceWorkflowsHomeView home={home} loading={loading} error={error} onRefresh={() => void load()} />;
}

export function WorkspaceWorkflowsHomeView({ home, loading, error, onRefresh }: {
  home: WorkspaceWorkflowsHomeModel | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}): React.ReactElement {
  return (
    <main className="min-h-screen bg-zinc-950 p-6 text-zinc-100">
      <div className="mx-auto max-w-6xl space-y-5">
        <header className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
          <div>
            <div className="text-xs uppercase tracking-wide text-cyan-300">Workspace</div>
            <h1 className="mt-1 text-2xl font-semibold">Workflows</h1>
          </div>
          <button className="rounded-md border border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-800 disabled:opacity-50" onClick={onRefresh} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
        </header>

        {error ? <div role="alert" className="rounded-lg border border-amber-900 bg-amber-950/30 p-4 text-sm text-amber-100">{error}</div> : null}

        <Section title="Needs your input">
          {home?.needsInput.length ? <div className="grid gap-3 md:grid-cols-2">{home.needsInput.map((item) => <AttentionCard key={item.attentionItemId} item={item} />)}</div> : <EmptyState text="Nothing needs your input right now." />}
        </Section>

        <Section title="Available workflows">
          {home?.availableWorkflows.length ? <div className="grid gap-3 md:grid-cols-2">{home.availableWorkflows.map((workflow) => <WorkflowCard key={`${workflow.source}:${workflow.id}`} workflow={workflow} />)}</div> : <EmptyState text="No workflows are available yet." />}
        </Section>

        <Section title="Recent runs">
          {home?.recentRuns.length ? <div className="space-y-3">{home.recentRuns.map((run) => <RunRow key={run.runId} run={run} />)}</div> : <EmptyState text="No workflow runs in this workspace yet." />}
        </Section>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5"><h2 className="text-lg font-semibold">{title}</h2><div className="mt-4">{children}</div></section>;
}

function WorkflowCard({ workflow }: { workflow: WorkspaceWorkflowSummary }) {
  return (
    <article className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">{workflow.title}</h3>
          {workflow.description ? <p className="mt-2 text-sm text-zinc-300">{workflow.description}</p> : null}
          <p className="mt-3 text-xs text-zinc-500">{workflow.source === 'template' ? 'Template' : workflow.version ? `Published version ${workflow.version}` : 'Draft'}</p>
        </div>
        <StatusPill label={workflow.status === 'ready' ? 'Ready' : 'Unavailable'} tone={workflow.status === 'ready' ? 'emerald' : 'amber'} />
      </div>
      {workflow.unavailableReason ? <p className="mt-3 text-sm text-amber-200">{workflow.unavailableReason}</p> : null}
    </article>
  );
}

function RunRow({ run }: { run: WorkspaceWorkflowRunSummary }) {
  return (
    <a className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950 p-4 hover:border-cyan-800" href={run.detailUrl}>
      <div>
        <h3 className="font-semibold">{run.workflowName}</h3>
        <p className="mt-1 text-sm text-zinc-400">Updated {formatTime(run.updatedAt)}</p>
      </div>
      <StatusPill label={humanRunStatus(run.status)} tone={run.status === 'completed' ? 'emerald' : run.status === 'blocked' ? 'amber' : run.status === 'failed' ? 'red' : 'cyan'} />
    </a>
  );
}

function AttentionCard({ item }: { item: WorkspaceWorkflowAttentionSummary }) {
  const body = (
    <article className="rounded-lg border border-amber-900 bg-amber-950/30 p-4">
      <div className="text-xs uppercase tracking-wide text-amber-200">Needs your input</div>
      <h3 className="mt-1 font-semibold">{item.title}</h3>
      {item.description ? <p className="mt-2 text-sm text-amber-50">{item.description}</p> : null}
      <p className="mt-3 text-xs text-amber-200">{item.workflowName}</p>
    </article>
  );
  return item.detailUrl ? <a className="block hover:opacity-90" href={item.detailUrl}>{body}</a> : body;
}

function EmptyState({ text }: { text: string }) {
  return <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-950 p-6 text-sm text-zinc-400">{text}</div>;
}

function StatusPill({ label, tone }: { label: string; tone: 'emerald' | 'cyan' | 'amber' | 'red' }) {
  const classes = {
    emerald: 'border-emerald-800 bg-emerald-950/40 text-emerald-200',
    cyan: 'border-cyan-800 bg-cyan-950/40 text-cyan-200',
    amber: 'border-amber-800 bg-amber-950/40 text-amber-200',
    red: 'border-red-800 bg-red-950/40 text-red-200',
  }[tone];
  return <span className={`rounded-full border px-2.5 py-1 text-xs ${classes}`}>{label}</span>;
}

function humanRunStatus(status: string): string {
  if (status === 'completed') return 'Complete';
  if (status === 'blocked') return 'Needs attention';
  if (status === 'failed') return 'Failed';
  if (status === 'cancelled') return 'Cancelled';
  return 'Running';
}

function formatTime(value: number): string {
  if (!Number.isFinite(value)) return 'recently';
  return new Date(value).toLocaleString();
}

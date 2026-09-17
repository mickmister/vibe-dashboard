import React from 'react';
import type { WorkspaceWorkflowsHomeModel } from '../client/workflowsHomeApi';
import type { WorkflowPresentationModel } from '../../../../lib/workflowPresentationApi';

export function CentralizedWorkflowPageConcept({
  home,
  selectedRun,
}: {
  home: WorkspaceWorkflowsHomeModel;
  selectedRun: WorkflowPresentationModel;
}): React.ReactElement {
  return (
    <main className="mx-auto grid max-w-7xl gap-5 lg:grid-cols-[18rem_minmax(0,1fr)]" aria-label="Centralized workflows concept">
      <aside className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
        <div className="text-xs uppercase tracking-wide text-cyan-300">Concept only</div>
        <h2 className="mt-1 text-lg font-semibold">Workflow center</h2>
        <nav className="mt-4 space-y-2 text-sm">
          {['Overview', 'Designs', 'Runs', 'Needs input', 'Batches', 'Diagnostics'].map((item, index) => (
            <div key={item} className={`rounded-lg px-3 py-2 ${index === 0 ? 'bg-cyan-950/50 text-cyan-100' : 'text-zinc-300'}`}>{item}</div>
          ))}
        </nav>
        <p className="mt-4 rounded-lg border border-amber-900 bg-amber-950/30 p-3 text-xs text-amber-100">
          This is a Storybook IA concept for M113. It has no route, API, or working actions.
        </p>
      </aside>
      <section className="space-y-5">
        <header className="rounded-xl border border-slate-800 bg-slate-900/70 p-5">
          <div className="text-xs uppercase tracking-wide text-cyan-300">Workspace scoped runs</div>
          <h1 className="mt-1 text-2xl font-semibold">Everything workflows in {home.workspaceId}</h1>
          <p className="mt-2 text-sm text-zinc-300">Global workflow designs, workspace runs, attention, batches, and automation provenance in one product surface.</p>
        </header>
        <div className="grid gap-4 md:grid-cols-3">
          <MetricCard label="Your workflows" value={String(home.userWorkflows.length)} />
          <MetricCard label="Needs input" value={String(home.needsInput.length)} tone="amber" />
          <MetricCard label="Recent runs" value={String(home.recentRuns.length)} />
        </div>
        <article className="rounded-xl border border-slate-800 bg-slate-900/70 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Current run story</h2>
              <p className="mt-1 text-sm text-zinc-400">{selectedRun.workflowName}</p>
            </div>
            <span className="rounded-full border border-cyan-800 bg-cyan-950/40 px-2.5 py-1 text-xs text-cyan-200">{selectedRun.summary?.statusLabel ?? selectedRun.status}</span>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div className="rounded-lg border border-slate-800 bg-slate-950 p-4">
              <div className="text-xs uppercase tracking-wide text-zinc-500">Waiting reason</div>
              <p className="mt-2 text-sm text-zinc-100">{selectedRun.summary?.waitingReason ?? 'Not waiting.'}</p>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-950 p-4">
              <div className="text-xs uppercase tracking-wide text-zinc-500">Next action</div>
              <p className="mt-2 text-sm text-zinc-100">{selectedRun.summary?.nextAction ?? 'No next action.'}</p>
            </div>
          </div>
        </article>
      </section>
    </main>
  );
}

function MetricCard({ label, value, tone = 'cyan' }: { label: string; value: string; tone?: 'cyan' | 'amber' }): React.ReactElement {
  const color = tone === 'amber' ? 'text-amber-200 border-amber-900 bg-amber-950/20' : 'text-cyan-200 border-cyan-900 bg-cyan-950/20';
  return (
    <article className={`rounded-xl border p-4 ${color}`}>
      <div className="text-xs uppercase tracking-wide opacity-80">{label}</div>
      <div className="mt-2 text-3xl font-semibold">{value}</div>
    </article>
  );
}

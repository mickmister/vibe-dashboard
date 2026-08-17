import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { StandaloneDashboardPage } from "../../../../components/StandaloneDashboardPage";
import { fetchWorkspaceWorkflowsHome, type WorkspaceWorkflowSummary } from "../client/workflowsHomeApi";
import {
  createMetaWorkflowRun,
  fetchMetaWorkflowRuns,
  pauseMetaWorkflowRun,
  resumeMetaWorkflowRun,
  searchMetaWorkflowBeads,
  type MetaWorkflowBeadSummary,
  type MetaWorkflowRunModel,
} from "../client/metaWorkflowApi";

export function WorkflowMetaRunsPage({ workspaceId: workspaceIdOverride, embedded = false }: { workspaceId?: string; embedded?: boolean; navigate?: unknown }): React.ReactElement {
  const [params] = useSearchParams();
  const workspaceId = workspaceIdOverride || params.get("workspaceId") || params.get("workspace") || "";
  const [workflows, setWorkflows] = useState<WorkspaceWorkflowSummary[]>([]);
  const [runs, setRuns] = useState<MetaWorkflowRunModel[]>([]);
  const [beads, setBeads] = useState<MetaWorkflowBeadSummary[]>([]);
  const [selected, setSelected] = useState<MetaWorkflowBeadSummary[]>([]);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"current_workspace" | "no_workspace" | "other_workspaces">("current_workspace");
  const [childWorkflowId, setChildWorkflowId] = useState("");
  const [unavailableReason, setUnavailableReason] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!workspaceId) {
      setError("Workspace is required.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [home, metaRuns, search] = await Promise.all([
        fetchWorkspaceWorkflowsHome(workspaceId),
        fetchMetaWorkflowRuns(workspaceId).catch(() => []),
        searchMetaWorkflowBeads({ workspaceId, query, scope }),
      ]);
      const runnable = [...home.userWorkflows, ...home.starterTemplates].filter((workflow) => workflow.canRun && workflow.version != null);
      setWorkflows(runnable);
      setRuns(metaRuns);
      setBeads(search.beads);
      setUnavailableReason(search.unavailableReason);
      if (!childWorkflowId && runnable[0]) setChildWorkflowId(runnable[0].id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [workspaceId, scope]);

  const selectedIds = useMemo(() => selected.map((bead) => bead.beadId), [selected]);
  const duplicateIds = useMemo(() => selectedIds.filter((id, index) => selectedIds.indexOf(id) !== index), [selectedIds]);
  const childWorkflow = workflows.find((workflow) => workflow.id === childWorkflowId) ?? null;
  const canStart = Boolean(workspaceId && childWorkflow?.version != null && selected.length > 0 && duplicateIds.length === 0);

  const addBead = (bead: MetaWorkflowBeadSummary) => setSelected((current) => [...current, bead]);
  const removeBead = (index: number) => setSelected((current) => current.filter((_, i) => i !== index));
  const moveBead = (index: number, delta: number) => setSelected((current) => {
    const next = [...current];
    const target = index + delta;
    if (target < 0 || target >= next.length) return current;
    const [item] = next.splice(index, 1);
    if (!item) return current;
    next.splice(target, 0, item);
    return next;
  });

  const start = async () => {
    if (!childWorkflow || !canStart) return;
    setStatus("Starting meta-workflow…");
    setError(null);
    try {
      const roleBindings = Object.fromEntries(childWorkflow.roles.map((role) => [role.id, { mode: "create_or_reuse" as const, name: role.label || role.id }]));
      const created = await createMetaWorkflowRun({
        workspaceId,
        beadIds: selectedIds,
        childWorkflow: { designId: childWorkflow.id, version: childWorkflow.version },
        roleBindings,
      });
      setRuns((current) => [created.metaRun, ...current.filter((run) => run.metaRunId !== created.metaRun.metaRunId)]);
      setStatus(`Started ${created.metaRun.title}.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const pause = async (runId: string) => {
    const updated = await pauseMetaWorkflowRun(runId);
    setRuns((current) => [updated, ...current.filter((run) => run.metaRunId !== runId)]);
  };
  const resume = async (runId: string) => {
    const updated = await resumeMetaWorkflowRun(runId);
    setRuns((current) => [updated, ...current.filter((run) => run.metaRunId !== runId)]);
  };

  return <WorkflowMetaRunsView {...{ workspaceId, workflows, runs, beads, selected, query, scope, childWorkflowId, unavailableReason, status, error, loading, embedded, duplicateIds, canStart, setQuery, setScope, setChildWorkflowId, addBead, removeBead, moveBead, onSearch: load, onStart: start, onRefresh: load, onPause: pause, onResume: resume }} />;
}

export function WorkflowMetaRunsView(props: {
  workspaceId: string;
  workflows: WorkspaceWorkflowSummary[];
  runs: MetaWorkflowRunModel[];
  beads: MetaWorkflowBeadSummary[];
  selected: MetaWorkflowBeadSummary[];
  query: string;
  scope: "current_workspace" | "no_workspace" | "other_workspaces";
  childWorkflowId: string;
  unavailableReason: string | null;
  status: string | null;
  error: string | null;
  loading: boolean;
  embedded?: boolean;
  duplicateIds: string[];
  canStart: boolean;
  setQuery: (value: string) => void;
  setScope: (value: "current_workspace" | "no_workspace" | "other_workspaces") => void;
  setChildWorkflowId: (value: string) => void;
  addBead: (bead: MetaWorkflowBeadSummary) => void;
  removeBead: (index: number) => void;
  moveBead: (index: number, delta: number) => void;
  onSearch: () => void;
  onStart: () => void;
  onRefresh: () => void;
  onPause: (runId: string) => void;
  onResume: (runId: string) => void;
}): React.ReactElement {
  return (
    <StandaloneDashboardPage className={props.embedded ? "h-full" : ""} contentClassName="mx-auto max-w-7xl space-y-5">
      <header className="rounded-xl border border-slate-800 bg-slate-900/70 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-cyan-300">Sequential bead workflows</div>
            <h1 className="mt-1 text-2xl font-semibold">Meta-workflows</h1>
            <p className="mt-2 max-w-3xl text-sm text-zinc-300">Select ordered beads for {props.workspaceId || "this workspace"}, choose a child workflow, then monitor one active bead at a time.</p>
          </div>
          <div className="flex gap-2">
            <a className="rounded-md border border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-800" href="/dashboard/workflows/roadmap">Start from roadmap</a>
            <button className="rounded-md border border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-800" onClick={props.onRefresh} disabled={props.loading}>{props.loading ? "Refreshing…" : "Refresh"}</button>
          </div>
        </div>
      </header>
      {props.error ? <div role="alert" className="rounded-lg border border-rose-900 bg-rose-950/30 p-4 text-sm text-rose-100">{props.error}</div> : null}
      {props.status ? <div className="rounded-lg border border-cyan-900 bg-cyan-950/30 p-4 text-sm text-cyan-100">{props.status}</div> : null}
      <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="space-y-5">
          <Panel title="Find beads" description="Current workspace beads are shown by default. Include no-workspace or other-workspace beads only when intentional.">
            <div className="flex flex-wrap gap-2">
              <input aria-label="Search beads" value={props.query} onChange={(event) => props.setQuery(event.target.value)} className="min-w-64 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm" placeholder="Search bead title or id" />
              <select aria-label="Bead filter" value={props.scope} onChange={(event) => props.setScope(event.target.value as typeof props.scope)} className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm">
                <option value="current_workspace">Current workspace parent beads</option>
                <option value="no_workspace">No workspace metadata</option>
                <option value="other_workspaces">Other workspaces</option>
              </select>
              <button className="rounded-md border border-cyan-800 px-3 py-2 text-sm text-cyan-100" onClick={props.onSearch}>Search</button>
            </div>
            {props.scope !== "current_workspace" ? <p className="mt-2 text-xs text-amber-200">This filter can include beads outside the default workspace scope. Review each bead before starting.</p> : null}
            {props.unavailableReason ? <p className="mt-2 text-sm text-amber-200">{props.unavailableReason}</p> : null}
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {props.beads.map((bead) => <BeadResult key={bead.beadId} bead={bead} onAdd={() => props.addBead(bead)} />)}
              {!props.beads.length ? <p className="text-sm text-zinc-400">No beads found for this filter.</p> : null}
            </div>
          </Panel>
          <Panel title="Monitor meta-workflows" description="Sequential runs show active, pending, completed, and blocked bead items with supported child workflow links.">
            <div className="space-y-3">{props.runs.map((run) => <MetaRunCard key={run.metaRunId} run={run} onPause={() => props.onPause(run.metaRunId)} onResume={() => props.onResume(run.metaRunId)} />)}{!props.runs.length ? <p className="text-sm text-zinc-400">No meta-workflows yet.</p> : null}</div>
          </Panel>
        </div>
        <aside className="space-y-5">
          <Panel title="Selected bead order" description="The child workflow runs against one bead at a time in this order.">
            <ol className="space-y-2">{props.selected.map((bead, index) => <li key={`${bead.beadId}:${index}`} className="rounded-lg border border-slate-800 bg-slate-950 p-3"><div className="flex items-start justify-between gap-2"><div><div className="text-xs text-zinc-500">{index + 1}</div><div className="font-medium text-zinc-100">{bead.title}</div><div className="text-xs text-zinc-500">{bead.beadId}</div>{props.duplicateIds.includes(bead.beadId) ? <div className="mt-1 text-xs text-rose-200">Duplicate bead selected. Remove one copy before starting.</div> : null}</div><div className="flex gap-1"><button aria-label={`Move ${bead.beadId} up`} onClick={() => props.moveBead(index, -1)} className="rounded border border-slate-700 px-2 text-xs">Up</button><button aria-label={`Move ${bead.beadId} down`} onClick={() => props.moveBead(index, 1)} className="rounded border border-slate-700 px-2 text-xs">Down</button><button aria-label={`Remove ${bead.beadId}`} onClick={() => props.removeBead(index)} className="rounded border border-rose-800 px-2 text-xs text-rose-200">Remove</button></div></div></li>)}{!props.selected.length ? <li className="text-sm text-zinc-400">Add beads from search results.</li> : null}</ol>
          </Panel>
          <Panel title="Child workflow" description="A published workflow version is pinned when this meta-workflow starts.">
            <select aria-label="Child workflow" value={props.childWorkflowId} onChange={(event) => props.setChildWorkflowId(event.target.value)} className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm">
              <option value="">Choose workflow</option>
              {props.workflows.map((workflow) => <option key={workflow.id} value={workflow.id}>{workflow.title}{workflow.version ? ` v${workflow.version}` : ""}</option>)}
            </select>
            <button className="mt-3 w-full rounded-md bg-cyan-500 px-3 py-2 text-sm font-medium text-zinc-950 disabled:opacity-50" disabled={!props.canStart} onClick={props.onStart}>Start sequential meta-workflow</button>
            {!props.canStart ? <p className="mt-2 text-xs text-zinc-400">Select at least one non-duplicate bead and a published child workflow.</p> : null}
          </Panel>
        </aside>
      </section>
    </StandaloneDashboardPage>
  );
}

function Panel({ title, description, children }: { title: string; description: string; children: React.ReactNode }): React.ReactElement {
  return <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-4"><h2 className="font-semibold text-zinc-50">{title}</h2><p className="mt-1 text-sm text-zinc-400">{description}</p><div className="mt-4">{children}</div></section>;
}

function BeadResult({ bead, onAdd }: { bead: MetaWorkflowBeadSummary; onAdd: () => void }): React.ReactElement {
  return <article className="rounded-lg border border-slate-800 bg-slate-950 p-3"><div className="flex items-start justify-between gap-3"><div><h3 className="font-medium text-zinc-100">{bead.title}</h3><p className="text-xs text-zinc-500">{bead.beadId}</p><p className="mt-1 text-xs text-zinc-400">{bead.workspaceId ? `Workspace ${bead.workspaceId}` : "No workspace metadata"} · {bead.status}</p>{!bead.accessible ? <p className="mt-1 text-xs text-rose-200">Unavailable to this workflow.</p> : null}</div><button className="rounded-md border border-cyan-800 px-2 py-1 text-xs text-cyan-100 disabled:opacity-50" disabled={!bead.accessible || bead.status === "archived" || bead.status === "removed"} onClick={onAdd}>Add</button></div></article>;
}

function MetaRunCard({ run, onPause, onResume }: { run: MetaWorkflowRunModel; onPause: () => void; onResume: () => void }): React.ReactElement {
  const canPause = run.status === "running";
  const canResume = run.status === "paused";
  return <article className="rounded-lg border border-slate-800 bg-slate-950 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold text-zinc-100">{run.title}</h3><p className="mt-1 text-sm text-zinc-400">{run.nextAction}</p>{run.blockedReason ? <p className="mt-2 text-sm text-rose-200">Blocked: {run.blockedReason.message}</p> : null}</div><div className="flex gap-2"><StatusPill status={run.status} /><button className="rounded border border-slate-700 px-2 py-1 text-xs disabled:opacity-50" disabled={!canPause} onClick={onPause}>Pause</button><button className="rounded border border-cyan-800 px-2 py-1 text-xs text-cyan-100 disabled:opacity-50" disabled={!canResume} onClick={onResume}>Resume</button></div></div><div className="mt-3 grid gap-2 md:grid-cols-5"><Metric label="Completed" value={run.progress.completed} /><Metric label="Active" value={run.progress.running} /><Metric label="Pending" value={run.progress.pending} /><Metric label="Blocked" value={run.progress.blocked} /><Metric label="Total" value={run.progress.total} /></div><ol className="mt-3 space-y-2">{run.items.map((item) => <li key={item.itemId} className="rounded border border-slate-800 bg-slate-900 p-2 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><span>{item.index + 1}. {item.title}</span><StatusPill status={item.status} /></div>{typeof item.result?.summary === "string" ? <p className="mt-1 text-zinc-300">{item.result.summary}</p> : null}{item.error ? <p className="mt-1 text-rose-200">{item.error.message}</p> : null}{item.childRunId ? <a className="mt-1 inline-block text-xs text-cyan-200" href={`/dashboard/workflows/${encodeURIComponent(item.childRunId)}`}>Open child workflow</a> : null}</li>)}</ol></article>;
}

function Metric({ label, value }: { label: string; value: number }): React.ReactElement { return <div className="rounded border border-slate-800 bg-slate-900 p-2"><div className="text-xs text-zinc-500">{label}</div><div className="text-lg font-semibold">{value}</div></div>; }
function StatusPill({ status }: { status: string }): React.ReactElement { return <span className="rounded-full border border-slate-700 px-2 py-1 text-xs text-zinc-200">{status}</span>; }

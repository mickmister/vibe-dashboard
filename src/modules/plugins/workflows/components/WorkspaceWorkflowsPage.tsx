import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  batchLaunchWorkspaceWorkflow,
  fetchWorkflowLaunchOptions,
  fetchWorkspaceWorkflowsHome,
  launchWorkspaceWorkflow,
  useWorkflowTemplate,
  WorkflowApiError,
  type WorkflowLaunchOptions,
  type WorkflowLaunchRoleBindingRequest,
  type WorkspaceWorkflowInputSummary,
  type WorkspaceWorkflowsHomeModel,
  type WorkspaceWorkflowAttentionSummary,
  type WorkspaceWorkflowBatchSummary,
  type WorkspaceWorkflowRunSummary,
  type WorkspaceWorkflowSummary,
} from '../client/workflowsHomeApi';

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

  return <WorkspaceWorkflowsHomeView home={home} loading={loading} error={error} onRefresh={() => void load()} onHomeUpdated={setHome} />;
}

export function WorkspaceWorkflowsHomeView({ home, loading, error, onRefresh, onHomeUpdated }: {
  home: WorkspaceWorkflowsHomeModel | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onHomeUpdated?: (home: WorkspaceWorkflowsHomeModel) => void;
}): React.ReactElement {
  const [launchWorkflow, setLaunchWorkflow] = useState<WorkspaceWorkflowSummary | null>(null);
  const [batchWorkflow, setBatchWorkflow] = useState<WorkspaceWorkflowSummary | null>(null);
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
          {home?.availableWorkflows.length ? <div className="grid gap-3 md:grid-cols-2">{home.availableWorkflows.map((workflow) => <WorkflowCard key={`${workflow.source}:${workflow.id}`} workflow={workflow} workspaceId={home.workspaceId} onRun={() => setLaunchWorkflow(workflow)} onBatch={() => setBatchWorkflow(workflow)} onUsed={(updated) => onHomeUpdated?.(updated)} />)}</div> : <EmptyState text="No workflows are available yet." />}
        </Section>

        <Section title="Recent batches">
          {home?.recentBatches.length ? <div className="space-y-3">{home.recentBatches.map((batch) => <BatchRow key={batch.batchId} batch={batch} />)}</div> : <EmptyState text="No workflow batches in this workspace yet." />}
        </Section>

        <Section title="Recent runs">
          {home?.recentRuns.length ? <div className="space-y-3">{home.recentRuns.map((run) => <RunRow key={run.runId} run={run} />)}</div> : <EmptyState text="No workflow runs in this workspace yet." />}
        </Section>
      </div>
      {home && launchWorkflow ? (
        <RunWorkflowDialog
          workspaceId={home.workspaceId}
          workflow={launchWorkflow}
          onClose={() => setLaunchWorkflow(null)}
          onLaunched={(updated) => {
            onHomeUpdated?.(updated);
            setLaunchWorkflow(null);
          }}
        />
      ) : null}
      {home && batchWorkflow ? (
        <BatchRunWorkflowDialog
          workspaceId={home.workspaceId}
          workflow={batchWorkflow}
          onClose={() => setBatchWorkflow(null)}
          onQueued={(updated) => {
            onHomeUpdated?.(updated);
            setBatchWorkflow(null);
          }}
        />
      ) : null}
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5"><h2 className="text-lg font-semibold">{title}</h2><div className="mt-4">{children}</div></section>;
}

function WorkflowCard({ workflow, workspaceId, onRun, onBatch, onUsed }: { workflow: WorkspaceWorkflowSummary; workspaceId: string; onRun: () => void; onBatch: () => void; onUsed?: (home: WorkspaceWorkflowsHomeModel) => void }) {
  const [usingTemplate, setUsingTemplate] = useState(false);
  const [useError, setUseError] = useState<string | null>(null);
  const handleUseTemplate = async () => {
    setUsingTemplate(true);
    setUseError(null);
    try {
      const used = await useWorkflowTemplate({ templateId: workflow.id, workspaceId, publish: true });
      if (used.home) onUsed?.(used.home);
    } catch (caught) {
      setUseError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setUsingTemplate(false);
    }
  };
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
      {useError ? <p role="alert" className="mt-3 text-sm text-amber-200">{useError}</p> : null}
      <div className="mt-4 flex flex-wrap gap-2">
        {workflow.canRun ? <button className="rounded-md bg-cyan-500 px-3 py-2 text-sm font-medium text-zinc-950 hover:bg-cyan-400" onClick={onRun}>Run</button> : null}
        {workflow.canRun ? <button className="rounded-md border border-cyan-700 px-3 py-2 text-sm text-cyan-100 hover:bg-cyan-950/40" onClick={onBatch}>Batch run</button> : null}
        {workflow.source === 'template' && workflow.status === 'ready' ? <button className="rounded-md border border-cyan-700 px-3 py-2 text-sm text-cyan-100 hover:bg-cyan-950/40 disabled:opacity-50" onClick={handleUseTemplate} disabled={usingTemplate}>{usingTemplate ? 'Using…' : 'Use template'}</button> : null}
        {workflow.source === 'published_design' ? <a className="rounded-md border border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-800" href={`/dashboard/workflows/editor/${encodeURIComponent(workflow.id)}`}>Edit graph</a> : null}
      </div>
    </article>
  );
}

function RunWorkflowDialog({ workspaceId, workflow, onClose, onLaunched }: {
  workspaceId: string;
  workflow: WorkspaceWorkflowSummary;
  onClose: () => void;
  onLaunched: (home: WorkspaceWorkflowsHomeModel) => void;
}) {
  const [options, setOptions] = useState<WorkflowLaunchOptions | null>(null);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [additionalInstructions, setAdditionalInstructions] = useState('');
  const [roleModes, setRoleModes] = useState<Record<string, 'existing' | 'create_or_reuse'>>({});
  const [existingSessions, setExistingSessions] = useState<Record<string, string>>({});
  const [newSessionNames, setNewSessionNames] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoadError(null);
    fetchWorkflowLaunchOptions(workspaceId, workflow.id, workflow.version)
      .then((loaded) => {
        if (!active) return;
        setOptions(loaded);
        const modes: Record<string, 'existing' | 'create_or_reuse'> = {};
        const names: Record<string, string> = {};
        for (const role of loaded.workflow.roles) {
          modes[role.id] = loaded.sessions.length ? 'existing' : 'create_or_reuse';
          names[role.id] = role.label;
        }
        setRoleModes(modes);
        setNewSessionNames(names);
      })
      .catch((caught) => { if (active) setLoadError(caught instanceof Error ? caught.message : String(caught)); });
    return () => { active = false; };
  }, [workspaceId, workflow.id, workflow.version]);

  const launchInputs = useMemo(() => options?.workflow.inputs ?? workflow.inputs, [options, workflow.inputs]);
  const launchRoles = useMemo(() => options?.workflow.roles ?? workflow.roles, [options, workflow.roles]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const nextErrors: Record<string, string> = {};
    for (const input of launchInputs) {
      if (input.required && !inputs[input.id]?.trim()) nextErrors[input.id] = 'This field is required.';
    }
    const roleBindings: Record<string, WorkflowLaunchRoleBindingRequest> = {};
    for (const role of launchRoles) {
      const mode = roleModes[role.id] ?? 'existing';
      if (mode === 'existing') {
        const sessionId = existingSessions[role.id];
        if (!sessionId) nextErrors[`role.${role.id}`] = `Choose a session for ${role.label}.`;
        roleBindings[role.id] = { mode, sessionId: sessionId ?? '' };
      } else {
        const name = newSessionNames[role.id]?.trim() || role.label;
        roleBindings[role.id] = { mode, name };
      }
    }
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    setSubmitting(true);
    try {
      const launched = await launchWorkspaceWorkflow({
        workspaceId,
        designId: workflow.id,
        version: workflow.version,
        inputs,
        additionalInstructions: additionalInstructions.trim() || null,
        roleBindings,
      });
      if (launched.home) onLaunched(launched.home);
      else onClose();
    } catch (caught) {
      if (caught instanceof WorkflowApiError) setFieldErrors({ form: caught.message, ...caught.fieldErrors });
      else setFieldErrors({ form: caught instanceof Error ? caught.message : String(caught) });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label={`Run ${workflow.title}`}>
      <form onSubmit={submit} className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-xl border border-zinc-700 bg-zinc-950 p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-cyan-300">Run workflow</div>
            <h2 className="mt-1 text-xl font-semibold">{workflow.title}</h2>
          </div>
          <button type="button" className="rounded-md border border-zinc-700 px-3 py-2 text-sm" onClick={onClose}>Close</button>
        </div>
        {loadError ? <div role="alert" className="mt-4 rounded-md border border-amber-900 bg-amber-950/30 p-3 text-sm text-amber-100">{loadError}</div> : null}
        {fieldErrors.form ? <div role="alert" className="mt-4 rounded-md border border-amber-900 bg-amber-950/30 p-3 text-sm text-amber-100">{fieldErrors.form}</div> : null}

        <div className="mt-5 space-y-5">
          <div className="space-y-3">
            <h3 className="font-medium">Workflow inputs</h3>
            {launchInputs.length ? launchInputs.map((input) => (
              <WorkflowInputField key={input.id} input={input} value={inputs[input.id] ?? ''} error={fieldErrors[input.id]} onChange={(value) => setInputs((current) => ({ ...current, [input.id]: value }))} />
            )) : <p className="text-sm text-zinc-400">This workflow has no required inputs.</p>}
          </div>

          <label className="block">
            <span className="text-sm font-medium">Additional instructions for this run</span>
            <textarea className="mt-2 min-h-24 w-full rounded-md border border-zinc-700 bg-zinc-900 p-3 text-sm" value={additionalInstructions} onChange={(event) => setAdditionalInstructions(event.target.value)} placeholder="Optional notes for this run only" />
          </label>

          <div className="space-y-3">
            <h3 className="font-medium">Role sessions</h3>
            {launchRoles.map((role) => (
              <div key={role.id} className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
                <div className="font-medium">{role.label}</div>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <label className="flex items-center gap-2 text-sm"><input type="radio" checked={(roleModes[role.id] ?? 'existing') === 'existing'} onChange={() => setRoleModes((current) => ({ ...current, [role.id]: 'existing' }))} /> Choose existing session</label>
                  <label className="flex items-center gap-2 text-sm"><input type="radio" checked={roleModes[role.id] === 'create_or_reuse'} onChange={() => setRoleModes((current) => ({ ...current, [role.id]: 'create_or_reuse' }))} /> Create or reuse by name</label>
                </div>
                {(roleModes[role.id] ?? 'existing') === 'existing' ? (
                  <select aria-label={`${role.label} session`} className="mt-3 w-full rounded-md border border-zinc-700 bg-zinc-950 p-2 text-sm" value={existingSessions[role.id] ?? ''} onChange={(event) => setExistingSessions((current) => ({ ...current, [role.id]: event.target.value }))}>
                    <option value="">Select a session</option>
                    {(options?.sessions ?? []).map((session) => <option key={session.sessionId} value={session.sessionId}>{session.name || session.sessionId}</option>)}
                  </select>
                ) : (
                  <input aria-label={`${role.label} session name`} className="mt-3 w-full rounded-md border border-zinc-700 bg-zinc-950 p-2 text-sm" value={newSessionNames[role.id] ?? role.label} onChange={(event) => setNewSessionNames((current) => ({ ...current, [role.id]: event.target.value }))} />
                )}
                {fieldErrors[`role.${role.id}`] ? <p className="mt-2 text-sm text-amber-200">{fieldErrors[`role.${role.id}`]}</p> : null}
              </div>
            ))}
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button type="button" className="rounded-md border border-zinc-700 px-3 py-2 text-sm" onClick={onClose}>Cancel</button>
          <button type="submit" className="rounded-md bg-cyan-500 px-3 py-2 text-sm font-medium text-zinc-950 disabled:opacity-60" disabled={submitting || Boolean(loadError)}>{submitting ? 'Launching…' : 'Launch workflow'}</button>
        </div>
      </form>
    </div>
  );
}


function BatchRunWorkflowDialog({ workspaceId, workflow, onClose, onQueued }: {
  workspaceId: string;
  workflow: WorkspaceWorkflowSummary;
  onClose: () => void;
  onQueued: (home: WorkspaceWorkflowsHomeModel) => void;
}) {
  const [itemsText, setItemsText] = useState('{"featureRequest":"First item"}\n{"featureRequest":"Second item"}');
  const [options, setOptions] = useState<WorkflowLaunchOptions | null>(null);
  const [sessionId, setSessionId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    fetchWorkflowLaunchOptions(workspaceId, workflow.id, workflow.version).then((loaded) => {
      if (!active) return;
      setOptions(loaded);
      setSessionId(loaded.sessions[0]?.sessionId ?? '');
    }).catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : String(caught)); });
    return () => { active = false; };
  }, [workspaceId, workflow.id, workflow.version]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    let parsedItems: Array<{ inputs: Record<string, unknown> }> = [];
    try {
      parsedItems = itemsText.split(/\n+/).map((line) => line.trim()).filter(Boolean).map((line) => ({ inputs: JSON.parse(line) as Record<string, unknown> }));
    } catch {
      setError('Each batch line must be a JSON object.');
      return;
    }
    if (!parsedItems.length) { setError('Add at least one batch item.'); return; }
    const roles = options?.workflow.roles ?? workflow.roles;
    const roleBindings = Object.fromEntries(roles.map((role) => [role.id, { mode: 'existing' as const, sessionId }]));
    if (!sessionId) { setError('Choose a session for this batch.'); return; }
    setSubmitting(true);
    try {
      const result = await batchLaunchWorkspaceWorkflow({ workspaceId, designId: workflow.id, version: workflow.version, items: parsedItems, roleBindings });
      if (result.home) onQueued(result.home);
      else onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label={`Batch run ${workflow.title}`}>
      <form onSubmit={submit} className="w-full max-w-2xl rounded-xl border border-zinc-700 bg-zinc-950 p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4"><div><div className="text-xs uppercase tracking-wide text-cyan-300">Batch run</div><h2 className="mt-1 text-xl font-semibold">{workflow.title}</h2></div><button type="button" className="rounded-md border border-zinc-700 px-3 py-2 text-sm" onClick={onClose}>Close</button></div>
        {error ? <div role="alert" className="mt-4 rounded-md border border-amber-900 bg-amber-950/30 p-3 text-sm text-amber-100">{error}</div> : null}
        <label className="mt-5 block"><span className="text-sm font-medium">Batch items</span><textarea aria-label="Batch items" className="mt-2 min-h-40 w-full rounded-md border border-zinc-700 bg-zinc-900 p-3 font-mono text-sm" value={itemsText} onChange={(event) => setItemsText(event.target.value)} /></label>
        <label className="mt-4 block"><span className="text-sm font-medium">Session for roles</span><select aria-label="Batch session" className="mt-2 w-full rounded-md border border-zinc-700 bg-zinc-950 p-2 text-sm" value={sessionId} onChange={(event) => setSessionId(event.target.value)}><option value="">Select a session</option>{(options?.sessions ?? []).map((session) => <option key={session.sessionId} value={session.sessionId}>{session.name || session.sessionId}</option>)}</select></label>
        <div className="mt-6 flex justify-end gap-3"><button type="button" className="rounded-md border border-zinc-700 px-3 py-2 text-sm" onClick={onClose}>Cancel</button><button type="submit" className="rounded-md bg-cyan-500 px-3 py-2 text-sm font-medium text-zinc-950 disabled:opacity-60" disabled={submitting}>{submitting ? 'Queueing…' : 'Queue batch'}</button></div>
      </form>
    </div>
  );
}

function WorkflowInputField({ input, value, error, onChange }: { input: WorkspaceWorkflowInputSummary; value: string; error?: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{input.id}{input.required ? ' *' : ''}</span>
      <textarea className="mt-2 min-h-20 w-full rounded-md border border-zinc-700 bg-zinc-900 p-3 text-sm" value={value} onChange={(event) => onChange(event.target.value)} />
      {input.description ? <p className="mt-1 text-xs text-zinc-500">{input.description}</p> : null}
      {error ? <p className="mt-1 text-sm text-amber-200">{error}</p> : null}
    </label>
  );
}


function BatchRow({ batch }: { batch: WorkspaceWorkflowBatchSummary }) {
  const classes = "rounded-lg border border-zinc-800 bg-zinc-950 p-4";
  const errorCount = batch.counts.failed + batch.counts.blocked + batch.counts.cancelled;
  const items = batch.items ?? [];
  return <div className={classes}>
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold">{batch.workflowName}</h3><p className="mt-1 text-sm text-zinc-400">{batch.counts.completed} complete · {batch.counts.running} running · {batch.counts.pending} pending · {errorCount} errors</p></div><StatusPill label={humanBatchStatus(batch.status)} tone={batch.status === 'completed' ? 'emerald' : batch.status === 'failed' ? 'amber' : 'cyan'} /></div>
    {items.length ? (
      <details className="mt-3 rounded-md border border-zinc-800 bg-zinc-900/50 p-3">
        <summary className="cursor-pointer text-sm font-medium text-zinc-200">Batch item details</summary>
        <ul className="mt-3 space-y-2">
          {items.map((item) => <BatchItemRow key={item.batchItemId ?? `${batch.batchId}-${item.itemIndex}`} item={item} />)}
        </ul>
      </details>
    ) : null}
  </div>;
}

function BatchItemRow({ item }: { item: NonNullable<WorkspaceWorkflowBatchSummary['items']>[number] }) {
  const lineNumber = item.itemIndex + 1;
  const fieldErrors = item.error?.fieldErrors ? Object.entries(item.error.fieldErrors) : [];
  const isError = item.status === 'failed' || item.status === 'blocked' || item.status === 'cancelled';
  return (
    <li className={`rounded-md border p-3 text-sm ${isError ? 'border-amber-900 bg-amber-950/20' : 'border-zinc-800 bg-zinc-950/60'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">Line {lineNumber}</span>
        <span className={isError ? 'text-amber-200' : 'text-zinc-300'}>{humanBatchItemStatus(item.status)}</span>
      </div>
      {item.error ? (
        <div className="mt-2 text-amber-100">
          <p>{item.error.message}</p>
          {fieldErrors.length ? (
            <ul className="mt-1 list-disc pl-5 text-amber-200">
              {fieldErrors.map(([field, message]) => <li key={field}>{field}: {message}</li>)}
            </ul>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function RunRow({ run }: { run: WorkspaceWorkflowRunSummary }) {
  const body = (
    <>
      <div>
        <h3 className="font-semibold">{run.workflowName}</h3>
        <p className="mt-1 text-sm text-zinc-400">Updated {formatTime(run.updatedAt)}</p>
      </div>
      <StatusPill label={humanRunStatus(run.status)} tone={run.status === 'completed' ? 'emerald' : run.status === 'blocked' ? 'amber' : run.status === 'failed' ? 'red' : 'cyan'} />
    </>
  );
  const classes = "flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950 p-4";
  return run.detailUrl ? <a className={`${classes} hover:border-cyan-800`} href={run.detailUrl}>{body}</a> : <div className={classes}>{body}</div>;
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

function humanBatchStatus(status: string): string {
  if (status === 'completed') return 'Complete';
  if (status === 'failed') return 'Finished with errors';
  if (status === 'cancelled') return 'Cancelled';
  return 'Running';
}

function humanBatchItemStatus(status: string): string {
  if (status === 'completed') return 'Complete';
  if (status === 'running') return 'Running';
  if (status === 'pending') return 'Pending';
  if (status === 'blocked') return 'Needs attention';
  if (status === 'cancelled') return 'Cancelled';
  if (status === 'failed') return 'Failed';
  return status;
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

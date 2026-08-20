import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { StandaloneDashboardPage } from '../../../../components/StandaloneDashboardPage';
import { fetchWorkspaceWorkflowsHome, useWorkflowTemplate, type WorkspaceWorkflowSummary } from '../client/workflowsHomeApi';
import { createWorkflowDesign } from '../client/workflowDesignEditorApi';
import { buildBlankWorkflowDefinition, buildWizardGraphPreview, type WorkflowWizardDraft } from './workflowWizardModel';

const initialDraft: WorkflowWizardDraft = {
  sourceMode: 'blank',
  sourceId: null,
  name: 'New workflow',
  purpose: 'Describe what this workflow should accomplish.',
  inputId: 'featureRequest',
  roleId: 'agent',
  roleLabel: 'Agent',
  stageLabel: 'Do the work',
  publish: false,
};

export function WorkflowCreationWizardPage(): React.ReactElement {
  const [params] = useSearchParams();
  const workspaceId = params.get('workspaceId') || params.get('workspace') || '';
  const [home, setHome] = useState<{ userWorkflows: WorkspaceWorkflowSummary[]; starterTemplates: WorkspaceWorkflowSummary[] } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    if (!workspaceId) return;
    fetchWorkspaceWorkflowsHome(workspaceId).then(setHome).catch((error) => setLoadError(error instanceof Error ? error.message : String(error)));
  }, [workspaceId]);
  return <WorkflowCreationWizardView workspaceId={workspaceId} userWorkflows={home?.userWorkflows ?? []} starterTemplates={home?.starterTemplates ?? []} loadError={loadError} />;
}

export function WorkflowCreationWizardView({ workspaceId, userWorkflows, starterTemplates, loadError, initialDraft: initialDraftOverride }: { workspaceId: string; userWorkflows: WorkspaceWorkflowSummary[]; starterTemplates: WorkspaceWorkflowSummary[]; loadError?: string | null; initialDraft?: WorkflowWizardDraft }): React.ReactElement {
  const [draft, setDraft] = useState<WorkflowWizardDraft>(initialDraftOverride ?? initialDraft);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ designId: string; draftId: string | null; version: number | null } | null>(null);
  const [error, setError] = useState<string | null>(loadError ?? null);
  useEffect(() => { setError(loadError ?? null); }, [loadError]);
  const graph = useMemo(() => draft.sourceMode === 'blank' ? buildWizardGraphPreview(draft) : null, [draft]);
  const selectedStarter = starterTemplates.find((item) => item.id === draft.sourceId);
  const selectedExisting = userWorkflows.find((item) => item.id === draft.sourceId);
  const selectedSource = selectedStarter ?? selectedExisting;
  const canPublishFromWizard = draft.sourceMode !== 'blank';

  const update = <K extends keyof WorkflowWizardDraft>(key: K, value: WorkflowWizardDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const selectSource = (mode: WorkflowWizardDraft['sourceMode'], sourceId: string | null) => {
    const source = [...starterTemplates, ...userWorkflows].find((item) => item.id === sourceId);
    setDraft((current) => ({ ...current, sourceMode: mode, sourceId, name: source ? `${source.title} copy` : current.name, purpose: source?.description ?? current.purpose }));
  };

  const save = async (publish: boolean) => {
    setSubmitting(true);
    setError(null);
    try {
      if (draft.sourceMode === 'starter' && draft.sourceId) {
        const used = await useWorkflowTemplate({ templateId: draft.sourceId, workspaceId, name: draft.name, publish });
        setResult({ designId: used.design.designId, draftId: used.draft?.draftId ?? null, version: used.version?.version ?? null });
      } else {
        const created = await createWorkflowDesign({ workspaceId, name: draft.name, description: draft.purpose, sourceDesignId: draft.sourceMode === 'duplicate' ? draft.sourceId : null, definition: draft.sourceMode === 'blank' ? buildBlankWorkflowDefinition(draft) : undefined, publish });
        setResult({ designId: created.design.designId, draftId: created.draft?.draftId ?? null, version: created.version?.version ?? null });
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <StandaloneDashboardPage contentClassName="mx-auto max-w-6xl space-y-5">
      <header className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
        <div className="text-xs uppercase tracking-wide text-cyan-300">Workflow wizard</div>
        <h1 className="mt-1 text-2xl font-semibold">Create workflow</h1>
        <p className="mt-2 text-sm text-zinc-400">Start from a template, duplicate an existing design, or create a simple supported workflow. Graph editor remains available for advanced edits.</p>
      </header>
      {error ? <div role="alert" className="rounded-lg border border-amber-900 bg-amber-950/30 p-4 text-sm text-amber-100">{error}</div> : null}
      {result ? <ResultPanel result={result} workspaceId={workspaceId} published={result.version != null} /> : null}

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <WizardStep number="1" title="Choose a starting point">
            <div className="grid gap-3 md:grid-cols-3">
              <SourceButton active={draft.sourceMode === 'blank'} title="Blank workflow draft" description="Start truly empty: no roles, states, or actions yet." onClick={() => selectSource('blank', null)} />
              <SourceSelect label="Starter template" value={draft.sourceMode === 'starter' ? draft.sourceId ?? '' : ''} options={starterTemplates} onChange={(value) => selectSource('starter', value)} />
              <SourceSelect label="Duplicate existing" value={draft.sourceMode === 'duplicate' ? draft.sourceId ?? '' : ''} options={userWorkflows} onChange={(value) => selectSource('duplicate', value)} />
            </div>
            {selectedStarter ? <p className="mt-3 text-sm text-cyan-100">Selected starter: {selectedStarter.title}</p> : null}
            {selectedExisting ? <p className="mt-3 text-sm text-cyan-100">Duplicating design only. Existing sessions and runs are not copied.</p> : null}
          </WizardStep>

          <WizardStep number="2" title="Name and purpose">
            <TextInput label="Workflow name" value={draft.name} onChange={(value) => update('name', value)} />
            <TextArea label="Purpose" value={draft.purpose} onChange={(value) => update('purpose', value)} />
          </WizardStep>

          <WizardStep number="3" title="Inputs">
            <TextInput label="Suggested first input id" value={draft.inputId} onChange={(value) => update('inputId', value)} disabled={draft.sourceMode !== 'blank'} />
            <p className="mt-2 text-xs text-zinc-500">Blank drafts start empty. Add inputs later in the graph editor before publishing. Template inputs can be edited after creating a draft copy.</p>
          </WizardStep>

          <WizardStep number="4" title="Roles">
            <div className="grid gap-3 md:grid-cols-2"><TextInput label="Role id" value={draft.roleId} onChange={(value) => update('roleId', value)} disabled={draft.sourceMode !== 'blank'} /><TextInput label="Role label" value={draft.roleLabel} onChange={(value) => update('roleLabel', value)} disabled={draft.sourceMode !== 'blank'} /></div>
          </WizardStep>

          <WizardStep number="5" title="Stages and supported steps">
            <TextInput label="First stage label" value={draft.stageLabel} onChange={(value) => update('stageLabel', value)} disabled={draft.sourceMode !== 'blank'} />
            <div className="mt-3 grid gap-3 md:grid-cols-3"><StepType label="Agent turn" state="Available" /><StepType label="Human form" state="Available in editor for supported providers" /><StepType label="Blocking workflow call" state="Available after choosing a child workflow in advanced edit" /></div>
            <p className="mt-2 text-xs text-zinc-500">Unsupported workflow call modes, batch controls, and marketplace/plugin controls are hidden.</p>
          </WizardStep>

          <WizardStep number="6" title="Decisions and loops">
            <p className="text-sm text-zinc-300">Blank drafts start without actions or transitions. Add decisions and loops in the graph editor. Template decisions can be adjusted after creating an editable draft copy.</p>
          </WizardStep>

          <WizardStep number="8" title="Save lifecycle">
            <div className="flex flex-wrap gap-3"><button className="rounded-md border border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-800 disabled:opacity-60" disabled={submitting || !draft.name.trim()} onClick={() => void save(false)}>Save draft</button><button className="rounded-md bg-cyan-500 px-3 py-2 text-sm font-medium text-zinc-950 disabled:opacity-60" disabled={submitting || !draft.name.trim() || !canPublishFromWizard} title={canPublishFromWizard ? undefined : 'Blank drafts must be completed in the editor before publishing.'} onClick={() => void save(true)}>Save & publish</button></div>
            <p className="mt-2 text-xs text-zinc-500">Drafts may be incomplete while editing, but they are not runnable. Publish is blocked until validation passes. Published versions are immutable and runnable from the Workflows tab.</p>
          </WizardStep>
        </div>

        <aside className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
          <div className="text-xs uppercase tracking-wide text-cyan-300">Step 7</div>
          <h2 className="mt-1 text-lg font-semibold">Review graph</h2>
          {graph ? (
            <>
              <p className="mt-1 text-sm text-zinc-400">{graph.nodes.length} states · {graph.edges.length} actions</p>
              <div className="mt-4 space-y-3">{graph.nodes.map((node) => <div key={node.id} className="rounded-lg border border-zinc-800 bg-zinc-950 p-3"><div className="font-medium">{node.label}{node.terminal ? ' (terminal)' : ''}</div>{node.ownerLabel ? <div className="text-xs text-zinc-500">Owner: {node.ownerLabel}</div> : null}{node.steps.map((step) => <div key={step.id} className="mt-2 text-xs text-zinc-300">{step.id}: {step.type}</div>)}</div>)}</div>
              <div className="mt-4 space-y-2">{graph.edges.map((edge) => <div key={edge.id} className="text-sm text-zinc-300">{edge.source} → {edge.target}: {edge.label}</div>)}</div>
            </>
          ) : (
            <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950 p-4">
              <h3 className="font-medium">{selectedSource?.title ?? 'Selected workflow copy'}</h3>
              <p className="mt-2 text-sm text-zinc-300">{draft.sourceMode === 'starter' ? 'This will create a copy from the selected starter template.' : 'This will duplicate the selected workflow design.'}</p>
              <p className="mt-2 text-sm text-zinc-400">The copied workflow keeps the selected workflow structure. Open the graph editor after creation to review and edit its actual states, steps, and transitions.</p>
            </div>
          )}
        </aside>
      </section>
    </StandaloneDashboardPage>
  );
}

function WizardStep({ number, title, children }: { number: string; title: string; children: React.ReactNode }) {
  return <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5"><div className="text-xs uppercase tracking-wide text-cyan-300">Step {number}</div><h2 className="mt-1 text-lg font-semibold">{title}</h2><div className="mt-4 space-y-3">{children}</div></section>;
}

function SourceButton({ active, title, description, onClick }: { active: boolean; title: string; description: string; onClick: () => void }) {
  return <button type="button" className={`rounded-lg border p-4 text-left ${active ? 'border-cyan-500 bg-cyan-950/40' : 'border-zinc-800 bg-zinc-950 hover:border-zinc-700'}`} onClick={onClick}><div className="font-medium">{title}</div><p className="mt-1 text-sm text-zinc-400">{description}</p></button>;
}

function SourceSelect({ label, value, options, onChange }: { label: string; value: string; options: WorkspaceWorkflowSummary[]; onChange: (value: string) => void }) {
  return <label className="block rounded-lg border border-zinc-800 bg-zinc-950 p-4"><span className="font-medium">{label}</span><select className="mt-3 w-full rounded-md border border-zinc-700 bg-zinc-900 p-2 text-sm" value={value} onChange={(event) => event.target.value && onChange(event.target.value)}><option value="">Choose…</option>{options.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>;
}

function TextInput({ label, value, onChange, disabled = false }: { label: string; value: string; onChange: (value: string) => void; disabled?: boolean }) {
  return <label className="block"><span className="text-sm font-medium">{label}</span><input className="mt-2 w-full rounded-md border border-zinc-700 bg-zinc-900 p-2 text-sm disabled:opacity-60" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} /></label>;
}

function TextArea({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="block"><span className="text-sm font-medium">{label}</span><textarea className="mt-2 min-h-20 w-full rounded-md border border-zinc-700 bg-zinc-900 p-3 text-sm" value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function StepType({ label, state }: { label: string; state: string }) {
  return <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3"><div className="font-medium">{label}</div><div className="mt-1 text-xs text-zinc-400">{state}</div></div>;
}

function ResultPanel({ result, workspaceId, published }: { result: { designId: string; draftId: string | null; version: number | null }; workspaceId: string; published: boolean }) {
  return <section aria-label="Wizard result" className="rounded-xl border border-emerald-900 bg-emerald-950/20 p-5"><h2 className="font-semibold text-emerald-100">Workflow saved</h2><p className="mt-2 text-sm text-emerald-50">{published ? `Published v${result.version}. This workflow is runnable from the Workflows tab.` : 'Saved as draft. Publish it before running.'}</p><div className="mt-3 flex flex-wrap gap-3"><a className="rounded-md border border-emerald-800 px-3 py-2 text-sm text-emerald-100 hover:bg-emerald-950/40" href={`/dashboard/workflows/editor/${result.designId}`}>Open graph editor</a><a className="rounded-md border border-cyan-900 px-3 py-2 text-sm text-cyan-200 hover:bg-cyan-950/40" href={`/dashboard/workflows?workspaceId=${encodeURIComponent(workspaceId)}`}>{published ? 'Run from Workflows tab' : 'Back to Workflows tab'}</a></div></section>;
}

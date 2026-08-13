import '@xyflow/react/dist/style.css';
import './WorkflowGraphEditorPage.css';

import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router';
import { Background, Controls, MarkerType, MiniMap, ReactFlow, type Edge, type Node } from '@xyflow/react';
import type { AgentWorkflowDefinitionV1, WorkflowStepV1 } from '@vibe-dashboard/workflow-core';
import { fetchWorkflowDesignEditor, publishWorkflowDesignDraft, saveWorkflowDesignDraft, type WorkflowDesignEditorModel } from '../client/workflowDesignEditorApi';
import { fetchWorkflowAssets, type WorkflowAssetPickerItem, type WorkflowAssetsModel } from '../client/workflowAssetsApi';
import { StandaloneDashboardPage } from '../../../../components/StandaloneDashboardPage';
import { applyWorkflowGraphActionEdit, validateWorkflowGraph, workflowDefinitionToGraph, type WorkflowGraphEdgeModel, type WorkflowGraphNodeModel, type WorkflowGraphValidationIssue } from './graph/workflowGraphModel';

export function WorkflowGraphEditorPage(): React.ReactElement {
  const { designId } = useParams();
  const [editor, setEditor] = useState<WorkflowDesignEditorModel | null>(null);
  const [definition, setDefinition] = useState<AgentWorkflowDefinitionV1 | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [assets, setAssets] = useState<WorkflowAssetsModel>({ prompts: [], skills: [] });

  useEffect(() => {
    if (!designId) {
      setError('Workflow design is required.');
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    fetchWorkflowDesignEditor(designId)
      .then((loaded) => {
        if (!active) return;
        setEditor(loaded);
        setDefinition(loaded.definition);
      })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : String(caught)); })
      .finally(() => { if (active) setLoading(false); });
    fetchWorkflowAssets()
      .then((loaded) => { if (active) setAssets(loaded); })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : String(caught)); });
    return () => { active = false; };
  }, [designId]);

  const publish = async () => {
    if (!editor?.draftId) return;
    setPublishing(true);
    setSaveMessage(null);
    try {
      const updated = await publishWorkflowDesignDraft(editor.draftId);
      setEditor(updated);
      setDefinition(updated.definition);
      setSaveMessage(`Published workflow version ${updated.version ?? ''}.`.trim());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setPublishing(false);
    }
  };

  const save = async () => {
    if (!editor?.draftId || !definition) return;
    setSaveMessage(null);
    try {
      const updated = await saveWorkflowDesignDraft(editor.draftId, definition);
      setEditor(updated);
      setDefinition(updated.definition);
      setSaveMessage('Saved workflow draft.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  return (
    <StandaloneDashboardPage contentClassName="mx-auto max-w-7xl space-y-5">
        <header className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
          <div className="text-xs uppercase tracking-wide text-cyan-300">Workflow builder</div>
          <h1 className="mt-1 text-2xl font-semibold">{editor?.name ?? 'Workflow graph'}</h1>
          {editor?.description ? <p className="mt-2 text-sm text-zinc-300">{editor.description}</p> : null}
        </header>
        {loading ? <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-5">Loading workflow graph…</div> : null}
        {error ? <div role="alert" className="rounded-lg border border-amber-900 bg-amber-950/30 p-4 text-sm text-amber-100">{error}</div> : null}
        {definition ? <WorkflowGraphEditorView editor={editor} definition={definition} assets={assets} onDefinitionChange={setDefinition} onSave={() => void save()} onPublish={() => void publish()} publishing={publishing} saveMessage={saveMessage} /> : null}
    </StandaloneDashboardPage>
  );
}

export function WorkflowGraphEditorView({ editor, definition, assets, onDefinitionChange, onSave, onPublish, publishing, saveMessage }: {
  editor: WorkflowDesignEditorModel | null;
  definition: AgentWorkflowDefinitionV1;
  assets?: WorkflowAssetsModel;
  onDefinitionChange: (definition: AgentWorkflowDefinitionV1) => void;
  onSave: () => void;
  onPublish: () => void;
  publishing?: boolean;
  saveMessage?: string | null;
}): React.ReactElement {
  const graph = useMemo(() => workflowDefinitionToGraph(definition), [definition]);
  const issues = useMemo(() => validateWorkflowGraph(definition), [definition]);
  const [selectedNodeId, setSelectedNodeId] = useState(graph.nodes[0]?.id ?? '');
  const [selectedEdgeId, setSelectedEdgeId] = useState(graph.edges[0]?.id ?? '');
  const selectedNode = graph.nodes.find((node) => node.id === selectedNodeId) ?? graph.nodes[0] ?? null;
  const selectedEdge = graph.edges.find((edge) => edge.id === selectedEdgeId) ?? null;
  const flowNodes = useMemo(() => toFlowNodes(graph.nodes), [graph.nodes]);
  const flowEdges = useMemo(() => toFlowEdges(graph.edges), [graph.edges]);
  const canSave = Boolean(editor?.draftId) && issues.length === 0;

  const updateEdge = (edgeId: string, edit: { actionLabel?: string; targetState?: string }) => {
    onDefinitionChange(applyWorkflowGraphActionEdit(definition, edgeId, edit));
  };

  return (
    <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/60">
        <div className="flex items-center justify-between gap-3 border-b border-zinc-800 p-4">
          <div>
            <h2 className="font-semibold">Graph</h2>
            <p className="text-sm text-zinc-400">States are nodes. Decision actions are labeled edges.</p>
          </div>
          <div className="flex gap-2"><button className="rounded-md border border-zinc-700 px-3 py-2 text-sm disabled:opacity-50" disabled={!canSave} onClick={onSave}>Save draft</button><button className="rounded-md bg-cyan-500 px-3 py-2 text-sm font-medium text-zinc-950 disabled:opacity-50" disabled={!canSave || publishing} onClick={onPublish}>{publishing ? 'Publishing…' : 'Publish'}</button></div>
        </div>
        <div className="h-[34rem] bg-slate-950" data-testid="workflow-react-flow-canvas">
          <ReactFlow
            className="workflow-graph-canvas"
            nodes={flowNodes}
            edges={flowEdges}
            fitView
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable
            onNodeClick={(_, node) => setSelectedNodeId(node.id)}
            onEdgeClick={(_, edge) => setSelectedEdgeId(edge.id)}
          >
            <Background />
            <MiniMap />
            <Controls />
          </ReactFlow>
        </div>
      </div>
      <aside className="space-y-4">
        {saveMessage ? <div className="rounded-lg border border-emerald-800 bg-emerald-950/30 p-3 text-sm text-emerald-100">{saveMessage}</div> : null}
        <DesignDetails definition={definition} onChange={onDefinitionChange} />
        <ValidationPanel issues={issues} />
        {selectedNode ? <NodeDetails node={selectedNode} definition={definition} assets={assets ?? { prompts: [], skills: [] }} onChange={onDefinitionChange} /> : null}
        {selectedEdge ? <EdgeEditor edge={selectedEdge} states={graph.nodes} onChange={updateEdge} /> : null}
        <JsonDiagnostics definition={definition} />
      </aside>
    </section>
  );
}

function DesignDetails({ definition, onChange }: { definition: AgentWorkflowDefinitionV1; onChange: (definition: AgentWorkflowDefinitionV1) => void }) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <h2 className="font-semibold">Design details</h2>
      <label className="mt-3 block text-sm"><span className="font-medium">Workflow name</span><input className="mt-2 w-full rounded-md border border-zinc-700 bg-zinc-950 p-2" value={definition.name} onChange={(event) => onChange({ ...definition, name: event.target.value })} /></label>
      <label className="mt-3 block text-sm"><span className="font-medium">Description</span><textarea className="mt-2 min-h-20 w-full rounded-md border border-zinc-700 bg-zinc-950 p-2" value={definition.description ?? ''} onChange={(event) => onChange({ ...definition, description: event.target.value || undefined })} /></label>
      <h3 className="mt-4 font-medium">Roles</h3>
      <div className="mt-2 space-y-2">{Object.entries(definition.roles).map(([roleId, role]) => <label key={roleId} className="block text-sm"><span className="font-medium">{roleId} label</span><input className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 p-2" value={role.label ?? roleId} onChange={(event) => onChange({ ...definition, roles: { ...definition.roles, [roleId]: { ...role, label: event.target.value } } })} /></label>)}</div>
    </section>
  );
}

function NodeDetails({ node, definition, assets, onChange }: { node: WorkflowGraphNodeModel; definition: AgentWorkflowDefinitionV1; assets: WorkflowAssetsModel; onChange: (definition: AgentWorkflowDefinitionV1) => void }) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="text-xs uppercase tracking-wide text-cyan-300">Selected state</div>
      <h2 className="mt-1 text-lg font-semibold">{node.label}</h2>
      <dl className="mt-3 space-y-2 text-sm">
        <div><dt className="text-zinc-500">Owner role</dt><dd>{node.terminal ? 'Terminal state' : node.ownerLabel ?? 'Unassigned'}</dd></div>
        <div><dt className="text-zinc-500">State id</dt><dd>{node.id}</dd></div>
      </dl>
      <h3 className="mt-4 font-medium">Steps</h3>
      {node.steps.length ? <ul className="mt-2 space-y-2">{node.steps.map((step) => <li key={step.id} className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-sm"><StepSummary step={step} definition={definition} assets={assets} stateId={node.id} onChange={onChange} /></li>)}</ul> : <p className="mt-2 text-sm text-zinc-400">No steps in this state.</p>}
    </section>
  );
}

function StepSummary({ step, definition, assets, stateId, onChange }: { step: WorkflowGraphNodeModel['steps'][number]; definition: AgentWorkflowDefinitionV1; assets: WorkflowAssetsModel; stateId: string; onChange: (definition: AgentWorkflowDefinitionV1) => void }) {
  return (
    <div>
      <div className="font-medium">{step.id}</div>
      <div className="mt-1 text-zinc-400">{stepSubtitle(step)}</div>
      {step.promptTemplate ? <div className="mt-2 text-xs text-zinc-500">Prompt: {step.promptTemplate}</div> : null}
      {step.promptRefs.length ? <div className="mt-2 text-xs text-zinc-500">Selected refs: {step.promptRefs.join(', ')}</div> : null}
      {step.type === 'agent_turn' ? <PromptRefsEditor definition={definition} assets={assets} stateId={stateId} stepId={step.id} onChange={onChange} /> : null}
      {step.humanFormProvider ? <div className="mt-2 text-xs text-zinc-500">Form provider: {step.humanFormProvider}</div> : null}
      {step.workflowCallDesignId ? <div className="mt-2 text-xs text-zinc-500">Child workflow: {step.workflowCallDesignId}{step.workflowCallVersion ? `@${step.workflowCallVersion}` : ''}</div> : null}
    </div>
  );
}

function stepSubtitle(step: WorkflowGraphNodeModel['steps'][number]): string {
  if (step.type === 'agent_turn') return `Agent turn · ${step.turnType}`;
  if (step.type === 'human_form') return `Human form · ${step.humanFormTitle ?? 'Untitled form'}`;
  if (step.type === 'workflow_call') return `Workflow call · ${step.workflowCallMode ?? 'blocking'}`;
  return `Unsupported step · ${step.type}`;
}


function PromptRefsEditor({ definition, assets, stateId, stepId, onChange }: { definition: AgentWorkflowDefinitionV1; assets: WorkflowAssetsModel; stateId: string; stepId: string; onChange: (definition: AgentWorkflowDefinitionV1) => void }) {
  const state = definition.states[stateId];
  if (!state || 'terminal' in state) return null;
  const step = state.steps.find((candidate) => candidate.id === stepId) as (WorkflowStepV1 & { prompt?: { refs?: Array<{ kind: string; id: string; version?: number }> } }) | undefined;
  if (!step || step.type !== 'agent_turn') return null;
  const selectedRefs = step.prompt.refs ?? [];
  const allAssets = [...assets.prompts, ...assets.skills];
  const missingRefs = selectedRefs.filter((ref) => !allAssets.some((asset) => asset.kind === ref.kind && asset.id === ref.id && (ref.version == null || asset.version === ref.version)));
  const toggle = (asset: WorkflowAssetPickerItem, checked: boolean) => {
    const refs = checked
      ? [...selectedRefs.filter((ref) => !(ref.kind === asset.kind && ref.id === asset.id)), { kind: asset.kind, id: asset.id, version: asset.version }]
      : selectedRefs.filter((ref) => !(ref.kind === asset.kind && ref.id === asset.id && (ref.version == null || ref.version === asset.version)));
    const next = JSON.parse(JSON.stringify(definition)) as AgentWorkflowDefinitionV1;
    const nextState = next.states[stateId];
    if (!nextState || 'terminal' in nextState) return;
    const nextStep = nextState.steps.find((candidate) => candidate.id === stepId) as (WorkflowStepV1 & { prompt?: { refs?: unknown[] } }) | undefined;
    if (!nextStep || nextStep.type !== 'agent_turn') return;
    nextStep.prompt = { ...nextStep.prompt, refs } as typeof nextStep.prompt;
    onChange(next);
  };
  return (
    <section className="mt-3 rounded-md border border-zinc-800 bg-zinc-900/50 p-3" aria-label={`${stepId} prompt and skill picker`}>
      <h4 className="text-sm font-medium text-zinc-200">Prompt and skill snippets</h4>
      <p className="mt-1 text-xs text-zinc-500">Skills are markdown instruction snippets, not executable tools. Raw JSON remains diagnostics-only.</p>
      {missingRefs.length ? <div className="mt-2 rounded border border-amber-900 bg-amber-950/30 p-2 text-xs text-amber-100">Missing prompt or skill refs: {missingRefs.map(formatAssetRef).join(', ')}</div> : null}
      <AssetChecklist title="Prompts" assets={assets.prompts} selectedRefs={selectedRefs} onToggle={toggle} />
      <AssetChecklist title="Skills" assets={assets.skills} selectedRefs={selectedRefs} onToggle={toggle} />
      {selectedRefs.length ? <div className="mt-3 text-xs text-zinc-400">Selected: {selectedRefs.map(formatAssetRef).join(', ')}</div> : null}
    </section>
  );
}

function AssetChecklist({ title, assets, selectedRefs, onToggle }: { title: string; assets: WorkflowAssetPickerItem[]; selectedRefs: Array<{ kind: string; id: string; version?: number }>; onToggle: (asset: WorkflowAssetPickerItem, checked: boolean) => void }) {
  return (
    <div className="mt-3">
      <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">{title}</div>
      {assets.length ? <div className="mt-2 space-y-2">{assets.map((asset) => {
        const checked = selectedRefs.some((ref) => ref.kind === asset.kind && ref.id === asset.id && (ref.version == null || ref.version === asset.version));
        return (
          <label key={`${asset.kind}:${asset.id}@${asset.version}`} className="flex gap-2 rounded border border-zinc-800 bg-zinc-950 p-2 text-xs">
            <input type="checkbox" checked={checked} onChange={(event) => onToggle(asset, event.target.checked)} aria-label={`${asset.kind}:${asset.id}@${asset.version}`} />
            <span><span className="font-medium text-zinc-200">{asset.name}</span> <span className="text-zinc-500">v{asset.version} · {sourceLabel(asset.source)}</span>{asset.description ? <span className="block text-zinc-400">{asset.description}</span> : null}<span className="block text-zinc-500">{asset.preview}</span></span>
          </label>
        );
      })}</div> : <div className="mt-2 rounded border border-dashed border-zinc-800 p-2 text-xs text-zinc-500">No {title.toLowerCase()} available.</div>}
    </div>
  );
}

function formatAssetRef(ref: { kind: string; id: string; version?: number }): string {
  return `${ref.kind}:${ref.id}${ref.version ? `@${ref.version}` : ''}`;
}

function sourceLabel(source: string): string {
  if (source === 'built_in') return 'Built-in';
  if (source === 'plugin') return 'Plugin';
  if (source === 'user') return 'User';
  return source;
}

function EdgeEditor({ edge, states, onChange }: { edge: WorkflowGraphEdgeModel; states: WorkflowGraphNodeModel[]; onChange: (edgeId: string, edit: { actionLabel?: string; targetState?: string }) => void }) {
  const source = states.find((state) => state.id === edge.source);
  const target = states.find((state) => state.id === edge.target);
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="text-xs uppercase tracking-wide text-cyan-300">Selected action</div>
      <h2 className="mt-1 text-lg font-semibold">{edge.actionId}</h2>
      <dl className="mt-3 grid gap-2 rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-sm">
        <div><dt className="text-zinc-500">Transition</dt><dd className="font-medium text-zinc-100">{source?.label ?? edge.source} → {target?.label ?? edge.target}</dd></div>
        {edge.description ? <div><dt className="text-zinc-500">Description</dt><dd className="text-zinc-200">{edge.description}</dd></div> : null}
      </dl>
      <label className="mt-3 block text-sm">
        <span className="font-medium">Action label</span>
        <input className="mt-2 w-full rounded-md border border-zinc-700 bg-zinc-950 p-2" value={edge.label} onChange={(event) => onChange(edge.id, { actionLabel: event.target.value })} />
      </label>
      <label className="mt-3 block text-sm">
        <span className="font-medium">Target state</span>
        <select className="mt-2 w-full rounded-md border border-zinc-700 bg-zinc-950 p-2" value={edge.target} onChange={(event) => onChange(edge.id, { targetState: event.target.value })}>
          <option value="">Choose a target</option>
          {states.map((state) => <option key={state.id} value={state.id}>{state.label}</option>)}
        </select>
      </label>
      {edge.waitFor ? (
        <section className="mt-4 rounded-lg border border-cyan-900 bg-cyan-950/20 p-3 text-sm">
          <h3 className="font-medium text-cyan-100">Wait action</h3>
          <p className="mt-1 text-cyan-200">Provider: {edge.waitFor.provider}</p>
          {edge.waitFor.fields.length ? (
            <dl className="mt-2 space-y-1 text-xs">
              {edge.waitFor.fields.map((field) => <div key={field.label} className="flex justify-between gap-3"><dt className="text-cyan-300">{field.label}</dt><dd className="text-cyan-50">{field.value}</dd></div>)}
            </dl>
          ) : null}
        </section>
      ) : null}
      {edge.resultFields.length ? (
        <section className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
          <h3 className="text-sm font-medium">Result fields</h3>
          <ul className="mt-2 space-y-2">
            {edge.resultFields.map((field) => (
              <li key={field.name} className="rounded border border-zinc-800 bg-zinc-900/60 p-2 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-zinc-100">{field.name}</span>
                  <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-zinc-400">{field.type}{field.multiple ? '[]' : ''}</span>
                  {field.required ? <span className="rounded border border-amber-800 px-1.5 py-0.5 text-amber-200">required</span> : null}
                </div>
                {field.description ? <p className="mt-1 text-zinc-400">{field.description}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {edge.handoffPrompt ? (
        <section className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
          <h3 className="text-sm font-medium">Handoff prompt</h3>
          <p className="mt-2 whitespace-pre-wrap text-xs text-zinc-300">{edge.handoffPrompt}</p>
        </section>
      ) : null}
    </section>
  );
}

function ValidationPanel({ issues }: { issues: WorkflowGraphValidationIssue[] }) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <h2 className="font-semibold">Validation</h2>
      {issues.length ? <ul className="mt-2 space-y-2 text-sm text-amber-100">{issues.map((issue) => <li key={`${issue.code}:${issue.path}`} className="rounded border border-amber-900 bg-amber-950/30 p-2">{issue.message}</li>)}</ul> : <p className="mt-2 text-sm text-emerald-200">Ready to save.</p>}
    </section>
  );
}

function JsonDiagnostics({ definition }: { definition: AgentWorkflowDefinitionV1 }) {
  return (
    <details className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <summary className="cursor-pointer text-sm font-medium">JSON diagnostics</summary>
      <pre className="mt-3 max-h-72 overflow-auto rounded-lg bg-zinc-950 p-3 text-xs text-zinc-300" aria-readonly="true">{JSON.stringify(definition, null, 2)}</pre>
    </details>
  );
}

export function toFlowNodes(nodes: WorkflowGraphNodeModel[]): Node[] {
  return nodes.map((node, index) => {
    const classes = ['workflow-state-node'];
    if (node.initial) classes.push('workflow-initial-node');
    if (node.terminal) classes.push('workflow-terminal-node');
    return {
      id: node.id,
      position: { x: (index % 3) * 280, y: Math.floor(index / 3) * 180 },
      data: { label: `${node.initial ? 'Start · ' : ''}${node.label}${node.terminal ? ' · Done' : ''}` },
      className: classes.join(' '),
      style: node.terminal ? terminalNodeStyle : stateNodeStyle,
    };
  });
}

export function toFlowEdges(edges: WorkflowGraphEdgeModel[]): Edge[] {
  return edges.map((edge) => {
    const loop = edge.source === edge.target;
    const color = loop ? '#f59e0b' : '#38bdf8';
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.label,
      animated: loop,
      className: loop ? 'workflow-graph-edge workflow-loop-edge' : 'workflow-graph-edge',
      style: { stroke: color, strokeWidth: loop ? 2.5 : 2 },
      markerEnd: { type: MarkerType.ArrowClosed, color },
      labelStyle: { fill: '#e0f2fe', fontWeight: 800, fontSize: 13 },
      labelBgStyle: { fill: '#0f172a', fillOpacity: 0.95 },
      labelBgPadding: [10, 6],
      labelBgBorderRadius: 6,
    };
  });
}

const stateNodeStyle: React.CSSProperties = {
  background: '#0f172a',
  border: '1px solid #2563eb',
  borderRadius: 12,
  color: '#e2e8f0',
  fontWeight: 700,
  padding: '10px 14px',
  boxShadow: '0 16px 32px rgba(2, 6, 23, 0.32)',
};

const terminalNodeStyle: React.CSSProperties = {
  ...stateNodeStyle,
  background: '#052e2b',
  border: '1px solid #10b981',
  color: '#d1fae5',
};

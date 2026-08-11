import '@xyflow/react/dist/style.css';

import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router';
import { Background, Controls, MiniMap, ReactFlow, type Edge, type Node } from '@xyflow/react';
import type { AgentWorkflowDefinitionV1 } from '@vibe-dashboard/workflow-core';
import { fetchWorkflowDesignEditor, publishWorkflowDesignDraft, saveWorkflowDesignDraft, type WorkflowDesignEditorModel } from '../client/workflowDesignEditorApi';
import { applyWorkflowGraphActionEdit, validateWorkflowGraph, workflowDefinitionToGraph, type WorkflowGraphEdgeModel, type WorkflowGraphNodeModel, type WorkflowGraphValidationIssue } from './graph/workflowGraphModel';

export function WorkflowGraphEditorPage(): React.ReactElement {
  const { designId } = useParams();
  const [editor, setEditor] = useState<WorkflowDesignEditorModel | null>(null);
  const [definition, setDefinition] = useState<AgentWorkflowDefinitionV1 | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);

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
    <main className="min-h-screen bg-zinc-950 p-6 text-zinc-100">
      <div className="mx-auto max-w-7xl space-y-5">
        <header className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
          <div className="text-xs uppercase tracking-wide text-cyan-300">Workflow builder</div>
          <h1 className="mt-1 text-2xl font-semibold">{editor?.name ?? 'Workflow graph'}</h1>
          {editor?.description ? <p className="mt-2 text-sm text-zinc-300">{editor.description}</p> : null}
        </header>
        {loading ? <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-5">Loading workflow graph…</div> : null}
        {error ? <div role="alert" className="rounded-lg border border-amber-900 bg-amber-950/30 p-4 text-sm text-amber-100">{error}</div> : null}
        {definition ? <WorkflowGraphEditorView editor={editor} definition={definition} onDefinitionChange={setDefinition} onSave={() => void save()} onPublish={() => void publish()} publishing={publishing} saveMessage={saveMessage} /> : null}
      </div>
    </main>
  );
}

export function WorkflowGraphEditorView({ editor, definition, onDefinitionChange, onSave, onPublish, publishing, saveMessage }: {
  editor: WorkflowDesignEditorModel | null;
  definition: AgentWorkflowDefinitionV1;
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
        <div className="h-[34rem] bg-zinc-950" data-testid="workflow-react-flow-canvas">
          <ReactFlow
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
        <ValidationPanel issues={issues} />
        {selectedNode ? <NodeDetails node={selectedNode} /> : null}
        {selectedEdge ? <EdgeEditor edge={selectedEdge} states={graph.nodes} onChange={updateEdge} /> : null}
        <JsonDiagnostics definition={definition} />
      </aside>
    </section>
  );
}

function NodeDetails({ node }: { node: WorkflowGraphNodeModel }) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="text-xs uppercase tracking-wide text-cyan-300">Selected state</div>
      <h2 className="mt-1 text-lg font-semibold">{node.label}</h2>
      <dl className="mt-3 space-y-2 text-sm">
        <div><dt className="text-zinc-500">Owner role</dt><dd>{node.terminal ? 'Terminal state' : node.ownerLabel ?? 'Unassigned'}</dd></div>
        <div><dt className="text-zinc-500">State id</dt><dd>{node.id}</dd></div>
      </dl>
      <h3 className="mt-4 font-medium">Steps</h3>
      {node.steps.length ? <ul className="mt-2 space-y-2">{node.steps.map((step) => <li key={step.id} className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-sm"><StepSummary step={step} /></li>)}</ul> : <p className="mt-2 text-sm text-zinc-400">No steps in this state.</p>}
    </section>
  );
}

function StepSummary({ step }: { step: WorkflowGraphNodeModel['steps'][number] }) {
  return (
    <div>
      <div className="font-medium">{step.id}</div>
      <div className="mt-1 text-zinc-400">{step.type === 'agent_turn' ? `Agent turn · ${step.turnType}` : `Human form · ${step.humanFormTitle ?? 'Untitled form'}`}</div>
      {step.promptTemplate ? <div className="mt-2 text-xs text-zinc-500">Prompt: {step.promptTemplate}</div> : null}
      {step.promptRefs.length ? <div className="mt-2 text-xs text-zinc-500">Refs: {step.promptRefs.join(', ')}</div> : null}
      {step.humanFormProvider ? <div className="mt-2 text-xs text-zinc-500">Form provider: {step.humanFormProvider}</div> : null}
    </div>
  );
}

function EdgeEditor({ edge, states, onChange }: { edge: WorkflowGraphEdgeModel; states: WorkflowGraphNodeModel[]; onChange: (edgeId: string, edit: { actionLabel?: string; targetState?: string }) => void }) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="text-xs uppercase tracking-wide text-cyan-300">Selected action</div>
      <h2 className="mt-1 text-lg font-semibold">{edge.actionId}</h2>
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

function toFlowNodes(nodes: WorkflowGraphNodeModel[]): Node[] {
  return nodes.map((node, index) => ({
    id: node.id,
    position: { x: (index % 3) * 260, y: Math.floor(index / 3) * 170 },
    data: { label: `${node.initial ? 'Start · ' : ''}${node.label}${node.terminal ? ' · Done' : ''}` },
    className: node.terminal ? 'workflow-terminal-node' : undefined,
  }));
}

function toFlowEdges(edges: WorkflowGraphEdgeModel[]): Edge[] {
  return edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, label: edge.label, animated: edge.source === edge.target }));
}

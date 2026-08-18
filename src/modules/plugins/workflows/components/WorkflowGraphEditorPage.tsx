import "@xyflow/react/dist/style.css";
import "./WorkflowGraphEditorPage.css";

import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router";
import { IconArrowLeft, IconCheck, IconPencil } from "@tabler/icons-react";
import {
  Background,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  MarkerType,
  Position,
  ReactFlow,
  getBezierPath,
  useNodesState,
  type Edge,
  type EdgeProps,
  type Node,
} from "@xyflow/react";
import type {
  AgentWorkflowStepV1,
  AgentWorkflowDefinitionV1,
  WorkflowRuntimeSnapshot,
  WorkflowStepV1,
} from "@vibe-dashboard/workflow-core";
import {
  normalizeWorkflowDefinitionV1,
  renderExpectedXmlResponseXsd,
  WORKFLOW_EXECUTOR_MODEL_OPTIONS,
  WORKFLOW_EXECUTOR_TYPES,
} from "@vibe-dashboard/workflow-core";
import {
  fetchWorkflowDesignEditor,
  publishWorkflowDesignDraft,
  saveWorkflowDesignDraft,
  type WorkflowDesignEditorModel,
} from "../client/workflowDesignEditorApi";
import {
  fetchWorkflowAssets,
  type WorkflowAssetPickerItem,
  type WorkflowAssetsModel,
} from "../client/workflowAssetsApi";
import { StandaloneDashboardPage } from "../../../../components/StandaloneDashboardPage";
import {
  applyWorkflowGraphActionEdit,
  applyWorkflowGraphPromptEdit,
  validateWorkflowGraph,
  workflowDefinitionToGraph,
  type WorkflowGraphEdgeModel,
  type WorkflowGraphNodeModel,
  type WorkflowGraphValidationIssue,
} from "./graph/workflowGraphModel";

export function WorkflowGraphEditorPage(): React.ReactElement {
  const { designId } = useParams();
  const [editor, setEditor] = useState<WorkflowDesignEditorModel | null>(null);
  const [definition, setDefinition] =
    useState<AgentWorkflowDefinitionV1 | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [assets, setAssets] = useState<WorkflowAssetsModel>({
    prompts: [],
    skills: [],
  });

  useEffect(() => {
    if (!designId) {
      setError("Workflow design is required.");
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
      .catch((caught) => {
        if (active)
          setError(caught instanceof Error ? caught.message : String(caught));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    fetchWorkflowAssets()
      .then((loaded) => {
        if (active) setAssets(loaded);
      })
      .catch((caught) => {
        if (active)
          setError(caught instanceof Error ? caught.message : String(caught));
      });
    return () => {
      active = false;
    };
  }, [designId]);

  const publish = async () => {
    if (!editor?.draftId) return;
    setPublishing(true);
    setSaveMessage(null);
    try {
      const updated = await publishWorkflowDesignDraft(editor.draftId);
      setEditor(updated);
      setDefinition(updated.definition);
      setSaveMessage(
        `Published workflow version ${updated.version ?? ""}.`.trim(),
      );
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
      setSaveMessage("Saved workflow draft.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  return (
    <StandaloneDashboardPage contentClassName="mx-auto max-w-7xl space-y-5">
      <header className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
        <div className="text-xs uppercase tracking-wide text-cyan-300">
          Workflow builder
        </div>
        <h1 className="mt-1 text-2xl font-semibold">
          {editor?.name ?? "Workflow graph"}
        </h1>
        {editor?.description ? (
          <p className="mt-2 text-sm text-zinc-300">{editor.description}</p>
        ) : null}
      </header>
      {loading ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-5">
          Loading workflow graph…
        </div>
      ) : null}
      {error ? (
        <div
          role="alert"
          className="rounded-lg border border-amber-900 bg-amber-950/30 p-4 text-sm text-amber-100"
        >
          {error}
        </div>
      ) : null}
      {definition ? (
        <WorkflowGraphEditorView
          editor={editor}
          definition={definition}
          assets={assets}
          onDefinitionChange={setDefinition}
          onSave={() => void save()}
          onPublish={() => void publish()}
          publishing={publishing}
          saveMessage={saveMessage}
        />
      ) : null}
    </StandaloneDashboardPage>
  );
}

type WorkflowEditorEditTarget =
  | { kind: "design"; id: "design" }
  | { kind: "role"; id: string }
  | { kind: "state"; id: string }
  | { kind: "action"; id: string };

type WorkflowEditorInitialSelection = {
  roleId?: string;
  stateId?: string;
  edgeId?: string;
};

export type WorkflowWizardLevel = "landing" | "role" | "state" | "action";

export type WorkflowGraphFocusContext = {
  title: string;
  description: string;
  nodes: WorkflowGraphNodeModel[];
  edges: WorkflowGraphEdgeModel[];
};

export function WorkflowGraphEditorView({
  editor,
  definition,
  assets,
  onDefinitionChange,
  onSave,
  onPublish,
  publishing,
  saveMessage,
  initialSelection,
  initialEditTarget = null,
  initialGraphOpen: _initialGraphOpen = true,
}: {
  editor: WorkflowDesignEditorModel | null;
  definition: AgentWorkflowDefinitionV1;
  assets?: WorkflowAssetsModel;
  onDefinitionChange: (definition: AgentWorkflowDefinitionV1) => void;
  onSave: () => void;
  onPublish: () => void;
  publishing?: boolean;
  saveMessage?: string | null;
  initialSelection?: WorkflowEditorInitialSelection;
  initialEditTarget?: WorkflowEditorEditTarget | null;
  initialGraphOpen?: boolean;
}): React.ReactElement {
  const graph = useMemo(
    () => workflowDefinitionToGraph(definition),
    [definition],
  );
  const issues = useMemo(() => validateWorkflowGraph(definition), [definition]);
  const roleEntries = Object.entries(definition.roles);
  const [wizardLevel, setWizardLevel] = useState<WorkflowWizardLevel>(initialSelection?.edgeId ? "action" : initialSelection?.stateId ? "state" : initialSelection?.roleId ? "role" : "landing");
  const [selectedRoleId, setSelectedRoleId] = useState(
    initialSelection?.roleId ?? "",
  );
  const [selectedNodeId, setSelectedNodeId] = useState(
    initialSelection?.stateId ?? "",
  );
  const [selectedEdgeId, setSelectedEdgeId] = useState(
    initialSelection?.edgeId ?? "",
  );
  const [editTarget, setEditTarget] = useState<WorkflowEditorEditTarget | null>(
    initialEditTarget,
  );
  void _initialGraphOpen;
  const selectedNode =
    graph.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const selectedEdge =
    graph.edges.find((edge) => edge.id === selectedEdgeId) ?? null;
  const selectedRole = selectedRoleId ? definition.roles[selectedRoleId] : null;
  const graphFocus = useMemo(
    () =>
      buildWorkflowEditorGraphFocusContext({
        definition,
        nodes: graph.nodes,
        edges: graph.edges,
        wizardLevel,
        selectedRoleId,
        selectedNodeId,
        selectedEdgeId,
      }),
    [definition, graph.nodes, graph.edges, wizardLevel, selectedRoleId, selectedNodeId, selectedEdgeId],
  );
  const layoutedNodes = useMemo(
    () => toFlowNodes(graphFocus.nodes, graphFocus.edges),
    [graphFocus.nodes, graphFocus.edges],
  );
  const [flowNodes, setFlowNodes, onNodesChange] = useNodesState(layoutedNodes);
  const flowEdges = useMemo(
    () =>
      toFlowEdges(graphFocus.edges, selectedEdgeId, graphFocus.nodes, (edgeId) => {
        const edge = graph.edges.find((candidate) => candidate.id === edgeId);
        if (edge) {
          const source = graph.nodes.find(
            (candidate) => candidate.id === edge.source,
          );
          if (source?.ownerRoleId) setSelectedRoleId(source.ownerRoleId);
          setSelectedNodeId(edge.source);
          setSelectedEdgeId(edgeId);
          setWizardLevel("action");
        }
        setEditTarget(null);
      }),
    [graph.edges, selectedEdgeId, graph.nodes, graphFocus.edges, graphFocus.nodes],
  );
  const canSave = Boolean(editor?.draftId) && issues.length === 0;

  useEffect(() => {
    setFlowNodes(layoutedNodes);
  }, [layoutedNodes, setFlowNodes]);

  useEffect(() => {
    if (!selectedRoleId || definition.roles[selectedRoleId]) return;
    setSelectedRoleId("");
    setWizardLevel("landing");
  }, [definition.roles, roleEntries, selectedRoleId]);

  const updateEdge = (
    edgeId: string,
    edit: { actionLabel?: string; targetState?: string; handoffPrompt?: string },
  ) => {
    onDefinitionChange(applyWorkflowGraphActionEdit(definition, edgeId, edit));
  };

  const updatePrompt = (
    stateId: string,
    stepId: string,
    edit: { promptTemplate?: string },
  ) => {
    onDefinitionChange(applyWorkflowGraphPromptEdit(definition, stateId, stepId, edit));
  };

  const resetLayout = () => setFlowNodes(layoutedNodes);

  const selectRole = (roleId: string) => {
    setSelectedRoleId(roleId);
    setSelectedNodeId("");
    setSelectedEdgeId("");
    setWizardLevel("role");
    setEditTarget(null);
  };

  const selectState = (stateId: string) => {
    const node = graph.nodes.find((candidate) => candidate.id === stateId);
    if (node?.ownerRoleId) setSelectedRoleId(node.ownerRoleId);
    setSelectedNodeId(stateId);
    setSelectedEdgeId("");
    setWizardLevel("state");
    setEditTarget(null);
  };

  const selectEdge = (edgeId: string) => {
    const edge = graph.edges.find((candidate) => candidate.id === edgeId);
    if (edge) {
      const source = graph.nodes.find(
        (candidate) => candidate.id === edge.source,
      );
      if (source?.ownerRoleId) setSelectedRoleId(source.ownerRoleId);
      setSelectedNodeId(edge.source);
      setWizardLevel("action");
    }
    setSelectedEdgeId(edgeId);
    setEditTarget(null);
  };

  const addRole = () => {
    const roleId = nextRoleId(definition.roles);
    onDefinitionChange({
      ...definition,
      roles: { ...definition.roles, [roleId]: { label: "New role" } },
    });
    setSelectedRoleId(roleId);
    setSelectedNodeId("");
    setSelectedEdgeId("");
    setWizardLevel("role");
    setEditTarget({ kind: "role", id: roleId });
  };

  const goBack = () => {
    setEditTarget(null);
    if (wizardLevel === "action") {
      setSelectedEdgeId("");
      setWizardLevel("state");
      return;
    }
    if (wizardLevel === "state") {
      setSelectedNodeId("");
      setWizardLevel("role");
      return;
    }
    if (wizardLevel === "role") {
      setSelectedRoleId("");
      setWizardLevel("landing");
    }
  };

  return (
    <section className="grid gap-5 lg:grid-cols-[minmax(0,28rem)_minmax(0,1fr)]">
      <aside className="space-y-4 lg:order-first">
        {saveMessage ? (
          <div className="rounded-lg border border-emerald-800 bg-emerald-950/30 p-3 text-sm text-emerald-100">
            {saveMessage}
          </div>
        ) : null}
        <WorkflowDetails
          definition={definition}
          editing={editTarget?.kind === "design"}
          onEdit={() => setEditTarget({ kind: "design", id: "design" })}
          onDone={() => setEditTarget(null)}
          onChange={onDefinitionChange}
        />
        <WorkflowWizardPanel
          definition={definition}
          nodes={graph.nodes}
          edges={graph.edges}
          level={wizardLevel}
          selectedRoleId={selectedRoleId}
          selectedNode={selectedNode}
          selectedEdge={selectedEdge}
          selectedEdgeId={selectedEdgeId}
          selectedRole={selectedRole ?? null}
          assets={assets ?? { prompts: [], skills: [], roleTemplates: [] }}
          editTarget={editTarget}
          onBack={goBack}
          onSelectRole={selectRole}
          onSelectState={selectState}
          onSelectEdge={selectEdge}
          onAddRole={addRole}
          onEditRole={() => selectedRoleId && setEditTarget({ kind: "role", id: selectedRoleId })}
          onEditState={() => selectedNode && setEditTarget({ kind: "state", id: selectedNode.id })}
          onEditAction={() => selectedEdge && setEditTarget({ kind: "action", id: selectedEdge.id })}
          onDone={() => setEditTarget(null)}
          onDefinitionChange={onDefinitionChange}
          onEdgeChange={updateEdge}
          onPromptChange={updatePrompt}
        />
        <ValidationPanel issues={issues} />
        <XsdDiagnostics definition={definition} selectedStateId={selectedNodeId} selectedEdge={selectedEdge} />
        <JsonDiagnostics definition={definition} />
      </aside>
      <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/60 lg:sticky lg:top-4 lg:self-start">
        <div className="flex items-center justify-between gap-3 border-b border-zinc-800 p-4">
          <div>
            <h2 className="font-semibold">Context graph</h2>
            <p className="text-sm text-zinc-400">
              {graphFocus.title}: {graphFocus.description}
            </p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              className="rounded-md border border-zinc-700 px-3 py-2 text-sm"
              onClick={resetLayout}
            >
              Reset layout
            </button>
            <button
              className="rounded-md border border-zinc-700 px-3 py-2 text-sm disabled:opacity-50"
              disabled={!canSave}
              onClick={onSave}
            >
              Save draft
            </button>
            <button
              className="rounded-md bg-cyan-500 px-3 py-2 text-sm font-medium text-zinc-950 disabled:opacity-50"
              disabled={!canSave || publishing}
              onClick={onPublish}
            >
              {publishing ? "Publishing…" : "Publish"}
            </button>
          </div>
        </div>
        <div
          id="workflow-context-graph"
          className="h-[24rem] bg-slate-950"
          data-testid="workflow-react-flow-canvas"
        >
          <ReactFlow
            className="workflow-graph-canvas"
            nodes={flowNodes}
            edges={flowEdges}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            minZoom={0.85}
            edgeTypes={workflowEdgeTypes}
            nodesDraggable
            nodesConnectable={false}
            elementsSelectable
            onNodesChange={onNodesChange}
            onNodeClick={(_, node) => {
              if (node.id.startsWith("role:")) selectRole(node.id.slice("role:".length));
              else if (!node.id.startsWith("terminal:")) selectState(node.id);
            }}
            onEdgeClick={(_, edge) => {
              if (graph.edges.some((candidate) => candidate.id === edge.id)) selectEdge(edge.id);
            }}
          >
            <Background />
            <Controls />
          </ReactFlow>
        </div>
      </div>
    </section>
  );
}


function WorkflowWizardPanel({
  definition,
  nodes,
  edges,
  level,
  selectedRoleId,
  selectedNode,
  selectedEdge,
  selectedEdgeId,
  selectedRole,
  assets,
  editTarget,
  onBack,
  onSelectRole,
  onSelectState,
  onSelectEdge,
  onAddRole,
  onEditRole,
  onEditState,
  onEditAction,
  onDone,
  onDefinitionChange,
  onEdgeChange,
  onPromptChange,
}: {
  definition: AgentWorkflowDefinitionV1;
  nodes: WorkflowGraphNodeModel[];
  edges: WorkflowGraphEdgeModel[];
  level: WorkflowWizardLevel;
  selectedRoleId: string;
  selectedNode: WorkflowGraphNodeModel | null;
  selectedEdge: WorkflowGraphEdgeModel | null;
  selectedEdgeId: string;
  selectedRole: AgentWorkflowDefinitionV1["roles"][string] | null;
  assets: WorkflowAssetsModel;
  editTarget: WorkflowEditorEditTarget | null;
  onBack: () => void;
  onSelectRole: (roleId: string) => void;
  onSelectState: (stateId: string) => void;
  onSelectEdge: (edgeId: string) => void;
  onAddRole: () => void;
  onEditRole: () => void;
  onEditState: () => void;
  onEditAction: () => void;
  onDone: () => void;
  onDefinitionChange: (definition: AgentWorkflowDefinitionV1) => void;
  onEdgeChange: (edgeId: string, edit: { actionLabel?: string; targetState?: string; handoffPrompt?: string }) => void;
  onPromptChange: (stateId: string, stepId: string, edit: { promptTemplate?: string }) => void;
}) {
  const roleEntries = Object.entries(definition.roles);
  const roleStates = selectedRoleId ? nodes.filter((node) => node.ownerRoleId === selectedRoleId) : [];
  const stateActions = selectedNode ? edges.filter((edge) => edge.source === selectedNode.id) : [];

  if (level === "landing") {
    return (
      <section className="rounded-xl border border-cyan-900/60 bg-slate-950/80 p-4" aria-label="Workflow wizard roles">
        <div className="text-xs uppercase tracking-wide text-cyan-300">Workflow wizard</div>
        <h2 className="mt-1 font-semibold">Roles</h2>
        <div className="mt-4 space-y-2">
          {roleEntries.map(([roleId, role]) => {
            const stateCount = nodes.filter((node) => node.ownerRoleId === roleId).length;
            return (
              <button key={roleId} type="button" onClick={() => onSelectRole(roleId)} className="w-full rounded-lg border border-zinc-800 bg-zinc-900/70 px-3 py-2 text-left text-sm text-zinc-200 hover:border-cyan-500 hover:bg-cyan-950/20">
                <span className="font-medium">{role.label ?? roleId}</span>
                <span className="ml-2 text-xs text-zinc-400">{roleId} · {stateCount} {stateCount === 1 ? "state" : "states"}</span>
                <span className="mt-1 block text-xs text-zinc-400">{formatEditorRolePreference(role)}</span>
              </button>
            );
          })}
          <button type="button" onClick={onAddRole} className="w-full rounded-lg border border-dashed border-zinc-700 px-3 py-2 text-left text-sm text-cyan-200 hover:border-cyan-500 hover:bg-cyan-950/20">
            + Add Role
          </button>
        </div>
      </section>
    );
  }

  if (level === "role" && selectedRole && selectedRoleId) {
    return (
      <section className="space-y-4 rounded-xl border border-cyan-900/60 bg-slate-950/80 p-4" aria-label="Selected role wizard view">
        <WizardHeader title="Role selected" subtitle={selectedRole.label ?? selectedRoleId} onBack={onBack} />
        <RoleDetails
          roleId={selectedRoleId}
          role={selectedRole}
          stateCount={roleStates.length}
          definition={definition}
          assets={assets}
          editing={editTarget?.kind === "role" && editTarget.id === selectedRoleId}
          onEdit={onEditRole}
          onDone={onDone}
          onChange={onDefinitionChange}
        />
        <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
          <h3 className="font-medium">States for this role</h3>
          <div className="mt-3 space-y-2">
            {roleStates.length ? roleStates.map((node) => (
              <button key={node.id} type="button" onClick={() => onSelectState(node.id)} className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-left text-sm hover:border-emerald-500">
                <span className="font-medium">{node.label}</span>
                <span className="ml-2 text-xs text-zinc-400">{node.id}</span>
              </button>
            )) : <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 text-sm text-zinc-400">No states are assigned to this role yet.</div>}
          </div>
        </section>
      </section>
    );
  }

  if (level === "state" && selectedNode) {
    return (
      <section className="space-y-4 rounded-xl border border-cyan-900/60 bg-slate-950/80 p-4" aria-label="Selected state wizard view">
        <WizardHeader title="State selected" subtitle={selectedNode.label} onBack={onBack} />
        <NodeDetails
          node={selectedNode}
          definition={definition}
          assets={assets}
          editing={editTarget?.kind === "state" && editTarget.id === selectedNode.id}
          onEdit={onEditState}
          onDone={onDone}
          onChange={onDefinitionChange}
          onPromptChange={onPromptChange}
        />
        <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
          <h3 className="font-medium">Transitions / actions</h3>
          <div className="mt-3 space-y-2">
            {stateActions.length ? stateActions.map((edge) => (
              <button key={edge.id} type="button" onClick={() => onSelectEdge(edge.id)} className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${edge.id === selectedEdgeId ? "border-violet-500 bg-violet-950/30" : "border-zinc-800 bg-zinc-950 hover:border-violet-500"}`}>
                <span className="font-medium">{edge.label}</span>
                <span className="block text-xs text-zinc-400">{edge.actionId}: {edge.source} → {edge.target}</span>
              </button>
            )) : <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 text-sm text-zinc-400">{selectedNode.terminal ? "Terminal states do not have outgoing actions." : "No outgoing transitions for this state yet."}</div>}
          </div>
        </section>
      </section>
    );
  }

  if (level === "action" && selectedEdge) {
    return (
      <section className="space-y-4 rounded-xl border border-cyan-900/60 bg-slate-950/80 p-4" aria-label="Selected action wizard view">
        <WizardHeader title="Action selected" subtitle={`${selectedEdge.label} · ${selectedEdge.source} → ${selectedEdge.target}`} onBack={onBack} />
        <EdgeEditor
          edge={selectedEdge}
          states={nodes}
          editing={editTarget?.kind === "action" && editTarget.id === selectedEdge.id}
          onEdit={onEditAction}
          onDone={onDone}
          onChange={onEdgeChange}
        />
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 text-sm text-zinc-400">
      Select a workflow role to continue.
    </section>
  );
}

function WizardHeader({ title, subtitle, onBack }: { title: string; subtitle: string; onBack: () => void }) {
  return (
    <header className="flex items-start gap-3">
      <button type="button" onClick={onBack} className="rounded-md border border-zinc-700 p-2 text-cyan-100 hover:border-cyan-500" aria-label="Back">
        <IconArrowLeft size={16} aria-hidden="true" />
      </button>
      <div>
        <div className="text-xs uppercase tracking-wide text-cyan-300">{title}</div>
        <h2 className="mt-1 text-lg font-semibold">{subtitle}</h2>
      </div>
    </header>
  );
}

export function WorkflowOutlineNavigator({
  definition,
  nodes,
  edges,
  selectedRoleId,
  selectedNodeId,
  selectedEdgeId,
  onSelectRole,
  onSelectState,
  onSelectEdge,
  onAddRole,
}: {
  definition: AgentWorkflowDefinitionV1;
  nodes: WorkflowGraphNodeModel[];
  edges: WorkflowGraphEdgeModel[];
  selectedRoleId: string;
  selectedNodeId: string;
  selectedEdgeId: string;
  onSelectRole: (roleId: string) => void;
  onSelectState: (stateId: string) => void;
  onSelectEdge: (edgeId: string) => void;
  onAddRole: () => void;
}) {
  const roleEntries = Object.entries(definition.roles);
  const selectedRole =
    selectedRoleId && definition.roles[selectedRoleId]
      ? selectedRoleId
      : (roleEntries[0]?.[0] ?? "");
  const roleStates = nodes.filter((node) => node.ownerRoleId === selectedRole);
  const selectedState =
    roleStates.find((node) => node.id === selectedNodeId) ??
    nodes.find((node) => node.id === selectedNodeId) ??
    null;
  const stateActions = selectedState
    ? edges.filter((edge) => edge.source === selectedState.id)
    : [];

  return (
    <section
      className="rounded-xl border border-cyan-900/60 bg-slate-950/80 p-4"
      aria-label="Workflow outline wizard"
    >
      <div className="text-xs uppercase tracking-wide text-cyan-300">
        Workflow outline
      </div>
      <h2 className="mt-1 font-semibold">Roles</h2>

      <div className="mt-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Roles
        </div>
        <div className="mt-2 space-y-2">
          {roleEntries.map(([roleId, role]) => {
            const active = roleId === selectedRole;
            const stateCount = nodes.filter(
              (node) => node.ownerRoleId === roleId,
            ).length;
            return (
              <button
                key={roleId}
                type="button"
                aria-pressed={active}
                onClick={() => onSelectRole(roleId)}
                className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${active ? "border-cyan-500 bg-cyan-950/40 text-cyan-50" : "border-zinc-800 bg-zinc-900/70 text-zinc-200 hover:border-zinc-600"}`}
              >
                <span className="font-medium">{role.label ?? roleId}</span>
                <span className="ml-2 text-xs text-zinc-400">
                  {roleId} · {stateCount}{" "}
                  {stateCount === 1 ? "state" : "states"}
                </span>
                <span className="mt-1 block text-xs text-zinc-400">
                  {formatEditorRolePreference(role)}
                </span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={onAddRole}
            className="w-full rounded-lg border border-dashed border-zinc-700 px-3 py-2 text-left text-sm text-cyan-200 hover:border-cyan-500 hover:bg-cyan-950/20"
          >
            + Add Role
          </button>
        </div>
      </div>

      <div className="mt-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          States
        </div>
        <div className="mt-2 space-y-2">
          {roleStates.length > 0 ? (
            roleStates.map((node) => {
              const active = node.id === selectedNodeId;
              return (
                <button
                  key={node.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onSelectState(node.id)}
                  className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${active ? "border-emerald-500 bg-emerald-950/30 text-emerald-50" : "border-zinc-800 bg-zinc-900/70 text-zinc-200 hover:border-zinc-600"}`}
                >
                  <span className="font-medium">{node.label}</span>
                  <span className="ml-2 text-xs text-zinc-400">{node.id}</span>
                </button>
              );
            })
          ) : (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 text-sm text-zinc-400">
              No states are assigned to this role yet.
            </div>
          )}
        </div>
      </div>

      {selectedState ? (
        <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 text-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Selected state
          </div>
          <div className="mt-1 font-medium text-zinc-100">
            {selectedState.label}
          </div>
          <div className="mt-1 text-xs text-zinc-400">
            {selectedState.id}
            {selectedState.terminal
              ? " · terminal"
              : selectedState.ownerLabel
                ? ` · owned by ${selectedState.ownerLabel}`
                : ""}
          </div>
        </div>
      ) : null}

      <div className="mt-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Transitions / actions
        </div>
        <div className="mt-2 space-y-2">
          {stateActions.length > 0 ? (
            stateActions.map((edge) => {
              const active = edge.id === selectedEdgeId;
              return (
                <button
                  key={edge.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onSelectEdge(edge.id)}
                  className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${active ? "border-violet-500 bg-violet-950/30 text-violet-50" : "border-zinc-800 bg-zinc-900/70 text-zinc-200 hover:border-zinc-600"}`}
                >
                  <span className="font-medium">{edge.label}</span>
                  <span className="block text-xs text-zinc-400">
                    {edge.actionId}: {edge.source} → {edge.target}
                  </span>
                </button>
              );
            })
          ) : (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 text-sm text-zinc-400">
              {!selectedState
                ? "Choose a state to see its outgoing transitions."
                : selectedState.terminal
                  ? "Terminal states do not have outgoing actions."
                  : "No outgoing transitions for this state yet."}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function nextRoleId(roles: AgentWorkflowDefinitionV1["roles"]) {
  let index = Object.keys(roles).length + 1;
  let roleId = `role_${index}`;
  while (roles[roleId]) {
    index += 1;
    roleId = `role_${index}`;
  }
  return roleId;
}

function WorkflowDetails({
  definition,
  editing,
  onEdit,
  onDone,
  onChange,
}: {
  definition: AgentWorkflowDefinitionV1;
  editing: boolean;
  onEdit: () => void;
  onDone: () => void;
  onChange: (definition: AgentWorkflowDefinitionV1) => void;
}) {
  if (!editing) {
    return (
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-cyan-300">Workflow details</div>
            <h2 className="mt-1 text-lg font-semibold">{definition.name}</h2>
            {definition.description ? (
              <p className="mt-1 text-xs text-zinc-500">
                {definition.description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            className="rounded-md border border-zinc-700 p-2 text-cyan-100 hover:border-cyan-500"
            onClick={onEdit}
            aria-label="Edit workflow details"
            title="Edit workflow details"
          >
            <IconPencil size={16} aria-hidden="true" />
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">Edit workflow details</h2>
        <button
          type="button"
          className="rounded-md border border-zinc-700 p-2 text-emerald-100"
          onClick={onDone}
          aria-label="Done editing workflow details"
          title="Done"
        >
          <IconCheck size={16} aria-hidden="true" />
        </button>
      </div>
      <label className="mt-3 block text-sm">
        <span className="font-medium">Workflow name</span>
        <input
          className="mt-2 w-full rounded-md border border-zinc-700 bg-zinc-950 p-2"
          value={definition.name}
          onChange={(event) =>
            onChange({ ...definition, name: event.target.value })
          }
        />
      </label>
      <label className="mt-3 block text-sm">
        <span className="font-medium">Description</span>
        <textarea
          className="mt-2 min-h-20 w-full rounded-md border border-zinc-700 bg-zinc-950 p-2"
          value={definition.description ?? ""}
          onChange={(event) =>
            onChange({
              ...definition,
              description: event.target.value || undefined,
            })
          }
        />
      </label>
    </section>
  );
}

function RoleDetails({
  roleId,
  role,
  stateCount,
  definition,
  assets,
  editing,
  onEdit,
  onDone,
  onChange,
}: {
  roleId: string;
  role: AgentWorkflowDefinitionV1["roles"][string];
  stateCount: number;
  definition: AgentWorkflowDefinitionV1;
  assets: WorkflowAssetsModel;
  editing: boolean;
  onEdit: () => void;
  onDone: () => void;
  onChange: (definition: AgentWorkflowDefinitionV1) => void;
}) {
  const executorType = role.executorPreference?.executorType ?? "";
  const modelOptions = executorType
    ? (WORKFLOW_EXECUTOR_MODEL_OPTIONS[executorType]?.models ?? [])
    : [];
  const linkedTemplate = role.templateRef
    ? assets.roleTemplates?.find(
        (template) =>
          template.id === role.templateRef?.templateId &&
          template.version === role.templateRef?.version,
      )
    : null;

  if (!editing) {
    return (
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-cyan-300">
              Selected role
            </div>
            <h2 className="mt-1 text-lg font-semibold">
              {role.label ?? roleId}
            </h2>
            <p className="mt-1 text-xs text-zinc-400">
              {roleId} · {stateCount} {stateCount === 1 ? "state" : "states"}
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              {formatEditorRolePreference(role)}
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              {linkedTemplate
                ? `Role template: ${linkedTemplate.name} v${linkedTemplate.version}`
                : role.templateRef
                  ? `Role template unavailable: ${role.templateRef.templateId}@${role.templateRef.version}`
                  : "Role template: none"}
            </p>
          </div>
          <button
            type="button"
            className="rounded-md border border-zinc-700 p-2 text-cyan-100 hover:border-cyan-500"
            onClick={onEdit}
            aria-label={`Edit role ${roleId}`}
            title="Edit role"
          >
            <IconPencil size={16} aria-hidden="true" />
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-cyan-900/60 bg-slate-950/80 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-cyan-300">
            Editing role
          </div>
          <h2 className="mt-1 text-lg font-semibold">{roleId}</h2>
        </div>
        <button
          type="button"
          className="rounded-md border border-zinc-700 p-2 text-emerald-100"
          onClick={onDone}
          aria-label={`Done editing role ${roleId}`}
          title="Done"
        >
          <IconCheck size={16} aria-hidden="true" />
        </button>
      </div>
      <label className="mt-3 block text-sm">
        <span className="font-medium">{roleId} label</span>
        <input
          className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 p-2"
          value={role.label ?? roleId}
          onChange={(event) =>
            onChange({
              ...definition,
              roles: {
                ...definition.roles,
                [roleId]: { ...role, label: event.target.value },
              },
            })
          }
        />
      </label>
      <RoleTemplateSelector
        roleId={roleId}
        role={role}
        definition={definition}
        assets={assets}
        onChange={onChange}
      />
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="font-medium">Executor preference</span>
          <select
            aria-label={`${roleId} executor preference`}
            className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 p-2"
            value={executorType}
            onChange={(event) => {
              const nextExecutor = event.target.value;
              onChange({
                ...definition,
                roles: {
                  ...definition.roles,
                  [roleId]: {
                    ...role,
                    executorPreference: nextExecutor
                      ? {
                          executorType: nextExecutor as never,
                          model: "recommended",
                          mode: "preferred",
                        }
                      : undefined,
                  },
                },
              });
            }}
          >
            <option value="">Workspace default</option>
            {WORKFLOW_EXECUTOR_TYPES.map((executor) => (
              <option key={executor} value={executor}>
                {WORKFLOW_EXECUTOR_MODEL_OPTIONS[executor].label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="font-medium">Model preference</span>
          <select
            aria-label={`${roleId} model preference`}
            className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 p-2 disabled:opacity-60"
            value={role.executorPreference?.model ?? "recommended"}
            disabled={!executorType}
            onChange={(event) =>
              onChange({
                ...definition,
                roles: {
                  ...definition.roles,
                  [roleId]: {
                    ...role,
                    executorPreference: executorType
                      ? {
                          executorType,
                          model: event.target.value,
                          mode: "preferred",
                        }
                      : undefined,
                  },
                },
              })
            }
          >
            {modelOptions.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
        </label>
      </div>
    </section>
  );
}

function RoleTemplateSelector({
  roleId,
  role,
  definition,
  assets,
  onChange,
}: {
  roleId: string;
  role: AgentWorkflowDefinitionV1["roles"][string];
  definition: AgentWorkflowDefinitionV1;
  assets: WorkflowAssetsModel;
  onChange: (definition: AgentWorkflowDefinitionV1) => void;
}) {
  const templates = assets.roleTemplates ?? [];
  const selectedKey = role.templateRef
    ? `${role.templateRef.templateId}@${role.templateRef.version}`
    : "";
  const selected = templates.find(
    (template) => `${template.id}@${template.version}` === selectedKey,
  );
  const changeTemplate = (value: string) => {
    const nextRole = { ...role } as AgentWorkflowDefinitionV1["roles"][string];
    if (!value) {
      delete nextRole.templateRef;
    } else {
      const template = templates.find(
        (candidate) => `${candidate.id}@${candidate.version}` === value,
      );
      if (!template) return;
      nextRole.templateRef = { templateId: template.id, version: template.version };
      if (!nextRole.executorPreference && template.executorPreference) {
        nextRole.executorPreference = {
          executorType: template.executorPreference.executorType as never,
          model: template.executorPreference.model,
          mode: "preferred",
        };
      }
    }
    onChange({
      ...definition,
      roles: { ...definition.roles, [roleId]: nextRole },
    });
  };

  return (
    <section className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
      <label className="block text-sm">
        <span className="font-medium">Shared role template</span>
        <select
          aria-label={`${roleId} shared role template`}
          className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 p-2"
          value={selectedKey}
          onChange={(event) => changeTemplate(event.target.value)}
        >
          <option value="">No shared role template</option>
          {templates.map((template) => (
            <option key={`${template.id}@${template.version}`} value={`${template.id}@${template.version}`} disabled={!template.active}>
              {template.name} v{template.version} · {sourceLabel(template.source)}
            </option>
          ))}
        </select>
      </label>
      {role.templateRef && !selected ? (
        <div className="mt-2 rounded border border-amber-900 bg-amber-950/30 p-2 text-xs text-amber-100">
          Linked role template is unavailable: {role.templateRef.templateId}@{role.templateRef.version}
        </div>
      ) : null}
      {selected ? (
        <div className="mt-3 rounded border border-cyan-900/60 bg-cyan-950/20 p-3 text-xs text-cyan-50">
          <div className="font-medium">{selected.name} v{selected.version}</div>
          {selected.description ? (
            <p className="mt-1 text-cyan-100">{selected.description}</p>
          ) : null}
          <p className="mt-2 whitespace-pre-wrap text-cyan-100">
            {selected.promptPreview}
          </p>
          {selected.skillRefs.length ? (
            <p className="mt-2 text-cyan-200">
              Skills: {selected.skillRefs.map(formatAssetRef).join(", ")}
            </p>
          ) : null}
          <p className="mt-2 text-cyan-200">
            Template changes publish as new versions; this workflow links the selected version.
          </p>
        </div>
      ) : templates.length ? null : (
        <div className="mt-2 rounded border border-dashed border-zinc-800 p-2 text-xs text-zinc-500">
          No shared role templates are available yet.
        </div>
      )}
    </section>
  );
}

function NodeDetails({
  node,
  definition,
  assets,
  editing,
  onEdit,
  onDone,
  onChange,
  onPromptChange,
}: {
  node: WorkflowGraphNodeModel;
  definition: AgentWorkflowDefinitionV1;
  assets: WorkflowAssetsModel;
  editing: boolean;
  onEdit: () => void;
  onDone: () => void;
  onChange: (definition: AgentWorkflowDefinitionV1) => void;
  onPromptChange: (stateId: string, stepId: string, edit: { promptTemplate?: string }) => void;
}) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="text-xs uppercase tracking-wide text-cyan-300">
        Selected state
      </div>
      <div className="flex items-start justify-between gap-3">
        <h2 className="mt-1 text-lg font-semibold">{node.label}</h2>
        <button
          type="button"
          className="rounded-md border border-zinc-700 p-2 text-cyan-100 hover:border-cyan-500"
          onClick={editing ? onDone : onEdit}
          aria-label={editing ? `Done editing state ${node.id}` : `Edit state ${node.id}`}
          title={editing ? "Done" : "Edit state"}
        >
          {editing ? <IconCheck size={16} aria-hidden="true" /> : <IconPencil size={16} aria-hidden="true" />}
        </button>
      </div>
      <dl className="mt-3 space-y-2 text-sm">
        <div>
          <dt className="text-zinc-500">Owner role</dt>
          <dd>
            {node.terminal
              ? "Terminal state"
              : (node.ownerLabel ?? "Unassigned")}
          </dd>
        </div>
        <div>
          <dt className="text-zinc-500">State id</dt>
          <dd>{node.id}</dd>
        </div>
      </dl>
      <h3 className="mt-4 font-medium">Steps</h3>
      {node.steps.length ? (
        <ul className="mt-2 space-y-2">
          {node.steps.map((step) => (
            <li
              key={step.id}
              className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-sm"
            >
              <StepSummary
                step={step}
                definition={definition}
                assets={assets}
                stateId={node.id}
                editing={editing}
                onChange={onChange}
                onPromptChange={onPromptChange}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-zinc-400">No steps in this state.</p>
      )}
    </section>
  );
}

function StepSummary({
  step,
  definition,
  assets,
  stateId,
  editing,
  onChange,
  onPromptChange,
}: {
  step: WorkflowGraphNodeModel["steps"][number];
  definition: AgentWorkflowDefinitionV1;
  assets: WorkflowAssetsModel;
  stateId: string;
  editing: boolean;
  onChange: (definition: AgentWorkflowDefinitionV1) => void;
  onPromptChange: (stateId: string, stepId: string, edit: { promptTemplate?: string }) => void;
}) {
  const state = definition.states[stateId];
  const roleId = state && !("terminal" in state) && typeof state.owner === "string" ? state.owner : null;
  const roleLabel = roleId ? definition.roles[roleId]?.label ?? roleId : null;
  return (
    <div>
      <div className="font-medium">{step.id}</div>
      <div className="mt-1 text-zinc-400">{stepSubtitle(step)}</div>
      {step.promptRefs.length ? (
        <div className="mt-2 text-xs text-zinc-500">
          Selected refs: {step.promptRefs.join(", ")}
        </div>
      ) : null}
      {step.type === "agent_turn" && editing ? (
        <PromptAuthoringEditor
          definition={definition}
          assets={assets}
          stateId={stateId}
          stepId={step.id}
          roleLabel={roleLabel}
          onPromptTemplateChange={(template) => onPromptChange(stateId, step.id, { promptTemplate: template })}
          onChange={onChange}
        />
      ) : step.type === "agent_turn" ? (
        <div className="mt-2 rounded border border-zinc-800 bg-zinc-900/50 p-2 text-xs text-zinc-500">
          Prompt and skill editing is available in state edit mode.
        </div>
      ) : null}
      {step.humanFormProvider ? (
        <div className="mt-2 text-xs text-zinc-500">
          Form provider: {step.humanFormProvider}
        </div>
      ) : null}
      {step.workflowCallDesignId ? (
        <div className="mt-2 text-xs text-zinc-500">
          Child workflow: {step.workflowCallDesignId}
          {step.workflowCallVersion ? `@${step.workflowCallVersion}` : ""}
        </div>
      ) : null}
      {step.commandId ? (
        <div className="mt-2 text-xs text-zinc-500">
          Command: {step.commandProvider}/{step.commandId} · {step.commandAccess ?? "read"}
        </div>
      ) : null}
    </div>
  );
}

function stepSubtitle(step: WorkflowGraphNodeModel["steps"][number]): string {
  if (step.type === "agent_turn") return `Agent turn · ${step.turnType}`;
  if (step.type === "human_form")
    return `Human form · ${step.humanFormTitle ?? "Untitled form"}`;
  if (step.type === "workflow_call")
    return `Workflow call · ${step.workflowCallMode ?? "blocking"}`;
  if (step.type === "command")
    return `Command · ${step.commandProvider ?? "provider"}/${step.commandId ?? "command"}`;
  return `Unsupported step · ${step.type}`;
}

function PromptAuthoringEditor({
  definition,
  assets,
  stateId,
  stepId,
  roleLabel,
  onPromptTemplateChange,
  onChange,
}: {
  definition: AgentWorkflowDefinitionV1;
  assets: WorkflowAssetsModel;
  stateId: string;
  stepId: string;
  roleLabel: string | null;
  onPromptTemplateChange: (template: string) => void;
  onChange: (definition: AgentWorkflowDefinitionV1) => void;
}) {
  const state = definition.states[stateId];
  if (!state || "terminal" in state) return null;
  const step = state.steps.find((candidate) => candidate.id === stepId) as
    | (WorkflowStepV1 & { prompt?: { template?: string; refs?: Array<{ kind: string; id: string; version?: number }> } })
    | undefined;
  if (!step || step.type !== "agent_turn") return null;
  const preview = renderEditorPromptPreview({ definition, assets, stateId, stepId });
  const usage = [
    roleLabel ? `Role: ${roleLabel}` : null,
    `State: ${stateId}`,
    `Step: ${stepId}`,
    step.turnType === "decision" ? "Decision response" : "Regular turn",
  ].filter(Boolean).join(" · ");

  return (
    <section className="mt-3 space-y-3 rounded-lg border border-cyan-900/60 bg-slate-950/80 p-3" aria-label={`${stepId} prompt authoring`}>
      <div>
        <h4 className="text-sm font-semibold text-cyan-100">Prompt authoring</h4>
        <p className="mt-1 text-xs text-zinc-400">{usage}</p>
      </div>
      <label className="block text-sm">
        <span className="font-medium text-zinc-200">Step prompt</span>
        <textarea
          aria-label={`${stepId} step prompt`}
          className="mt-2 min-h-28 w-full rounded-md border border-zinc-700 bg-zinc-950 p-2 text-sm text-zinc-100"
          value={step.prompt?.template ?? ""}
          placeholder="Tell this role what to do in this workflow state."
          onChange={(event) => onPromptTemplateChange(event.target.value)}
        />
      </label>
      <PromptRefsEditor definition={definition} assets={assets} stateId={stateId} stepId={stepId} onChange={onChange} />
      <section className="rounded-md border border-zinc-800 bg-zinc-950 p-3" aria-label={`${stepId} final prompt preview`}>
        <div className="flex items-center justify-between gap-3">
          <h4 className="text-sm font-medium text-zinc-200">Final prompt preview</h4>
          {preview.xmlSpec ? (
            <span className="rounded border border-cyan-900 bg-cyan-950/30 px-2 py-0.5 text-xs text-cyan-100">XML contract generated</span>
          ) : null}
        </div>
        <p className="mt-1 text-xs text-zinc-500">
          The XML response spec is generated by the workflow actions. You do not normally need to write it by hand.
        </p>
        {preview.missingRefs.length ? (
          <div className="mt-2 rounded border border-amber-900 bg-amber-950/30 p-2 text-xs text-amber-100">
            Preview is missing refs: {preview.missingRefs.join(", ")}
          </div>
        ) : null}
        <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded border border-zinc-800 bg-black/40 p-3 text-xs text-zinc-200">
          {preview.text}
        </pre>
      </section>
    </section>
  );
}

function PromptRefsEditor({
  definition,
  assets,
  stateId,
  stepId,
  onChange,
}: {
  definition: AgentWorkflowDefinitionV1;
  assets: WorkflowAssetsModel;
  stateId: string;
  stepId: string;
  onChange: (definition: AgentWorkflowDefinitionV1) => void;
}) {
  const state = definition.states[stateId];
  if (!state || "terminal" in state) return null;
  const step = state.steps.find((candidate) => candidate.id === stepId) as
    | (WorkflowStepV1 & {
        prompt?: {
          refs?: Array<{ kind: string; id: string; version?: number }>;
        };
      })
    | undefined;
  if (!step || step.type !== "agent_turn") return null;
  const selectedRefs = step.prompt.refs ?? [];
  const allAssets = [...assets.prompts, ...assets.skills];
  const missingRefs = selectedRefs.filter(
    (ref) =>
      !allAssets.some(
        (asset) =>
          asset.kind === ref.kind &&
          asset.id === ref.id &&
          (ref.version == null || asset.version === ref.version),
      ),
  );
  const toggle = (asset: WorkflowAssetPickerItem, checked: boolean) => {
    const refs = checked
      ? [
          ...selectedRefs.filter(
            (ref) => !(ref.kind === asset.kind && ref.id === asset.id),
          ),
          { kind: asset.kind, id: asset.id, version: asset.version },
        ]
      : selectedRefs.filter(
          (ref) =>
            !(
              ref.kind === asset.kind &&
              ref.id === asset.id &&
              (ref.version == null || ref.version === asset.version)
            ),
        );
    const next = JSON.parse(
      JSON.stringify(definition),
    ) as AgentWorkflowDefinitionV1;
    const nextState = next.states[stateId];
    if (!nextState || "terminal" in nextState) return;
    const nextStep = nextState.steps.find(
      (candidate) => candidate.id === stepId,
    ) as (WorkflowStepV1 & { prompt?: { refs?: unknown[] } }) | undefined;
    if (!nextStep || nextStep.type !== "agent_turn") return;
    nextStep.prompt = {
      ...nextStep.prompt,
      template: nextStep.prompt?.template ?? "",
      refs,
    } as typeof nextStep.prompt;
    onChange(next);
  };
  return (
    <section
      className="mt-3 rounded-md border border-zinc-800 bg-zinc-900/50 p-3"
      aria-label={`${stepId} prompt and skill picker`}
    >
      <h4 className="text-sm font-medium text-zinc-200">
        Prompt and skill snippets
      </h4>
      <p className="mt-1 text-xs text-zinc-500">
        Skills are markdown instruction snippets, not executable tools. Raw JSON
        remains diagnostics-only.
      </p>
      {missingRefs.length ? (
        <div className="mt-2 rounded border border-amber-900 bg-amber-950/30 p-2 text-xs text-amber-100">
          Missing prompt or skill refs:{" "}
          {missingRefs.map(formatAssetRef).join(", ")}
        </div>
      ) : null}
      <AssetChecklist
        title="Prompts"
        assets={assets.prompts}
        selectedRefs={selectedRefs}
        onToggle={toggle}
      />
      <AssetChecklist
        title="Skills"
        assets={assets.skills}
        selectedRefs={selectedRefs}
        onToggle={toggle}
      />
      {selectedRefs.length ? (
        <div className="mt-3 text-xs text-zinc-400">
          Selected: {selectedRefs.map(formatAssetRef).join(", ")}
        </div>
      ) : null}
    </section>
  );
}

function AssetChecklist({
  title,
  assets,
  selectedRefs,
  onToggle,
}: {
  title: string;
  assets: WorkflowAssetPickerItem[];
  selectedRefs: Array<{ kind: string; id: string; version?: number }>;
  onToggle: (asset: WorkflowAssetPickerItem, checked: boolean) => void;
}) {
  return (
    <div className="mt-3">
      <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
        {title}
      </div>
      {assets.length ? (
        <div className="mt-2 space-y-2">
          {assets.map((asset) => {
            const checked = selectedRefs.some(
              (ref) =>
                ref.kind === asset.kind &&
                ref.id === asset.id &&
                (ref.version == null || ref.version === asset.version),
            );
            return (
              <label
                key={`${asset.kind}:${asset.id}@${asset.version}`}
                className="flex gap-2 rounded border border-zinc-800 bg-zinc-950 p-2 text-xs"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => onToggle(asset, event.target.checked)}
                  aria-label={`${asset.kind}:${asset.id}@${asset.version}`}
                />
                <span>
                  <span className="font-medium text-zinc-200">
                    {asset.name}
                  </span>{" "}
                  <span className="text-zinc-500">
                    v{asset.version} · {sourceLabel(asset.source)}
                  </span>
                  {asset.description ? (
                    <span className="block text-zinc-400">
                      {asset.description}
                    </span>
                  ) : null}
                  <span className="block text-zinc-500">{asset.preview}</span>
                </span>
              </label>
            );
          })}
        </div>
      ) : (
        <div className="mt-2 rounded border border-dashed border-zinc-800 p-2 text-xs text-zinc-500">
          No {title.toLowerCase()} available.
        </div>
      )}
    </div>
  );
}

function formatAssetRef(ref: {
  kind: string;
  id: string;
  version?: number;
}): string {
  return `${ref.kind}:${ref.id}${ref.version ? `@${ref.version}` : ""}`;
}

function sourceLabel(source: string): string {
  if (source === "built_in") return "Built-in";
  if (source === "plugin") return "Plugin";
  if (source === "user") return "User";
  return source;
}

export function renderEditorPromptPreview({
  definition,
  assets,
  stateId,
  stepId,
}: {
  definition: AgentWorkflowDefinitionV1;
  assets: WorkflowAssetsModel;
  stateId: string;
  stepId: string;
}): { text: string; xmlSpec: string | null; missingRefs: string[] } {
  const state = definition.states[stateId];
  if (!state || "terminal" in state) return { text: "Choose an agent step to preview the prompt.", xmlSpec: null, missingRefs: [] };
  const step = state.steps.find((candidate) => candidate.id === stepId) as
    | (WorkflowStepV1 & { prompt?: { template?: string; refs?: Array<{ kind: string; id: string; version?: number }> } })
    | undefined;
  if (!step || step.type !== "agent_turn") return { text: "Choose an agent step to preview the prompt.", xmlSpec: null, missingRefs: [] };

  const refs = step.prompt?.refs ?? [];
  const allAssets = [...assets.prompts, ...assets.skills];
  const assetLines: string[] = [];
  const missingRefs: string[] = [];
  for (const ref of refs) {
    const asset = allAssets.find((candidate) => candidate.kind === ref.kind && candidate.id === ref.id && (ref.version == null || candidate.version === ref.version));
    if (!asset) {
      missingRefs.push(formatAssetRef(ref));
      continue;
    }
    assetLines.push([
      `### ${asset.kind === "skill" ? "Skill" : "Prompt"}: ${asset.name}`,
      `${formatAssetRef(asset)} · ${sourceLabel(asset.source)}`,
      asset.preview,
    ].join("\n"));
  }

  const xmlSpec = renderEditorXmlSpec(definition, stateId, stepId);
  const sections = [
    assetLines.length ? assetLines.join("\n\n") : null,
    step.prompt?.template?.trim() || "(No step prompt written yet.)",
    xmlSpec,
  ].filter((section): section is string => Boolean(section));

  return { text: sections.join("\n\n"), xmlSpec, missingRefs };
}

function renderEditorXmlSpec(definition: AgentWorkflowDefinitionV1, stateId: string, stepId: string): string | null {
  const context = buildEditorXsdContext(definition, stateId, stepId);
  if (!context.xsd) return null;
  return [
    "Expected XML Schema (XSD):",
    "```xml",
    context.xsd,
    "```",
  ].join("\n");
}

export function renderEditorResponseXsd(definition: AgentWorkflowDefinitionV1, stateId: string, stepId?: string): { xsd: string | null; message: string; stepId: string | null } {
  const context = buildEditorXsdContext(definition, stateId, stepId);
  return { xsd: context.xsd, message: context.message, stepId: context.stepId };
}

function buildEditorXsdContext(definition: AgentWorkflowDefinitionV1, stateId: string, stepId?: string): { xsd: string | null; message: string; stepId: string | null } {
  if (!stateId) return { xsd: null, message: "Choose a workflow state with a decision step to inspect generated XSD.", stepId: null };
  try {
    const model = normalizeWorkflowDefinitionV1(definitionWithPromptPlaceholders(definition), { workflowId: "workflow-editor-preview" });
    const state = model.states[stateId];
    if (!state || state.terminal) return { xsd: null, message: "Generated XSD is unavailable for terminal or missing states.", stepId: null };
    const step = (stepId
      ? state.steps.find((candidate) => candidate.id === stepId)
      : state.steps.find((candidate) => candidate.type === "agent_turn" && candidate.turnType === "decision")) as AgentWorkflowStepV1 | undefined;
    if (!step || step.type !== "agent_turn" || step.turnType !== "decision") {
      return { xsd: null, message: "Generated XSD is available only for decision agent turns.", stepId: step?.id ?? null };
    }
    const stepIndex = state.steps.findIndex((candidate) => candidate.id === step.id);
    const snapshot: WorkflowRuntimeSnapshot = {
      instanceId: "workflow-editor-preview",
      workflowId: model.workflowId,
      status: "running",
      currentState: stateId,
      currentStepIndex: stepIndex,
      visitId: "workflow-editor-preview",
      inputs: {},
      waitingFor: { kind: "agent_turn", state: stateId, stepId: step.id, turnId: "workflow-editor-preview" },
      history: [],
      createdAt: 0,
      updatedAt: 0,
    };
    const xsd = renderExpectedXmlResponseXsd(model, snapshot, step);
    return { xsd, message: xsd ? "Generated XSD matches the response contract appended to agent prompts." : "Generated XSD is unavailable for this selection.", stepId: step.id };
  } catch {
    return { xsd: null, message: "Generated XSD is unavailable until the workflow definition is valid enough to normalize.", stepId: null };
  }
}

function definitionWithPromptPlaceholders(definition: AgentWorkflowDefinitionV1): AgentWorkflowDefinitionV1 {
  const clone = JSON.parse(JSON.stringify(definition)) as AgentWorkflowDefinitionV1;
  for (const state of Object.values(clone.states)) {
    if ("terminal" in state) continue;
    for (const step of state.steps) {
      if (step.type !== "agent_turn") continue;
      const prompt = step.prompt as { template?: string; refs?: unknown[] };
      if (!prompt.template?.trim()) {
        const labels = Array.isArray(prompt.refs) ? prompt.refs.map(formatUnknownAssetRef).join(", ") : "";
        prompt.template = labels ? `Prompt refs: ${labels}` : "Prompt";
      }
      delete prompt.refs;
    }
  }
  return clone;
}

function formatUnknownAssetRef(ref: unknown): string {
  if (!ref || typeof ref !== "object") return "asset";
  const record = ref as { kind?: unknown; id?: unknown; version?: unknown };
  const kind = typeof record.kind === "string" ? record.kind : "asset";
  const id = typeof record.id === "string" ? record.id : "unknown";
  return `${kind}:${id}${typeof record.version === "number" ? `@${record.version}` : ""}`;
}

function EdgeEditor({
  edge,
  states,
  editing,
  onEdit,
  onDone,
  onChange,
}: {
  edge: WorkflowGraphEdgeModel;
  states: WorkflowGraphNodeModel[];
  editing: boolean;
  onEdit: () => void;
  onDone: () => void;
  onChange: (
    edgeId: string,
    edit: { actionLabel?: string; targetState?: string; handoffPrompt?: string },
  ) => void;
}) {
  const source = states.find((state) => state.id === edge.source);
  const target = states.find((state) => state.id === edge.target);
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="text-xs uppercase tracking-wide text-cyan-300">
        Selected action
      </div>
      <div className="flex items-start justify-between gap-3">
        <h2 className="mt-1 text-lg font-semibold">{edge.actionId}</h2>
        <button
          type="button"
          className="rounded-md border border-zinc-700 p-2 text-cyan-100 hover:border-cyan-500"
          onClick={editing ? onDone : onEdit}
          aria-label={editing ? `Done editing action ${edge.actionId}` : `Edit action ${edge.actionId}`}
          title={editing ? "Done" : "Edit action"}
        >
          {editing ? <IconCheck size={16} aria-hidden="true" /> : <IconPencil size={16} aria-hidden="true" />}
        </button>
      </div>
      <dl className="mt-3 grid gap-2 rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-sm">
        <div>
          <dt className="text-zinc-500">Transition</dt>
          <dd className="font-medium text-zinc-100">
            {source?.label ?? edge.source} → {target?.label ?? edge.target}
          </dd>
        </div>
        {edge.description ? (
          <div>
            <dt className="text-zinc-500">Description</dt>
            <dd className="text-zinc-200">{edge.description}</dd>
          </div>
        ) : null}
      </dl>
      {editing ? (
        <>
          <label className="mt-3 block text-sm">
            <span className="font-medium">Action label</span>
            <input
              className="mt-2 w-full rounded-md border border-zinc-700 bg-zinc-950 p-2"
              value={edge.label}
              onChange={(event) =>
                onChange(edge.id, { actionLabel: event.target.value })
              }
            />
          </label>
          <label className="mt-3 block text-sm">
            <span className="font-medium">Target state</span>
            <select
              className="mt-2 w-full rounded-md border border-zinc-700 bg-zinc-950 p-2"
              value={edge.target}
              onChange={(event) =>
                onChange(edge.id, { targetState: event.target.value })
              }
            >
              <option value="">Choose a target</option>
              {states.map((state) => (
                <option key={state.id} value={state.id}>
                  {state.label}
                </option>
              ))}
            </select>
          </label>
        </>
      ) : null}
      {edge.waitFor ? (
        <section className="mt-4 rounded-lg border border-cyan-900 bg-cyan-950/20 p-3 text-sm">
          <h3 className="font-medium text-cyan-100">Wait action</h3>
          <p className="mt-1 text-cyan-200">
            Provider: {edge.waitFor.provider}
          </p>
          {edge.waitFor.fields.length ? (
            <dl className="mt-2 space-y-1 text-xs">
              {edge.waitFor.fields.map((field) => (
                <div key={field.label} className="flex justify-between gap-3">
                  <dt className="text-cyan-300">{field.label}</dt>
                  <dd className="text-cyan-50">{field.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </section>
      ) : null}
      {edge.resultFields.length ? (
        <section className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
          <h3 className="text-sm font-medium">Result fields</h3>
          <ul className="mt-2 space-y-2">
            {edge.resultFields.map((field) => (
              <li
                key={field.name}
                className="rounded border border-zinc-800 bg-zinc-900/60 p-2 text-xs"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-zinc-100">
                    {field.name}
                  </span>
                  <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-zinc-400">
                    {field.type}
                    {field.multiple ? "[]" : ""}
                  </span>
                  {field.required ? (
                    <span className="rounded border border-amber-800 px-1.5 py-0.5 text-amber-200">
                      required
                    </span>
                  ) : null}
                </div>
                {field.description ? (
                  <p className="mt-1 text-zinc-400">{field.description}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {edge.handoffPrompt ? (
        <section className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
          <h3 className="text-sm font-medium">Handoff prompt</h3>
          <p className="mt-2 whitespace-pre-wrap text-xs text-zinc-300">
            {edge.handoffPrompt}
          </p>
        </section>
      ) : null}
      {editing ? (
        <label className="mt-4 block text-sm">
          <span className="font-medium">Handoff prompt</span>
          <span className="mt-1 block text-xs text-zinc-500">
            Optional transition context available to the target state's next prompt. This is not a separate queued message.
          </span>
          <textarea
            aria-label={`${edge.actionId} handoff prompt`}
            className="mt-2 min-h-24 w-full rounded-md border border-zinc-700 bg-zinc-950 p-2"
            value={edge.handoffPrompt ?? ""}
            placeholder="Example: Review {{transition.parsed.summary}}"
            onChange={(event) => onChange(edge.id, { handoffPrompt: event.target.value })}
          />
        </label>
      ) : null}
    </section>
  );
}

function ValidationPanel({
  issues,
}: {
  issues: WorkflowGraphValidationIssue[];
}) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <h2 className="font-semibold">Validation</h2>
      {issues.length ? (
        <ul className="mt-2 space-y-2 text-sm text-amber-100">
          {issues.map((issue) => (
            <li
              key={`${issue.code}:${issue.path}`}
              className="rounded border border-amber-900 bg-amber-950/30 p-2"
            >
              {issue.message}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-emerald-200">Ready to save.</p>
      )}
    </section>
  );
}


function XsdDiagnostics({
  definition,
  selectedStateId,
  selectedEdge,
}: {
  definition: AgentWorkflowDefinitionV1;
  selectedStateId: string;
  selectedEdge: WorkflowGraphEdgeModel | null;
}) {
  const stateId = selectedEdge?.source ?? selectedStateId;
  const diagnostics = renderEditorResponseXsd(definition, stateId);
  const textareaId = `workflow-xsd-diagnostics-${stateId || "none"}`;
  return (
    <details className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <summary className="cursor-pointer text-sm font-medium">
        Generated response XSD diagnostics
      </summary>
      <p className="mt-2 text-xs text-zinc-500">
        {stateId ? `State ${stateId}${diagnostics.stepId ? ` · decision step ${diagnostics.stepId}` : ""}` : "No state selected"}
      </p>
      {diagnostics.xsd ? (
        <>
          <label htmlFor={textareaId} className="mt-3 block text-xs font-medium text-zinc-400">
            Read-only generated XSD
          </label>
          <textarea
            id={textareaId}
            className="mt-2 h-72 w-full resize-y rounded-lg border border-zinc-800 bg-zinc-950 p-3 font-mono text-xs text-zinc-300"
            aria-label="Generated workflow response XSD"
            readOnly
            value={diagnostics.xsd}
          />
          <p className="mt-2 text-xs text-zinc-500">{diagnostics.message}</p>
        </>
      ) : (
        <p className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-sm text-zinc-400">
          {diagnostics.message}
        </p>
      )}
    </details>
  );
}

function JsonDiagnostics({
  definition,
}: {
  definition: AgentWorkflowDefinitionV1;
}) {
  return (
    <details className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <summary className="cursor-pointer text-sm font-medium">
        JSON diagnostics
      </summary>
      <pre
        className="mt-3 max-h-72 overflow-auto rounded-lg bg-zinc-950 p-3 text-xs text-zinc-300"
        aria-readonly="true"
      >
        {JSON.stringify(definition, null, 2)}
      </pre>
    </details>
  );
}

const workflowEdgeTypes = { workflowAction: WorkflowActionEdge };

type WorkflowActionEdgeData = {
  label: string;
  actionId: string;
  waitFor: WorkflowGraphEdgeModel["waitFor"];
  labelOffset: number;
  reverse: boolean;
  selfLoop: boolean;
  onSelect?: (edgeId: string) => void;
};


export function buildWorkflowEditorGraphFocusContext({
  definition,
  nodes,
  edges,
  wizardLevel,
  selectedRoleId,
  selectedNodeId,
  selectedEdgeId,
}: {
  definition: AgentWorkflowDefinitionV1;
  nodes: WorkflowGraphNodeModel[];
  edges: WorkflowGraphEdgeModel[];
  wizardLevel: WorkflowWizardLevel;
  selectedRoleId?: string;
  selectedNodeId?: string;
  selectedEdgeId?: string;
}): WorkflowGraphFocusContext {
  if (wizardLevel === "landing") {
    return buildRoleLevelGraphContext(definition, nodes, edges);
  }

  if (wizardLevel === "action" && selectedEdgeId) {
    const selectedEdge = edges.find((edge) => edge.id === selectedEdgeId);
    if (selectedEdge) {
      const nodeIds = new Set([selectedEdge.source, selectedEdge.target]);
      return {
        title: `Action ${selectedEdge.label}`,
        description: `${selectedEdge.source} → ${selectedEdge.target}`,
        nodes: nodes.filter((node) => nodeIds.has(node.id)),
        edges: [selectedEdge],
      };
    }
  }

  if (wizardLevel === "state" && selectedNodeId) {
    const selectedNode = nodes.find((node) => node.id === selectedNodeId);
    if (selectedNode) {
      const outgoing = edges.filter((edge) => edge.source === selectedNode.id);
      const nodeIds = new Set([selectedNode.id, ...outgoing.map((edge) => edge.target)]);
      return {
        title: `State ${selectedNode.label}`,
        description: selectedNode.terminal ? "Terminal completion state." : "Selected state and its outgoing actions.",
        nodes: nodes.filter((node) => nodeIds.has(node.id)),
        edges: outgoing,
      };
    }
  }

  if (wizardLevel === "role" && selectedRoleId) {
    const owned = nodes.filter((node) => node.ownerRoleId === selectedRoleId);
    const ownedIds = new Set(owned.map((node) => node.id));
    const roleEdges = edges.filter((edge) => ownedIds.has(edge.source) && ownedIds.has(edge.target));
    return {
      title: `Role ${definition.roles[selectedRoleId]?.label ?? selectedRoleId}`,
      description: owned.length ? "States owned by the selected role." : "No states are assigned to this role yet.",
      nodes: owned,
      edges: roleEdges,
    };
  }

  return buildRoleLevelGraphContext(definition, nodes, edges);
}

function buildRoleLevelGraphContext(
  definition: AgentWorkflowDefinitionV1,
  nodes: WorkflowGraphNodeModel[],
  edges: WorkflowGraphEdgeModel[],
): WorkflowGraphFocusContext {
  const roleNodes: WorkflowGraphNodeModel[] = Object.entries(definition.roles).map(([roleId, role], index) => ({
    id: `role:${roleId}`,
    label: role.label ?? roleId,
    ownerRoleId: roleId,
    ownerLabel: role.label ?? roleId,
    terminal: false,
    initial: index === 0,
    steps: [],
  }));
  const terminalTargets = nodes.filter((node) => node.terminal && edges.some((edge) => edge.target === node.id));
  const terminalNodes: WorkflowGraphNodeModel[] = terminalTargets.map((node) => ({
    ...node,
    id: `terminal:${node.id}`,
  }));
  const terminalIds = new Set(terminalTargets.map((node) => node.id));
  const roleEdges = new Map<string, WorkflowGraphEdgeModel>();
  for (const edge of edges) {
    const source = nodes.find((node) => node.id === edge.source);
    const target = nodes.find((node) => node.id === edge.target);
    const sourceId = source?.ownerRoleId ? `role:${source.ownerRoleId}` : source?.terminal ? `terminal:${source.id}` : null;
    const targetId = target?.ownerRoleId ? `role:${target.ownerRoleId}` : terminalIds.has(edge.target) ? `terminal:${edge.target}` : null;
    if (!sourceId || !targetId || sourceId === targetId) continue;
    const id = `role-edge:${sourceId}:${targetId}`;
    if (roleEdges.has(id)) continue;
    roleEdges.set(id, {
      id,
      source: sourceId,
      target: targetId,
      actionId: "role_transition",
      label: "handoff",
      description: null,
      resultFields: [],
      handoffPrompt: null,
      waitFor: null,
    });
  }
  return {
    title: "Workflow roles",
    description: "Roles and cross-role handoffs.",
    nodes: [...roleNodes, ...terminalNodes],
    edges: [...roleEdges.values()],
  };
}

export function buildWorkflowGraphFocusContext({
  nodes,
  edges,
  selectedRoleId,
  selectedNodeId,
  selectedEdgeId,
}: {
  nodes: WorkflowGraphNodeModel[];
  edges: WorkflowGraphEdgeModel[];
  selectedRoleId?: string;
  selectedNodeId?: string;
  selectedEdgeId?: string;
}): WorkflowGraphFocusContext {
  const selectedEdge = selectedEdgeId
    ? edges.find((edge) => edge.id === selectedEdgeId)
    : null;
  if (selectedEdge) {
    const nodeIds = new Set([selectedEdge.source, selectedEdge.target]);
    return {
      title: `Action ${selectedEdge.label}`,
      description: `${selectedEdge.source} → ${selectedEdge.target}`,
      nodes: nodes.filter((node) => nodeIds.has(node.id)),
      edges: [selectedEdge],
    };
  }

  const selectedNode = selectedNodeId
    ? nodes.find((node) => node.id === selectedNodeId)
    : null;
  if (selectedNode) {
    const connectedEdges = edges.filter(
      (edge) => edge.source === selectedNode.id || edge.target === selectedNode.id,
    );
    const nodeIds = new Set([
      selectedNode.id,
      ...connectedEdges.map((edge) => edge.source),
      ...connectedEdges.map((edge) => edge.target),
    ]);
    return {
      title: `State ${selectedNode.label}`,
      description: selectedNode.terminal
        ? "Terminal completion state."
        : "Selected state with incoming and outgoing transitions.",
      nodes: nodes.filter((node) => nodeIds.has(node.id)),
      edges: connectedEdges,
    };
  }

  if (selectedRoleId) {
    const ownedNodeIds = new Set(
      nodes
        .filter((node) => node.ownerRoleId === selectedRoleId)
        .map((node) => node.id),
    );
    const roleEdges = edges.filter(
      (edge) => ownedNodeIds.has(edge.source) || ownedNodeIds.has(edge.target),
    );
    const visibleNodeIds = new Set([
      ...ownedNodeIds,
      ...roleEdges.map((edge) => edge.source),
      ...roleEdges.map((edge) => edge.target),
    ]);
    return {
      title: `Role ${selectedRoleId}`,
      description: ownedNodeIds.size
        ? "States owned by this role plus directly connected transitions."
        : "No states are assigned to this role yet.",
      nodes: nodes.filter((node) => visibleNodeIds.has(node.id)),
      edges: roleEdges.filter(
        (edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target),
      ),
    };
  }

  return {
    title: "Workflow",
    description: "All states and transitions.",
    nodes,
    edges,
  };
}

export function toFlowNodes(
  nodes: WorkflowGraphNodeModel[],
  edges: WorkflowGraphEdgeModel[] = [],
): Node[] {
  const positions = layoutGraphNodes(nodes, edges);
  return nodes.map((node) => {
    const classes = ["workflow-state-node"];
    if (node.initial) classes.push("workflow-initial-node");
    if (node.terminal) classes.push("workflow-terminal-node");
    return {
      id: node.id,
      position: positions.get(node.id) ?? { x: 0, y: 0 },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      data: {
        label: `${node.initial ? "Start · " : ""}${node.label}${node.terminal ? " · Done" : ""}`,
      },
      className: classes.join(" "),
      style: node.terminal ? terminalNodeStyle : stateNodeStyle,
    };
  });
}

export function toFlowEdges(
  edges: WorkflowGraphEdgeModel[],
  selectedEdgeId?: string,
  nodes: WorkflowGraphNodeModel[] = [],
  onSelect?: (edgeId: string) => void,
): Edge[] {
  const nodePositions = layoutGraphNodes(nodes, edges);
  const pairCounts = new Map<string, number>();
  const pairIndex = new Map<string, number>();
  for (const edge of edges)
    pairCounts.set(
      edgePairKey(edge),
      (pairCounts.get(edgePairKey(edge)) ?? 0) + 1,
    );
  return edges.map((edge) => {
    const loop = edge.source === edge.target;
    const reverse = isReverseEdge(edge, nodePositions);
    const key = edgePairKey(edge);
    const index = pairIndex.get(key) ?? 0;
    pairIndex.set(key, index + 1);
    const total = pairCounts.get(key) ?? 1;
    const labelOffset = (index - (total - 1) / 2) * 36;
    const color = loop ? "#f59e0b" : reverse ? "#a78bfa" : "#38bdf8";
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: "workflowAction",
      animated: loop,
      selected: selectedEdgeId === edge.id,
      className: loop
        ? "workflow-graph-edge workflow-loop-edge"
        : reverse
          ? "workflow-graph-edge workflow-reverse-edge"
          : "workflow-graph-edge",
      style: { stroke: color, strokeWidth: loop ? 2.5 : 2.25 },
      markerEnd: { type: MarkerType.ArrowClosed, color },
      interactionWidth: 28,
      zIndex: selectedEdgeId === edge.id ? 30 : 15,
      data: {
        label: edge.label,
        actionId: edge.actionId,
        waitFor: edge.waitFor,
        labelOffset,
        reverse,
        selfLoop: loop,
        onSelect,
      } satisfies WorkflowActionEdgeData,
    };
  });
}

function WorkflowActionEdge(props: EdgeProps): React.ReactElement {
  const {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    markerEnd,
    style,
    selected,
  } = props;
  const data = props.data as WorkflowActionEdgeData | undefined;
  const label = data?.label ?? id;
  const { path, labelX, labelY } = edgePathWithReadableLabel({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    labelOffset: data?.labelOffset ?? 0,
    selfLoop: data?.selfLoop === true,
    reverse: data?.reverse === true,
  });
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={style}
        interactionWidth={28}
      />
      <EdgeLabelRenderer>
        <div
          className={`workflow-action-edge-label nopan ${selected ? "workflow-action-edge-label--selected" : ""}`}
          role="button"
          tabIndex={0}
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
          }}
          title={label}
          onClick={(event) => {
            event.stopPropagation();
            data?.onSelect?.(id);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              data?.onSelect?.(id);
            }
          }}
        >
          <span className="workflow-action-edge-label__action">{label}</span>
          {data?.waitFor ? (
            <span className="workflow-action-edge-label__id">
              wait · {data.waitFor.provider}
            </span>
          ) : (
            <span className="workflow-action-edge-label__id">
              {data?.actionId}
            </span>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

function edgePathWithReadableLabel({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  labelOffset,
  selfLoop,
  reverse,
}: {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  sourcePosition: Position;
  targetPosition: Position;
  labelOffset: number;
  selfLoop: boolean;
  reverse: boolean;
}): { path: string; labelX: number; labelY: number } {
  if (selfLoop) {
    const loopWidth = 110;
    const loopHeight = 84 + Math.abs(labelOffset);
    return {
      path: `M ${sourceX} ${sourceY} C ${sourceX + loopWidth} ${sourceY - loopHeight}, ${targetX + loopWidth} ${targetY + loopHeight}, ${targetX} ${targetY}`,
      labelX: sourceX + loopWidth + 8,
      labelY: sourceY + labelOffset,
    };
  }
  if (reverse) {
    const midY = Math.max(sourceY, targetY) + 132 + Math.abs(labelOffset);
    return {
      path: `M ${sourceX} ${sourceY} C ${sourceX} ${midY}, ${targetX} ${midY}, ${targetX} ${targetY}`,
      labelX: (sourceX + targetX) / 2,
      labelY: midY + labelOffset,
    };
  }
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    curvature: 0.22,
  });
  return { path, labelX, labelY: labelY - 34 + labelOffset };
}

export function layoutWorkflowGraph(
  nodes: WorkflowGraphNodeModel[],
  edges: WorkflowGraphEdgeModel[],
): Record<string, { x: number; y: number }> {
  return Object.fromEntries(layoutGraphNodes(nodes, edges));
}

function layoutGraphNodes(
  nodes: WorkflowGraphNodeModel[],
  edges: WorkflowGraphEdgeModel[],
): Map<string, { x: number; y: number }> {
  const ranks = computeRanks(nodes, edges);
  const groups = new Map<number, WorkflowGraphNodeModel[]>();
  for (const node of nodes) {
    const rank = ranks.get(node.id) ?? 0;
    groups.set(rank, [...(groups.get(rank) ?? []), node]);
  }
  const positions = new Map<string, { x: number; y: number }>();
  for (const [rank, group] of groups) {
    const ordered = [...group].sort(
      (a, b) =>
        Number(a.terminal) - Number(b.terminal) || a.id.localeCompare(b.id),
    );
    const startY = -((ordered.length - 1) * 180) / 2;
    ordered.forEach((node, index) =>
      positions.set(node.id, { x: rank * 260, y: startY + index * 180 }),
    );
  }
  return positions;
}

function computeRanks(
  nodes: WorkflowGraphNodeModel[],
  edges: WorkflowGraphEdgeModel[],
): Map<string, number> {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const ranks = new Map<string, number>();
  const initial = nodes.find((node) => node.initial)?.id ?? nodes[0]?.id;
  if (!initial) return ranks;
  ranks.set(initial, 0);
  for (let pass = 0; pass < nodes.length + edges.length; pass += 1) {
    let changed = false;
    for (const edge of edges) {
      if (
        !nodeIds.has(edge.source) ||
        !nodeIds.has(edge.target) ||
        edge.source === edge.target
      )
        continue;
      const sourceRank = ranks.get(edge.source);
      if (sourceRank == null || ranks.has(edge.target)) continue;
      ranks.set(edge.target, sourceRank + 1);
      changed = true;
    }
    if (!changed) break;
  }
  nodes.forEach((node, index) => {
    if (!ranks.has(node.id)) ranks.set(node.id, Math.floor(index / 2));
  });
  return ranks;
}

function isReverseEdge(
  edge: WorkflowGraphEdgeModel,
  nodePositions: Map<string, { x: number; y: number }>,
): boolean {
  if (edge.source === edge.target) return false;
  const source = nodePositions.get(edge.source);
  const target = nodePositions.get(edge.target);
  return Boolean(source && target && target.x < source.x);
}

function edgePairKey(edge: WorkflowGraphEdgeModel): string {
  return `${edge.source}->${edge.target}`;
}

function formatEditorRolePreference(
  role: AgentWorkflowDefinitionV1["roles"][string],
): string {
  const preference = role.executorPreference;
  if (!preference?.executorType && !preference?.model) {
    return "Executor/model: workspace default";
  }
  return [
    preference.executorType ? `Executor ${preference.executorType}` : "Default executor",
    preference.model ? `Model ${preference.model}` : "default model",
  ].join(" · ");
}

const stateNodeStyle: React.CSSProperties = {
  background: "#0f172a",
  border: "1px solid #2563eb",
  borderRadius: 12,
  color: "#e2e8f0",
  fontWeight: 700,
  padding: "10px 14px",
  boxShadow: "0 16px 32px rgba(2, 6, 23, 0.32)",
};

const terminalNodeStyle: React.CSSProperties = {
  ...stateNodeStyle,
  background: "#052e2b",
  border: "1px solid #10b981",
  color: "#d1fae5",
};

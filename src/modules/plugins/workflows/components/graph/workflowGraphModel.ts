import type { AgentWorkflowDefinitionV1, AuthoredWorkflowStateV1, WorkflowStepV1 } from '@vibe-dashboard/workflow-core';

export interface WorkflowGraphNodeModel {
  id: string;
  label: string;
  ownerRoleId: string | null;
  ownerLabel: string | null;
  terminal: boolean;
  initial: boolean;
  steps: WorkflowGraphStepSummary[];
}

export interface WorkflowGraphStepSummary {
  id: string;
  type: string;
  turnType?: string;
  promptTemplate?: string;
  promptRefs: string[];
  humanFormTitle?: string;
  humanFormProvider?: string;
}

export interface WorkflowGraphEdgeModel {
  id: string;
  source: string;
  target: string;
  actionId: string;
  label: string;
  description: string | null;
}

export interface WorkflowGraphModel {
  nodes: WorkflowGraphNodeModel[];
  edges: WorkflowGraphEdgeModel[];
}

export interface WorkflowGraphValidationIssue {
  code:
    | 'WORKFLOW_GRAPH_INVALID_TARGET'
    | 'WORKFLOW_GRAPH_UNREACHABLE_STATE'
    | 'WORKFLOW_GRAPH_NO_TERMINAL_PATH'
    | 'WORKFLOW_GRAPH_DECISION_WITHOUT_ACTIONS'
    | 'WORKFLOW_GRAPH_UNSUPPORTED_STEP_TYPE';
  path: string;
  message: string;
}

export interface WorkflowGraphEdit {
  actionLabel?: string;
  targetState?: string;
}

export function workflowDefinitionToGraph(definition: AgentWorkflowDefinitionV1): WorkflowGraphModel {
  const nodes = Object.entries(definition.states).map(([stateId, state]) => {
    const terminal = isTerminalState(state);
    const ownerRoleId = terminal ? null : state.owner;
    const role = ownerRoleId ? definition.roles[ownerRoleId] : undefined;
    return {
      id: stateId,
      label: labelFromId(stateId),
      ownerRoleId,
      ownerLabel: role?.label ?? ownerRoleId,
      terminal,
      initial: stateId === definition.initialState,
      steps: terminal ? [] : state.steps.map(summarizeStep),
    } satisfies WorkflowGraphNodeModel;
  });

  const edges: WorkflowGraphEdgeModel[] = [];
  for (const [stateId, state] of Object.entries(definition.states)) {
    if (isTerminalState(state)) continue;
    for (const [actionId, action] of Object.entries(state.actions)) {
      edges.push({
        id: `${stateId}:${actionId}`,
        source: stateId,
        target: action.targetState,
        actionId,
        label: action.label ?? labelFromId(actionId),
        description: action.description ?? null,
      });
    }
  }
  return { nodes, edges };
}

export function applyWorkflowGraphActionEdit(definition: AgentWorkflowDefinitionV1, edgeId: string, edit: WorkflowGraphEdit): AgentWorkflowDefinitionV1 {
  const [stateId, actionId] = edgeId.split(':');
  if (!stateId || !actionId) return deepClone(definition);
  const next = deepClone(definition);
  const state = next.states[stateId];
  if (!state || isTerminalState(state) || !state.actions[actionId]) return next;
  if (edit.actionLabel !== undefined) state.actions[actionId].label = edit.actionLabel;
  if (edit.targetState !== undefined) state.actions[actionId].targetState = edit.targetState;
  return next;
}

export function validateWorkflowGraph(definition: AgentWorkflowDefinitionV1): WorkflowGraphValidationIssue[] {
  const issues: WorkflowGraphValidationIssue[] = [];
  const stateIds = new Set(Object.keys(definition.states));
  for (const [stateId, state] of Object.entries(definition.states)) {
    if (isTerminalState(state)) continue;
    for (let index = 0; index < state.steps.length; index += 1) {
      const rawStep = state.steps[index] as { type?: unknown };
      if (rawStep.type !== 'agent_turn' && rawStep.type !== 'human_form') {
        issues.push({ code: 'WORKFLOW_GRAPH_UNSUPPORTED_STEP_TYPE', path: `states.${stateId}.steps.${index}.type`, message: `Unsupported step type ${String(rawStep.type)}` });
      }
    }
    const hasDecision = state.steps.some((step) => step.type === 'agent_turn' && step.turnType === 'decision');
    if (hasDecision && Object.keys(state.actions).length === 0) {
      issues.push({ code: 'WORKFLOW_GRAPH_DECISION_WITHOUT_ACTIONS', path: `states.${stateId}.actions`, message: 'Decision states need at least one action.' });
    }
    for (const [actionId, action] of Object.entries(state.actions)) {
      if (!action.targetState || !stateIds.has(action.targetState)) {
        issues.push({ code: 'WORKFLOW_GRAPH_INVALID_TARGET', path: `states.${stateId}.actions.${actionId}.targetState`, message: 'Choose an existing target state.' });
      }
    }
  }

  const reachable = reachableStates(definition, definition.initialState);
  for (const stateId of stateIds) {
    if (!reachable.has(stateId)) {
      issues.push({ code: 'WORKFLOW_GRAPH_UNREACHABLE_STATE', path: `states.${stateId}`, message: 'This state is not reachable from the initial state.' });
    }
  }

  const terminalStates = Object.entries(definition.states).filter(([, state]) => 'terminal' in state && state.terminal === true).map(([stateId]) => stateId);
  for (const stateId of reachable) {
    if (!hasTerminalPath(definition, stateId, new Set(), terminalStates)) {
      issues.push({ code: 'WORKFLOW_GRAPH_NO_TERMINAL_PATH', path: `states.${stateId}`, message: 'This state cannot reach a terminal state.' });
    }
  }

  return issues;
}

function isTerminalState(state: AuthoredWorkflowStateV1): state is { terminal: true } {
  return 'terminal' in state && state.terminal === true;
}

function summarizeStep(step: WorkflowStepV1): WorkflowGraphStepSummary {
  if (step.type === 'agent_turn') {
    return {
      id: step.id,
      type: step.type,
      turnType: step.turnType,
      promptTemplate: step.prompt.template,
      promptRefs: summarizeRefs((step.prompt as { refs?: unknown }).refs),
    };
  }
  return {
    id: step.id,
    type: step.type,
    humanFormTitle: step.title,
    humanFormProvider: step.form.providerType,
    promptRefs: [],
  };
}

function summarizeRefs(refs: unknown): string[] {
  if (!Array.isArray(refs)) return [];
  return refs.map((ref) => {
    if (!ref || typeof ref !== 'object') return null;
    const record = ref as { kind?: unknown; id?: unknown; version?: unknown };
    if (typeof record.id !== 'string') return null;
    return `${typeof record.kind === 'string' ? record.kind : 'asset'}:${record.id}${typeof record.version === 'number' ? `@${record.version}` : ''}`;
  }).filter((value): value is string => Boolean(value));
}

function reachableStates(definition: AgentWorkflowDefinitionV1, start: string): Set<string> {
  const reached = new Set<string>();
  const pending = [start];
  while (pending.length) {
    const stateId = pending.shift()!;
    if (reached.has(stateId)) continue;
    reached.add(stateId);
    const state = definition.states[stateId];
    if (!state || isTerminalState(state)) continue;
    for (const action of Object.values(state.actions)) {
      if (definition.states[action.targetState] && !reached.has(action.targetState)) pending.push(action.targetState);
    }
  }
  return reached;
}

function hasTerminalPath(definition: AgentWorkflowDefinitionV1, stateId: string, visiting: Set<string>, terminalStates: string[]): boolean {
  if (terminalStates.includes(stateId)) return true;
  if (visiting.has(stateId)) return false;
  const state = definition.states[stateId];
  if (!state || isTerminalState(state)) return Boolean(state && isTerminalState(state));
  visiting.add(stateId);
  for (const action of Object.values(state.actions)) {
    if (hasTerminalPath(definition, action.targetState, visiting, terminalStates)) return true;
  }
  visiting.delete(stateId);
  return false;
}

function labelFromId(id: string): string {
  return id.replace(/[_-]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

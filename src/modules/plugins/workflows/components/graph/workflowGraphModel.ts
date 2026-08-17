import { WorkflowDefinitionError, normalizeWorkflowDefinitionV1, type AgentWorkflowDefinitionV1, type AuthoredWorkflowStateV1, type WorkflowStepV1 } from '@vibe-dashboard/workflow-core';

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
  workflowCallMode?: string;
  workflowCallDesignId?: string;
  workflowCallVersion?: number;
  commandProvider?: string;
  commandId?: string;
  commandAccess?: string;
}

export interface WorkflowGraphEdgeModel {
  id: string;
  source: string;
  target: string;
  actionId: string;
  label: string;
  description: string | null;
  resultFields: Array<{ name: string; type: string; required: boolean; multiple: boolean; description: string | null }>;
  handoffPrompt: string | null;
  waitFor: { provider: string; fields: Array<{ label: string; value: string }> } | null;
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
    | 'WORKFLOW_GRAPH_UNSUPPORTED_STEP_TYPE'
    | 'WORKFLOW_GRAPH_CORE_INVALID';
  path: string;
  message: string;
}

export interface WorkflowGraphEdit {
  actionLabel?: string;
  targetState?: string;
  handoffPrompt?: string;
}

export interface WorkflowGraphPromptEdit {
  promptTemplate?: string;
}

export function workflowDefinitionToGraph(definition: AgentWorkflowDefinitionV1): WorkflowGraphModel {
  const nodes = Object.entries(definition.states).map(([stateId, state]) => {
    const terminal = isTerminalState(state);
    const ownerRoleId = terminal ? null : typeof (state as { owner?: unknown }).owner === 'string' ? (state as { owner: string }).owner : null;
    const role = ownerRoleId ? definition.roles[ownerRoleId] : undefined;
    return {
      id: stateId,
      label: labelFromId(stateId),
      ownerRoleId,
      ownerLabel: role?.label ?? ownerRoleId,
      terminal,
      initial: stateId === definition.initialState,
      steps: terminal ? [] : getStateSteps(state).map(summarizeStep),
    } satisfies WorkflowGraphNodeModel;
  });

  const edges: WorkflowGraphEdgeModel[] = [];
  for (const [stateId, state] of Object.entries(definition.states)) {
    if (isTerminalState(state)) continue;
    for (const [actionId, action] of Object.entries(getStateActions(state))) {
      edges.push({
        id: encodeEdgeId(stateId, actionId),
        source: stateId,
        target: action.targetState,
        actionId,
        label: action.label ?? labelFromId(actionId),
        description: action.description ?? null,
        resultFields: summarizeResultFields(action),
        handoffPrompt: summarizePrompt((action as { handoff?: { prompt?: unknown } }).handoff?.prompt),
        waitFor: summarizeWaitFor((action as { waitFor?: unknown }).waitFor),
      });
    }
  }
  return { nodes, edges };
}

export function applyWorkflowGraphActionEdit(definition: AgentWorkflowDefinitionV1, edgeId: string, edit: WorkflowGraphEdit): AgentWorkflowDefinitionV1 {
  const parsedEdge = decodeEdgeId(edgeId);
  if (!parsedEdge) return deepClone(definition);
  const { stateId, actionId } = parsedEdge;
  const next = deepClone(definition);
  const state = next.states[stateId];
  if (!state || isTerminalState(state) || !getStateActions(state)[actionId]) return next;
  if (edit.actionLabel !== undefined) {
    const label = edit.actionLabel.trim();
    getStateActions(state)[actionId]!.label = label || undefined;
  }
  if (edit.targetState !== undefined) getStateActions(state)[actionId]!.targetState = edit.targetState;
  if (edit.handoffPrompt !== undefined) {
    const template = edit.handoffPrompt.trim();
    const action = getStateActions(state)[actionId]!;
    if (template) {
      action.handoff = { ...(action.handoff as object), prompt: { template } };
    } else if (action.handoff && typeof action.handoff === 'object' && !Array.isArray(action.handoff)) {
      const handoff = { ...(action.handoff as Record<string, unknown>) };
      delete handoff.prompt;
      if (Object.keys(handoff).length > 0) action.handoff = handoff;
      else delete action.handoff;
    }
  }
  return next;
}

export function applyWorkflowGraphPromptEdit(definition: AgentWorkflowDefinitionV1, stateId: string, stepId: string, edit: WorkflowGraphPromptEdit): AgentWorkflowDefinitionV1 {
  const next = deepClone(definition);
  const state = next.states[stateId];
  if (!state || isTerminalState(state)) return next;
  const step = getStateSteps(state).find((candidate) => candidate.id === stepId);
  if (!step || step.type !== 'agent_turn') return next;
  if (edit.promptTemplate !== undefined) {
    step.prompt = { ...step.prompt, template: edit.promptTemplate };
  }
  return next;
}

export function validateWorkflowGraph(definition: AgentWorkflowDefinitionV1): WorkflowGraphValidationIssue[] {
  const issues: WorkflowGraphValidationIssue[] = [];
  try {
    normalizeWorkflowDefinitionV1(definitionForCoreValidation(definition), { workflowId: 'graph-editor-validation' });
  } catch (error) {
    if (error instanceof WorkflowDefinitionError) {
      for (const issue of error.issues) {
        issues.push({ code: 'WORKFLOW_GRAPH_CORE_INVALID', path: issue.path, message: issue.message });
      }
    } else {
      throw error;
    }
  }
  const stateIds = new Set(Object.keys(definition.states));
  for (const [stateId, state] of Object.entries(definition.states)) {
    if (isTerminalState(state)) continue;
    const steps = getStateSteps(state);
    const actions = getStateActions(state);
    for (let index = 0; index < steps.length; index += 1) {
      const rawStep = steps[index] as { type?: unknown };
      if (rawStep.type !== 'agent_turn' && rawStep.type !== 'human_form' && rawStep.type !== 'workflow_call' && rawStep.type !== 'command') {
        issues.push({ code: 'WORKFLOW_GRAPH_UNSUPPORTED_STEP_TYPE', path: `states.${stateId}.steps.${index}.type`, message: `Unsupported step type ${String(rawStep.type)}` });
      }
    }
    const hasDecision = steps.some((step) => step.type === 'agent_turn' && step.turnType === 'decision');
    if (hasDecision && Object.keys(actions).length === 0) {
      issues.push({ code: 'WORKFLOW_GRAPH_DECISION_WITHOUT_ACTIONS', path: `states.${stateId}.actions`, message: 'Decision states need at least one action.' });
    }
    for (const [actionId, action] of Object.entries(getStateActions(state))) {
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

function getStateSteps(state: AuthoredWorkflowStateV1): WorkflowStepV1[] {
  const steps = (state as { steps?: unknown }).steps;
  return Array.isArray(steps) ? steps as WorkflowStepV1[] : [];
}

function getStateActions(state: AuthoredWorkflowStateV1): Record<string, { targetState: string; label?: string; description?: string; result?: unknown; handoff?: unknown; waitFor?: unknown }> {
  const actions = (state as { actions?: unknown }).actions;
  return actions && typeof actions === 'object' && !Array.isArray(actions) ? actions as Record<string, { targetState: string; label?: string; description?: string; result?: unknown; handoff?: unknown; waitFor?: unknown }> : {};
}

function isTerminalState(state: AuthoredWorkflowStateV1): state is { terminal: true } {
  return 'terminal' in state && state.terminal === true;
}

function summarizeStep(step: WorkflowStepV1): WorkflowGraphStepSummary {
  const rawStep = step as WorkflowStepV1 & { id?: unknown; type?: unknown; form?: { providerType?: unknown }; title?: unknown; mode?: unknown; workflow?: { designId?: unknown; version?: unknown }; provider?: unknown; command?: unknown; policy?: { access?: unknown } };
  const id = typeof rawStep.id === 'string' ? rawStep.id : 'unknown-step';
  if (step.type === 'agent_turn') {
    return {
      id,
      type: step.type,
      turnType: step.turnType,
      promptTemplate: step.prompt.template,
      promptRefs: summarizeRefs((step.prompt as { refs?: unknown }).refs),
    };
  }
  if (step.type === 'workflow_call') {
    return {
      id,
      type: step.type,
      workflowCallMode: step.mode,
      workflowCallDesignId: step.workflow.designId,
      workflowCallVersion: step.workflow.version,
      promptRefs: [],
    };
  }
  if (step.type === 'command') {
    return {
      id,
      type: step.type,
      commandProvider: step.provider,
      commandId: step.command,
      commandAccess: step.policy?.access ?? 'read',
      promptRefs: [],
    };
  }
  return {
    id,
    type: typeof rawStep.type === 'string' ? rawStep.type : 'unsupported',
    humanFormTitle: typeof rawStep.title === 'string' ? rawStep.title : undefined,
    humanFormProvider: typeof rawStep.form?.providerType === 'string' ? rawStep.form.providerType : undefined,
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

function summarizePrompt(prompt: unknown): string | null {
  if (!prompt || typeof prompt !== 'object') return null;
  const template = (prompt as { template?: unknown }).template;
  return typeof template === 'string' && template.trim() ? template : null;
}

function summarizeResultFields(action: { result?: unknown }): WorkflowGraphEdgeModel['resultFields'] {
  const result = action.result;
  if (!result || typeof result !== 'object' || Array.isArray(result)) return [];
  const fields = (result as { fields?: unknown }).fields;
  const required = new Set(Array.isArray((result as { required?: unknown }).required) ? (result as { required: unknown[] }).required.filter((item): item is string => typeof item === 'string') : []);
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return [];
  return Object.entries(fields).map(([name, rawSpec]) => {
    const spec = rawSpec && typeof rawSpec === 'object' && !Array.isArray(rawSpec) ? rawSpec as { type?: unknown; multiple?: unknown; description?: unknown } : {};
    return {
      name,
      type: typeof spec.type === 'string' ? spec.type : 'unknown',
      required: required.has(name),
      multiple: spec.multiple === true,
      description: typeof spec.description === 'string' ? spec.description : null,
    };
  });
}

function summarizeWaitFor(waitFor: unknown): WorkflowGraphEdgeModel['waitFor'] {
  if (!waitFor || typeof waitFor !== 'object' || Array.isArray(waitFor)) return null;
  const record = waitFor as Record<string, unknown>;
  const provider = typeof record.provider === 'string' ? record.provider : 'unknown';
  const fields = ['runIdField', 'checkRunIdField', 'repoField', 'shaField']
    .filter((key) => typeof record[key] === 'string' && String(record[key]).trim())
    .map((key) => ({ label: labelFromId(key.replace(/Field$/u, '')), value: String(record[key]) }));
  return { provider, fields };
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
    for (const action of Object.values(getStateActions(state))) {
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
  for (const action of Object.values(getStateActions(state))) {
    if (hasTerminalPath(definition, action.targetState, visiting, terminalStates)) return true;
  }
  visiting.delete(stateId);
  return false;
}

function definitionForCoreValidation(definition: AgentWorkflowDefinitionV1): AgentWorkflowDefinitionV1 {
  const clone = deepClone(definition) as AgentWorkflowDefinitionV1 & { states: Record<string, { steps?: Array<{ prompt?: Record<string, unknown> }> }> };
  for (const state of Object.values(clone.states)) {
    const steps = Array.isArray(state.steps) ? state.steps : [];
    for (const step of steps) {
      if (!step.prompt || typeof step.prompt !== 'object') continue;
      const refs = Array.isArray(step.prompt.refs) ? step.prompt.refs : [];
      const template = typeof step.prompt.template === 'string' ? step.prompt.template.trim() : '';
      if (!template && refs.length > 0) {
        step.prompt.template = validationPlaceholderForPromptRefs(refs);
      }
      if ('refs' in step.prompt) delete step.prompt.refs;
    }
  }
  return clone;
}

function validationPlaceholderForPromptRefs(refs: unknown[]): string {
  const labels = summarizeRefs(refs);
  return labels.length ? `Prompt refs: ${labels.join(', ')}` : 'Prompt refs';
}

function encodeEdgeId(stateId: string, actionId: string): string {
  return JSON.stringify([stateId, actionId]);
}

function decodeEdgeId(edgeId: string): { stateId: string; actionId: string } | null {
  try {
    const parsed = JSON.parse(edgeId) as unknown;
    if (Array.isArray(parsed) && typeof parsed[0] === 'string' && typeof parsed[1] === 'string') {
      return { stateId: parsed[0], actionId: parsed[1] };
    }
  } catch {
    const separator = edgeId.indexOf(':');
    if (separator > 0) return { stateId: edgeId.slice(0, separator), actionId: edgeId.slice(separator + 1) };
  }
  return null;
}

function labelFromId(id: string): string {
  return id.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

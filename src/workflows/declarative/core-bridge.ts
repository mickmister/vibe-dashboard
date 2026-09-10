import {
  advanceWorkflow,
  createInitialWorkflowSnapshot,
  normalizeWorkflowDefinitionV1,
  planNextWorkflowEffect,
  type AgentWorkflowDefinitionV1,
  type AgentWorkflowStepV1,
  type WorkflowRuntimeSnapshot,
} from '@vibe-dashboard/workflow-core';
import type {
  DeclarativeWorkflowDefinition,
  DeclarativeWaitForNextCompletedResponseStep,
} from './definitions';

const CORE_BRIDGE_SCHEMA_VERSION = 1;
const SOURCE_STATE = 'source';
const REVIEW_STATE = 'review';
const DONE_STATE = 'done';
const SOURCE_COMPLETED_ACTION = 'source_completed';
const REVIEW_COMPLETED_ACTION = 'review_completed';

export interface DeclarativeWorkflowCoreStateEnvelope {
  workflowCoreBridge?: {
    schemaVersion: typeof CORE_BRIDGE_SCHEMA_VERSION;
    kind: 'declarative_two_agent_review_round';
  };
  workflowCoreSnapshot?: WorkflowRuntimeSnapshot;
}

export function createInitialDeclarativeWorkflowCoreSnapshot(args: {
  definition: DeclarativeWorkflowDefinition;
  instanceId: string;
  inputs: Record<string, unknown>;
  sourceWaitStep: DeclarativeWaitForNextCompletedResponseStep;
  reviewWaitStep: DeclarativeWaitForNextCompletedResponseStep;
  sourceTriggerId: string;
  now: () => number;
  createId: () => string;
}): WorkflowRuntimeSnapshot {
  const model = createDeclarativeWorkflowCoreModel(args.definition, args.sourceWaitStep, args.reviewWaitStep);
  const initial = createInitialWorkflowSnapshot(model, {
    instanceId: args.instanceId,
    inputs: args.inputs,
    now: args.now,
    createId: args.createId,
  });
  return planNextWorkflowEffect(model, initial, {
    now: args.now,
    createId: () => args.sourceTriggerId,
  }).snapshot;
}

export function advanceDeclarativeWorkflowCoreSnapshot(args: {
  definition: DeclarativeWorkflowDefinition;
  snapshot: WorkflowRuntimeSnapshot | undefined;
  completedWaitStepId: string;
  completedTriggerId: string;
  responseRef: string;
  sourceWaitStep: DeclarativeWaitForNextCompletedResponseStep;
  reviewWaitStep: DeclarativeWaitForNextCompletedResponseStep;
  nextTriggerId?: string;
  now: () => number;
  createId: () => string;
}): WorkflowRuntimeSnapshot | undefined {
  if (!args.snapshot) return undefined;
  if (args.snapshot.status !== 'running') return args.snapshot;
  if (args.snapshot.waitingFor?.stepId !== args.completedWaitStepId) return args.snapshot;

  const model = createDeclarativeWorkflowCoreModel(args.definition, args.sourceWaitStep, args.reviewWaitStep);
  const action = args.completedWaitStepId === args.sourceWaitStep.id
    ? SOURCE_COMPLETED_ACTION
    : args.completedWaitStepId === args.reviewWaitStep.id
      ? REVIEW_COMPLETED_ACTION
      : null;
  if (!action) return args.snapshot;

  const createIds = args.nextTriggerId
    ? sequenceIds(args.createId(), args.nextTriggerId, args.createId)
    : args.createId;
  return advanceWorkflow(
    model,
    args.snapshot,
    {
      kind: 'agent_turn_completed',
      turnId: args.completedTriggerId,
      responseRef: args.responseRef,
      finalResponseText: '',
    },
    {
      now: args.now,
      createId: createIds,
      validator: {
        validate: () => ({ valid: true, action, parsed: {} }),
      },
    },
  ).snapshot;
}

export function withDeclarativeWorkflowCoreState<T extends Record<string, unknown>>(
  state: T,
  snapshot: WorkflowRuntimeSnapshot | undefined,
): T & DeclarativeWorkflowCoreStateEnvelope {
  if (!snapshot) return state as T & DeclarativeWorkflowCoreStateEnvelope;
  return {
    ...state,
    workflowCoreBridge: {
      schemaVersion: CORE_BRIDGE_SCHEMA_VERSION,
      kind: 'declarative_two_agent_review_round',
    },
    workflowCoreSnapshot: snapshot,
  };
}

export function readDeclarativeWorkflowCoreSnapshot(state: unknown): WorkflowRuntimeSnapshot | undefined {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return undefined;
  const snapshot = (state as { workflowCoreSnapshot?: unknown }).workflowCoreSnapshot;
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return undefined;
  return snapshot as WorkflowRuntimeSnapshot;
}

function createDeclarativeWorkflowCoreModel(
  definition: DeclarativeWorkflowDefinition,
  sourceWaitStep: DeclarativeWaitForNextCompletedResponseStep,
  reviewWaitStep: DeclarativeWaitForNextCompletedResponseStep,
) {
  const workflow: AgentWorkflowDefinitionV1 = {
    schemaVersion: 1,
    name: definition.name,
    description: definition.description ?? undefined,
    inputs: Object.fromEntries(
      Object.entries(definition.inputs).map(([key, spec]) => [
        key,
        { type: 'string', required: spec.required, description: spec.description ?? undefined },
      ]),
    ),
    roles: {
      source: { label: 'Source' },
      review: { label: 'Review' },
    },
    initialState: SOURCE_STATE,
    states: {
      [SOURCE_STATE]: {
        owner: 'source',
        steps: [agentDecisionStep(sourceWaitStep.id)],
        actions: {
          [SOURCE_COMPLETED_ACTION]: { targetState: REVIEW_STATE },
        },
      },
      [REVIEW_STATE]: {
        owner: 'review',
        steps: [agentDecisionStep(reviewWaitStep.id)],
        actions: {
          [REVIEW_COMPLETED_ACTION]: { targetState: DONE_STATE },
        },
      },
      [DONE_STATE]: { terminal: true },
    },
  };
  return normalizeWorkflowDefinitionV1(workflow, { workflowId: definition.id });
}

function agentDecisionStep(stepId: string): AgentWorkflowStepV1 {
  return {
    id: stepId,
    type: 'agent_turn',
    turnType: 'decision',
    prompt: { template: '' },
    response: {
      format: 'xml',
      schema: { format: 'xsd', source: 'state_actions' },
      invalidXmlRetry: {
        maxAttempts: 0,
        prompt: 'engine_default_with_validation_errors',
        onExhausted: 'blocked',
      },
      storeRawXml: false,
      storeParsedFields: true,
      unknownFields: 'reject_unless_allowed_by_result_contract',
    },
  };
}

function sequenceIds(first: string, second: string, fallback: () => string): () => string {
  const ids = [first, second];
  return () => ids.shift() ?? fallback();
}

import type { DeclarativeWorkflowDefinition } from '../workflows/declarative/definitions';

export interface DeclarativeWorkflowDefinitionEntry {
  source: 'built_in' | 'db';
  definitionId: string;
  version: number;
  status: 'active' | 'disabled';
  name: string;
  description: string | null;
  trigger: string;
  definition: DeclarativeWorkflowDefinition;
}

export interface DeclarativeWorkflowDefinitionsResponse {
  definitions: DeclarativeWorkflowDefinitionEntry[];
}

export type WorkflowInstanceStatus = 'created' | 'running' | 'waiting' | 'paused' | 'completed' | 'failed' | 'cancelled';
export type WorkflowStepStateStatus = 'pending' | 'running' | 'waiting' | 'blocked' | 'completed' | 'failed' | 'cancelled';
export type WorkflowScopedTriggerStatus = 'active' | 'satisfied' | 'expired' | 'cancelled';

export interface WorkflowInstanceReadModel {
  instanceId: string;
  workflowId: string;
  status: WorkflowInstanceStatus;
  trigger: string;
  input: unknown;
  state: Record<string, unknown>;
  currentStepId: string | null;
  error: unknown | null;
  createdAt: number;
  updatedAt: number;
}

export interface WorkflowStepStateReadModel {
  id: string;
  instanceId: string;
  stepKey: string;
  status: WorkflowStepStateStatus;
  attemptCount: number;
  blockedReason: string | null;
  waitingTriggerId: string | null;
  input: unknown | null;
  output: unknown | null;
  error: unknown | null;
  startedAt: number | null;
  completedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface WorkflowScopedTriggerReadModel {
  triggerId: string;
  instanceId: string;
  stepStateId: string | null;
  stepKey: string | null;
  type: string;
  status: WorkflowScopedTriggerStatus;
  roleId: string | null;
  laneId: string | null;
  workspaceId: string | null;
  sessionId: string | null;
  mode: string;
  cursorCompletedAt: number | null;
  cursorExecutionProcessId: string | null;
  sourceExecutionProcessId: string | null;
  expectedQueueItemId: string | null;
  timeoutAt: number | null;
  satisfiedByExecutionProcessId: string | null;
  satisfiedBy: unknown | null;
  createdAt: number;
  updatedAt: number;
  satisfiedAt: number | null;
  expiredAt: number | null;
  cancelledAt: number | null;
}

export interface WorkflowInstanceStatusResponse {
  instance: WorkflowInstanceReadModel;
  steps: WorkflowStepStateReadModel[];
  triggers: WorkflowScopedTriggerReadModel[];
  output: unknown | null;
}

export interface DeclarativeWorkflowRunResult {
  instance: WorkflowInstanceReadModel;
  steps: WorkflowStepStateReadModel[];
  trigger: WorkflowScopedTriggerReadModel;
  resolvedRoles: Record<string, unknown>;
  queuedSource: { stepId: string; roleKey: string; sessionId: string; workspaceId: string; queueItemId: string; queuedCount: number };
  cursor: { executionProcessId: string | null; completedAt: string | null };
}

export interface DeclarativeWorkflowRunResponse {
  result: DeclarativeWorkflowRunResult;
}

export interface WorkflowWebhookProvisioningStatus {
  state: {
    stateKey: string;
    secretSet: boolean;
    vkSubscriptionId: string | null;
    upsertKey: string;
    targetUrl: string;
    status: 'pending' | 'provisioned' | 'retrying' | 'failed';
    attemptCount: number;
    lastAttemptAt: number | null;
    lastSuccessAt: number | null;
    lastError: unknown;
    createdAt: number;
    updatedAt: number;
  } | null;
}

export interface WorkflowWebhookInboxListResponse {
  events: Array<{ inboxId: string; eventType: string; eventStatus: string | null; executionProcessId: string | null; status: string; receivedAt: number; processedAt: number | null; error: unknown }>;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export class DeclarativeWorkflowRequestError extends Error {
  readonly status: number;
  readonly payload: unknown;

  constructor(message: string, args: { status: number; payload: unknown }) {
    super(message);
    this.name = 'DeclarativeWorkflowRequestError';
    this.status = args.status;
    this.payload = args.payload;
  }
}

export async function fetchDeclarativeWorkflowDefinitions(): Promise<DeclarativeWorkflowDefinitionsResponse> {
  const payload = await requestJson<unknown>('/dashboard/api/declarative-workflow-definitions', { errorPrefix: 'Failed to load workflow definitions' });
  if (!isRecord(payload) || !Array.isArray(payload.definitions)) {
    throw new DeclarativeWorkflowRequestError('Failed to load workflow definitions: expected JSON object with definitions array from /dashboard/api/declarative-workflow-definitions', { status: 200, payload });
  }
  return payload as unknown as DeclarativeWorkflowDefinitionsResponse;
}

export async function runDeclarativeWorkflow(workflowId: string, body: { input: Record<string, unknown>; team: unknown; trigger?: string; teamId?: string | null }): Promise<DeclarativeWorkflowRunResponse> {
  return requestJson(`/dashboard/api/declarative-workflows/${encodeURIComponent(workflowId)}/run`, {
    method: 'POST',
    body: JSON.stringify(body),
    errorPrefix: `Failed to launch workflow ${workflowId}`,
  });
}

export async function fetchWorkflowInstanceStatus(instanceId: string): Promise<WorkflowInstanceStatusResponse> {
  return requestJson(`/dashboard/api/workflow-instances/${encodeURIComponent(instanceId)}/status`, { errorPrefix: 'Failed to load workflow instance status' });
}

export async function fetchWorkflowWebhookProvisioningStatus(): Promise<WorkflowWebhookProvisioningStatus> {
  return requestJson('/dashboard/api/workflow-webhooks/provisioning', { errorPrefix: 'Failed to load workflow webhook provisioning status' });
}

export async function fetchWorkflowWebhookInbox(args: { limit?: number } = {}): Promise<WorkflowWebhookInboxListResponse> {
  const params = new URLSearchParams();
  if (args.limit) params.set('limit', String(args.limit));
  const query = params.toString();
  return requestJson(`/dashboard/api/workflow-webhooks/inbox${query ? `?${query}` : ''}`, { errorPrefix: 'Failed to load workflow webhook inbox' });
}

async function requestJson<T>(path: string, options: RequestInit & { errorPrefix: string }): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  let payload: ({ error?: string; message?: string } & Record<string, unknown>) | unknown;
  try {
    payload = await response.json();
  } catch (error) {
    throw new DeclarativeWorkflowRequestError(`${options.errorPrefix}: expected JSON from ${path} but received non-JSON response`, { status: response.status, payload: { parseError: error instanceof Error ? error.message : String(error) } });
  }
  if (!response.ok) {
    const record = isRecord(payload) ? payload : {};
    const detail = typeof record.message === 'string' ? record.message : typeof record.error === 'string' ? record.error : `${response.status}`;
    throw new DeclarativeWorkflowRequestError(`${options.errorPrefix}: ${detail}`, { status: response.status, payload });
  }
  return payload as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

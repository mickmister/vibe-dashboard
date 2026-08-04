import type { WorkflowRunReadModel } from './workflowRunsApi';

export interface WorkflowQueueRef {
  label: string;
  agentId?: string | null;
  displayName?: string | null;
  role?: string | null;
  workspaceId: string | null;
  sessionId: string | null;
  queueItemId: string | null;
  status: 'queued' | 'running' | 'failed' | 'cancelled' | 'unknown';
}

export function workflowStatusLabel(status: WorkflowRunReadModel['status']): string {
  switch (status) {
    case 'completed': return 'Completed';
    case 'failed': return 'Failed';
    case 'running': return 'Running';
    default: return String(status);
  }
}

export function summarizeWorkflowError(error: unknown): string | null {
  if (error == null) return null;
  if (typeof error === 'string') return error;
  if (typeof error !== 'object') return String(error);
  const record = error as Record<string, unknown>;
  const message = firstString(record.message, record.error, record.reason, record.code);
  if (message) return message;
  try {
    return JSON.stringify(error);
  } catch {
    return 'Workflow failed with an unreadable error object.';
  }
}

export function collectWorkflowQueueRefs(run: WorkflowRunReadModel | null | undefined): WorkflowQueueRef[] {
  if (!run) return [];
  const refs: WorkflowQueueRef[] = [];
  if (run.vkQueueItemId || run.vkSessionId || run.vkWorkspaceId) {
    refs.push({
      label: 'Primary workflow ref',
      workspaceId: run.vkWorkspaceId,
      sessionId: run.vkSessionId,
      queueItemId: run.vkQueueItemId,
      status: run.status === 'failed' ? 'failed' : run.status === 'running' ? 'running' : run.vkQueueItemId ? 'queued' : 'unknown',
    });
  }
  const output = run.output;
  if (!output || typeof output !== 'object') return refs;
  const record = output as Record<string, unknown>;
  for (const entry of asArray(record.queuedAgents)) {
    const item = asRecord(entry);
    if (!item) continue;
    refs.push({
      label: 'Queued agent',
      agentId: asString(item.agentId),
      displayName: asString(item.displayName),
      role: asString(item.role),
      workspaceId: asString(item.workspaceId) ?? run.vkWorkspaceId,
      sessionId: asString(item.sessionId),
      queueItemId: asString(item.queueItemId),
      status: 'queued',
    });
  }
  for (const entry of asArray(record.nudges)) {
    const item = asRecord(entry);
    if (!item) continue;
    refs.push({
      label: 'Guardrail nudge',
      agentId: asString(item.agentId),
      displayName: asString(item.displayName),
      role: asString(item.role),
      workspaceId: asString(item.workspaceId) ?? run.vkWorkspaceId,
      sessionId: asString(item.sessionId),
      queueItemId: asString(item.queueItemId),
      status: 'queued',
    });
  }
  return dedupeRefs(refs);
}

function dedupeRefs(refs: WorkflowQueueRef[]): WorkflowQueueRef[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = `${ref.label}:${ref.workspaceId ?? ''}:${ref.sessionId ?? ''}:${ref.queueItemId ?? ''}:${ref.agentId ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

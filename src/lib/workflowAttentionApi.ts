export type WorkflowAttentionItemStatus = 'active' | 'resolved' | 'cancelled';
export type WorkflowAttentionItemKind = 'human_turn';

export interface WorkflowAttentionItemReadModel {
  attentionItemId: string;
  instanceId: string;
  stepStateId: string | null;
  workflowId: string;
  teamId: string | null;
  laneId: string | null;
  status: WorkflowAttentionItemStatus;
  kind: WorkflowAttentionItemKind;
  title: string;
  description: string | null;
  stateId: string | null;
  stepId: string;
  stateVisitId: string;
  idempotencyKey: string;
  presentationUrl: string | null;
  formRef: string | null;
  formSchema: unknown | null;
  resolution: unknown | null;
  createdAt: number;
  updatedAt: number;
  resolvedAt: number | null;
  cancelledAt: number | null;
}

export interface WorkflowAttentionListResponse {
  items: WorkflowAttentionItemReadModel[];
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface CompleteWorkflowAttentionResult {
  applied: boolean;
  reason: 'applied' | 'attention_not_active' | 'instance_not_waiting' | 'stale_state_visit' | 'invalid_submission';
  attention: WorkflowAttentionItemReadModel;
  instance: unknown | null;
  step: unknown | null;
  validationErrors: Array<{ path: string; message: string }>;
}

export async function fetchWorkflowAttentionItems(args: {
  status?: WorkflowAttentionItemStatus;
  teamId?: string;
  laneId?: string;
  instanceId?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<WorkflowAttentionListResponse> {
  const params = new URLSearchParams();
  if (args.status) params.set('status', args.status);
  if (args.teamId) params.set('teamId', args.teamId);
  if (args.laneId) params.set('laneId', args.laneId);
  if (args.instanceId) params.set('instanceId', args.instanceId);
  if (args.limit) params.set('limit', String(args.limit));
  if (args.offset) params.set('offset', String(args.offset));
  const query = params.toString();
  const response = await fetch(`/dashboard/api/workflow-attention-items${query ? `?${query}` : ''}`, { headers: { Accept: 'application/json' } });
  const payload = await response.json().catch(() => ({})) as WorkflowAttentionListResponse & { error?: string };
  if (!response.ok) throw new Error(payload.error || `Failed to load workflow attention items: ${response.status}`);
  return payload;
}

export async function completeWorkflowAttentionItem(
  attentionItemId: string,
  args: { stateVisitId?: string | null; submission: unknown },
): Promise<CompleteWorkflowAttentionResult> {
  const response = await fetch(`/dashboard/api/workflow-attention-items/${encodeURIComponent(attentionItemId)}/complete`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const payload = await response.json().catch(() => ({})) as { result?: CompleteWorkflowAttentionResult; error?: string };
  if (payload.result) return payload.result;
  throw new Error(payload.error || `Failed to complete workflow attention item: ${response.status}`);
}

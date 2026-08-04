import { createHash, randomUUID } from 'node:crypto';
import type { QueueFollowUpResponse, QueueFollowUpSource, AgentResponse, Session } from './vk-client';
import type { DbResponsePipeStore, ResponsePipeDeliveryReadModel } from './response-pipe-store';

export interface ResponsePipeVkClient {
  getExecutionProcessFinalMessage(processId: string): Promise<AgentResponse>;
  getSession(sessionId: string): Promise<Session>;
  queueFollowUp(sessionId: string, prompt: string, options?: { source?: QueueFollowUpSource }): Promise<QueueFollowUpResponse>;
}

export interface ResponsePipeTemplateRef {
  templateId: string;
  templateVersion?: number | null;
  body: string;
}

export interface ResponsePipeTargetInput {
  workspaceId: string;
  sessionId: string;
  roleId?: string | null;
  laneId?: string | null;
}

export interface PipeResponseInput {
  sourceExecutionProcessId: string;
  template: ResponsePipeTemplateRef;
  targets: ResponsePipeTargetInput[];
  workflowInstanceId?: string | null;
  workflowRunId?: string | null;
  triggerId?: string | null;
  collectionId?: string | null;
  sourceRoleId?: string | null;
  sourceLaneId?: string | null;
  allowCrossWorkspace?: boolean;
  allowTruncatedSource?: boolean;
  queueSource?: QueueFollowUpSource;
  metadata?: Record<string, unknown> | null;
}

export interface PipeResponseDeliveryResult {
  delivery: ResponsePipeDeliveryReadModel;
  queued: boolean;
  duplicate: boolean;
}

export interface PipeResponseResult {
  source: AgentResponse;
  templateHash: string;
  deliveries: PipeResponseDeliveryResult[];
}

export class ResponsePipeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResponsePipeValidationError';
  }
}

/**
 * Manual/session response-pipe backend primitive for M04.
 *
 * It reads an exact VK final response, preflights all targets before any queue
 * side effects, records refs/hashes only, and queues via VK's guarded /queue
 * path. Durable rendered prompt text is intentionally not stored.
 */
export class ResponsePipeService {
  constructor(
    private readonly options: {
      store: DbResponsePipeStore;
      vk: ResponsePipeVkClient;
      now?: () => number;
      createId?: () => string;
    },
  ) {}

  async pipeResponse(input: PipeResponseInput): Promise<PipeResponseResult> {
    const source = await this.options.vk.getExecutionProcessFinalMessage(input.sourceExecutionProcessId);
    const sourceWorkspaceId = source.workspace_id;
    const sourceSessionId = source.session_id;
    validateSource(source, input);
    validateTemplate(input.template);
    if (input.targets.length === 0) throw new ResponsePipeValidationError('At least one response pipe target is required');

    const targetSessions = await Promise.all(input.targets.map((target) => this.options.vk.getSession(target.sessionId)));
    const renderedPlans = input.targets.map((target, index) => {
      const targetSession = targetSessions[index];
      if (!targetSession) throw new ResponsePipeValidationError(`Target session ${target.sessionId} lookup failed`);
      if (targetSession.id !== target.sessionId) {
        throw new ResponsePipeValidationError(`Target session ${target.sessionId} lookup returned ${targetSession.id}`);
      }
      if (targetSession.workspace_id !== target.workspaceId) {
        throw new ResponsePipeValidationError(`Target session ${target.sessionId} is in workspace ${targetSession.workspace_id}, not ${target.workspaceId}`);
      }
      if (target.sessionId === sourceSessionId) {
        throw new ResponsePipeValidationError('Response piping to the same session is not allowed');
      }
      if (target.workspaceId !== sourceWorkspaceId && !input.allowCrossWorkspace) {
        throw new ResponsePipeValidationError('Cross-workspace response piping requires allowCrossWorkspace');
      }
      const prompt = renderTemplate(input.template.body, source, target);
      if (prompt.trim().length === 0) throw new ResponsePipeValidationError('Rendered response pipe prompt is empty');
      return { target, prompt };
    });

    const templateHash = sha256(input.template.body);
    const deliveries: PipeResponseDeliveryResult[] = [];
    for (const plan of renderedPlans) {
      const dedupeKey = buildDedupeKey({
        workflowInstanceId: input.workflowInstanceId ?? null,
        triggerId: input.triggerId ?? null,
        sourceExecutionProcessId: source.execution_process_id,
        targetSessionId: plan.target.sessionId,
        templateHash,
      });
      const planned = await this.options.store.planDelivery({
        deliveryId: this.createId(),
        collectionId: input.collectionId ?? null,
        workflowInstanceId: input.workflowInstanceId ?? null,
        workflowRunId: input.workflowRunId ?? null,
        triggerId: input.triggerId ?? null,
        sourceWorkspaceId,
        sourceSessionId,
        sourceExecutionProcessId: source.execution_process_id,
        sourceCompletedAt: source.completed_at == null ? null : new Date(source.completed_at).getTime(),
        sourceRoleId: input.sourceRoleId ?? null,
        sourceLaneId: input.sourceLaneId ?? null,
        targetWorkspaceId: plan.target.workspaceId,
        targetSessionId: plan.target.sessionId,
        targetRoleId: plan.target.roleId ?? null,
        targetLaneId: plan.target.laneId ?? null,
        templateId: input.template.templateId,
        templateVersion: input.template.templateVersion ?? null,
        templateHash,
        dedupeKey,
        metadata: input.metadata ?? null,
      });

      if (!planned.created) {
        deliveries.push({ delivery: planned.delivery, queued: false, duplicate: true });
        continue;
      }

      const rendered = await this.options.store.markDeliveryRendered(planned.delivery.deliveryId, {
        promptHash: sha256(plan.prompt),
        promptLength: plan.prompt.length,
      });
      const queue = await this.options.vk.queueFollowUp(plan.target.sessionId, plan.prompt, {
        source: input.queueSource ?? 'workflow',
      });
      const queued = await this.options.store.markDeliveryQueued(rendered.deliveryId, {
        queueItemId: queue.queued_item.id,
      });
      deliveries.push({ delivery: queued, queued: true, duplicate: false });
    }

    return { source, templateHash, deliveries };
  }

  private createId(): string {
    return this.options.createId?.() ?? randomUUID();
  }
}

function validateSource(source: AgentResponse, input: PipeResponseInput): void {
  if (source.execution_process_id !== input.sourceExecutionProcessId) {
    throw new ResponsePipeValidationError(`Source response execution mismatch: expected ${input.sourceExecutionProcessId}, got ${source.execution_process_id}`);
  }
  if (source.status !== 'completed') throw new ResponsePipeValidationError(`Source execution ${source.execution_process_id} is not completed`);
  if (source.truncated && !input.allowTruncatedSource) {
    throw new ResponsePipeValidationError('Source response is truncated and cannot be piped by default');
  }
  if (!source.content) throw new ResponsePipeValidationError('Source response has no content to pipe');
}

function validateTemplate(template: ResponsePipeTemplateRef): void {
  if (!template.templateId.trim()) throw new ResponsePipeValidationError('Response pipe template id is required');
  if (!template.body.includes('{{source_response}}')) {
    throw new ResponsePipeValidationError('Response pipe template must include {{source_response}}');
  }
}

function renderTemplate(template: string, source: AgentResponse, target: ResponsePipeTargetInput): string {
  const variables: Record<string, string> = {
    source_response: source.content ?? '',
    source_session: source.session_id,
    source_workspace: source.workspace_id,
    source_execution_process_id: source.execution_process_id,
    target_session: target.sessionId,
    target_workspace: target.workspaceId,
  };
  return template.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_match, name: string) => variables[name] ?? '');
}

function buildDedupeKey(args: {
  workflowInstanceId: string | null;
  triggerId: string | null;
  sourceExecutionProcessId: string;
  targetSessionId: string;
  templateHash: string;
}): string {
  return sha256(JSON.stringify(args));
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

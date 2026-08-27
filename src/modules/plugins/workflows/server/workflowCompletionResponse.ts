import type { PersistedWorkflowRunReadModel } from './persistedWorkflowRuntime';
import { scrubProductText } from '../extensions/workflowNotifications';

export interface WorkflowCompletionResponseTarget {
  sessionId: string;
  source: 'vibe-agent-cli' | 'workflow-api';
}

export interface WorkflowCompletionResponseProvider {
  providerType: string;
  isEnabled(): boolean;
  deliver(input: WorkflowCompletionResponseInput): Promise<{ deliveredRef?: string; skippedReason?: string }>;
}

export interface WorkflowCompletionResponseInput {
  target: WorkflowCompletionResponseTarget;
  run: PersistedWorkflowRunReadModel;
  runUrl: string;
}

export interface WorkflowCompletionResponseQueueClient {
  queueFollowUp(
    sessionId: string,
    prompt: string,
    options?: {
      source?: 'workflow';
      provenance?: { kind: 'workflow'; label: string; [key: string]: unknown };
    },
  ): Promise<{ queued_item?: { id?: string } }>;
}

export class VkWorkflowCompletionResponseProvider implements WorkflowCompletionResponseProvider {
  readonly providerType = 'vk_workflow_completion_response';

  constructor(private readonly client: WorkflowCompletionResponseQueueClient) {}

  isEnabled(): boolean {
    return typeof this.client.queueFollowUp === 'function';
  }

  async deliver(input: WorkflowCompletionResponseInput): Promise<{ deliveredRef?: string; skippedReason?: string }> {
    if (!this.isEnabled()) return { skippedReason: 'completion_response_unavailable' };
    const message = buildWorkflowCompletionResponseMessage(input);
    const queued = await this.client.queueFollowUp(input.target.sessionId, message, {
      source: 'workflow',
      provenance: {
        kind: 'workflow',
        label: 'Workflow completion response',
        workflow_run_id: input.run.runId,
        workflow_name: input.run.coreModel.name,
        workflow_design_id: input.run.designId,
        workflow_version: input.run.designVersion,
      },
    });
    return { deliveredRef: queued.queued_item?.id ? `vk:${queued.queued_item.id}` : undefined };
  }
}

export function getWorkflowCompletionResponseTarget(inputs: Record<string, unknown>): WorkflowCompletionResponseTarget | null {
  const workflowContext = asRecord(inputs.workflowContext);
  const response = asRecord(workflowContext?.completionResponse) ?? asRecord(inputs.completionResponse);
  const sessionId = typeof response?.sessionId === 'string' ? response.sessionId.trim() : '';
  if (!sessionId) return null;
  const source = response?.source === 'workflow-api' ? 'workflow-api' : 'vibe-agent-cli';
  return { sessionId: scrubIdentifier(sessionId, 160), source };
}

export function withWorkflowCompletionResponseInput(
  inputs: Record<string, unknown>,
  target?: WorkflowCompletionResponseTarget | null,
): Record<string, unknown> {
  if (!target?.sessionId) return inputs;
  const existingContext = asRecord(inputs.workflowContext) ?? {};
  return {
    ...inputs,
    workflowContext: {
      ...existingContext,
      completionResponse: {
        sessionId: target.sessionId,
        source: target.source,
      },
    },
  };
}

export function buildWorkflowCompletionResponseMessage(input: WorkflowCompletionResponseInput): string {
  const run = input.run;
  const status = run.status;
  const workflowName = scrubProductText(run.coreModel.name || 'Workflow', 120);
  const title = status === 'completed' ? `${workflowName} completed` : `${workflowName} needs attention`;
  const result = terminalResultText(run);
  const lines = [
    title,
    '',
    `Status: ${scrubProductText(status, 80)}`,
    `Workflow: ${workflowName} v${run.designVersion}`,
    `Run: ${scrubProductText(run.runId, 160)}`,
    result ? `Result: ${result}` : null,
    `Open: ${scrubProductText(input.runUrl, 300)}`,
    '',
    'This response was sent by workflow coordination after the detached workflow finished.',
  ].filter((line): line is string => Boolean(line));
  return lines.join('\n');
}

function terminalResultText(run: PersistedWorkflowRunReadModel): string | null {
  if (run.coreSnapshot.blockedReason?.message) {
    return scrubProductText(run.coreSnapshot.blockedReason.message, 400);
  }
  const transition = run.coreSnapshot.latestTransition;
  if (transition?.action) return scrubProductText(`Finished after ${labelFromId(transition.action)}.`, 240);
  if (run.status === 'completed') return 'Workflow completed.';
  return null;
}

function labelFromId(id: string): string {
  return id.replace(/[_-]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function scrubIdentifier(value: string, maxChars: number): string {
  const cleaned = value.replace(/[^A-Za-z0-9:._-]/g, '-').slice(0, maxChars);
  return cleaned || 'session';
}

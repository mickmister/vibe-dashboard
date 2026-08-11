import type { AgentResponse, VibeKanbanServerClient } from './vk-client';
import type {
  DbWorkflowOrchestrationStore,
  WorkflowAttentionItemReadModel,
  WorkflowStepStateReadModel,
} from './workflow-orchestration-store';

export interface WorkflowPresentationModel {
  instanceId: string;
  workflowId: string;
  workflowName: string;
  status: 'created' | 'running' | 'waiting' | 'paused' | 'completed' | 'failed' | 'cancelled';
  humanStatus: 'not_needed' | 'waiting_for_user' | 'resolved' | 'cancelled';
  originalTask: string | null;
  startedAt: number;
  updatedAt: number;
  completedAt: number | null;
  timeline: WorkflowPresentationTimelineItem[];
  attention: WorkflowPresentationAttention | null;
}

export interface WorkflowPresentationTimelineItem {
  id: string;
  role: 'Implementer' | 'Reviewer' | 'User';
  title: string;
  status: string;
  session: { label: string; workspaceId: string | null; sessionId: string | null } | null;
  initialMessage: PresentationText | null;
  finalResponse: PresentationText | null;
  responseUnavailable: string | null;
  commits: PresentationCommitRange[];
}

export interface PresentationText {
  text: string;
  truncated: boolean;
  maxChars: number | null;
}

export interface PresentationCommitRange {
  before: string | null;
  after: string | null;
  merge: string | null;
}

export interface WorkflowPresentationAttention {
  title: string;
  description: string | null;
  formRef: string | null;
  status: WorkflowAttentionItemReadModel['status'];
}

export type WorkflowPresentationVkClient = Pick<
  VibeKanbanServerClient,
  'getExecutionProcessFinalMessage' | 'getExecutionProcessRepoStates'
>;

export async function buildWorkflowPresentationModel(args: {
  store: Pick<DbWorkflowOrchestrationStore, 'getInstance' | 'listStepStates' | 'listAttentionItems'>;
  vk?: WorkflowPresentationVkClient;
  instanceId: string;
}): Promise<WorkflowPresentationModel | null> {
  const instance = await args.store.getInstance(args.instanceId);
  if (!instance) return null;
  const [steps, attentionItems] = await Promise.all([
    args.store.listStepStates(instance.instanceId),
    args.store.listAttentionItems({ instanceId: instance.instanceId, limit: 20 }),
  ]);
  const activeAttention = attentionItems.items.find((item) => item.status === 'active') ?? null;
  const latestAttention = activeAttention ?? attentionItems.items[0] ?? null;
  const definition = asRecord(instance.state)?.definition;
  const workflowName = stringFrom(asRecord(definition)?.name) ?? humanizeWorkflowId(instance.workflowId);
  const originalTask = stringFrom(asRecord(instance.input)?.task) ?? null;
  const resolvedRoles = readResolvedRoles(steps.find((step) => step.stepKey === 'resolve_sessions')?.output);
  const source = await buildAgentTurnItem({
    role: 'Implementer',
    queueStep: steps.find((step) => step.stepKey === 'ask_source'),
    waitStep: steps.find((step) => step.stepKey === 'wait_source'),
    input: instance.input,
    roleSession: resolvedRoles.source,
    vk: args.vk,
  });
  const review = await buildAgentTurnItem({
    role: 'Reviewer',
    queueStep: steps.find((step) => step.stepKey === 'ask_review'),
    waitStep: steps.find((step) => step.stepKey === 'wait_review'),
    input: instance.input,
    roleSession: resolvedRoles.review,
    vk: args.vk,
  });
  const timeline = [source, review].filter((item): item is WorkflowPresentationTimelineItem => Boolean(item));
  if (latestAttention) {
    timeline.push({
      id: 'human-attention',
      role: 'User',
      title: latestAttention.title,
      status: latestAttention.status === 'active' ? 'Waiting for you' : latestAttention.status === 'resolved' ? 'Answered' : 'Closed',
      session: null,
      initialMessage: latestAttention.description ? { text: latestAttention.description, truncated: false, maxChars: null } : null,
      finalResponse: latestAttention.resolution ? { text: summarizeHumanResolution(latestAttention.resolution), truncated: false, maxChars: null } : null,
      responseUnavailable: null,
      commits: [],
    });
  }
  return {
    instanceId: instance.instanceId,
    workflowId: instance.workflowId,
    workflowName,
    status: instance.status,
    humanStatus: activeAttention ? 'waiting_for_user' : latestAttention?.status === 'resolved' ? 'resolved' : latestAttention?.status === 'cancelled' ? 'cancelled' : 'not_needed',
    originalTask,
    startedAt: instance.createdAt,
    updatedAt: instance.updatedAt,
    completedAt: instance.status === 'completed' ? instance.updatedAt : null,
    timeline,
    attention: latestAttention ? {
      title: latestAttention.title,
      description: latestAttention.description,
      formRef: latestAttention.formRef,
      status: latestAttention.status,
    } : null,
  };
}

async function buildAgentTurnItem(args: {
  role: 'Implementer' | 'Reviewer';
  queueStep: WorkflowStepStateReadModel | undefined;
  waitStep: WorkflowStepStateReadModel | undefined;
  input: unknown;
  roleSession: RoleSession | undefined;
  vk?: WorkflowPresentationVkClient;
}): Promise<WorkflowPresentationTimelineItem | null> {
  if (!args.queueStep && !args.waitStep) return null;
  const output = asRecord(args.waitStep?.output);
  const executionProcessId = stringFrom(output?.executionProcessId);
  const sessionId = stringFrom(output?.sessionId) ?? stringFrom(asRecord(args.queueStep?.output)?.sessionId) ?? args.roleSession?.sessionId ?? null;
  const workspaceId = stringFrom(output?.workspaceId) ?? stringFrom(asRecord(args.queueStep?.output)?.workspaceId) ?? args.roleSession?.workspaceId ?? null;
  let initialMessage = initialMessageFromStep(args.queueStep, args.input);
  let finalResponse: PresentationText | null = null;
  let responseUnavailable: string | null = null;
  let commits: PresentationCommitRange[] = [];
  if (executionProcessId && args.vk) {
    try {
      const response = await args.vk.getExecutionProcessFinalMessage(executionProcessId);
      initialMessage = toPromptPresentationText(response) ?? initialMessage;
      finalResponse = toPresentationText(response);
      commits = await readCommitRanges(args.vk, executionProcessId);
    } catch {
      responseUnavailable = `Response unavailable. Open the ${args.role.toLowerCase()} session to retry or inspect the latest answer.`;
    }
  } else if (args.waitStep?.status === 'completed') {
    responseUnavailable = 'Response unavailable. Open the session to inspect the latest answer.';
  } else if (args.waitStep?.status === 'waiting') {
    responseUnavailable = `${args.role} is still working.`;
  }
  return {
    id: args.role.toLowerCase(),
    role: args.role,
    title: args.role === 'Implementer' ? 'Implementation turn' : 'Review turn',
    status: cleanStepStatus(args.waitStep?.status ?? args.queueStep?.status ?? 'pending'),
    session: sessionId ? { label: `${args.role} session`, workspaceId, sessionId } : null,
    initialMessage,
    finalResponse,
    responseUnavailable,
    commits,
  };
}

async function readCommitRanges(vk: WorkflowPresentationVkClient, executionProcessId: string): Promise<PresentationCommitRange[]> {
  try {
    const states = await vk.getExecutionProcessRepoStates(executionProcessId);
    return states
      .map((state) => ({
        before: shortCommit(state.before_head_commit),
        after: shortCommit(state.after_head_commit),
        merge: shortCommit(state.merge_commit),
      }))
      .filter((state) => state.before || state.after || state.merge);
  } catch {
    return [];
  }
}

function toPresentationText(response: AgentResponse): PresentationText | null {
  if (response.content == null) return null;
  return { text: response.content, truncated: response.truncated, maxChars: response.max_chars };
}

function toPromptPresentationText(response: AgentResponse): PresentationText | null {
  if (response.prompt_preview == null) return null;
  return { text: response.prompt_preview, truncated: response.prompt_truncated, maxChars: response.prompt_max_chars };
}

function initialMessageFromStep(step: WorkflowStepStateReadModel | undefined, input: unknown): PresentationText | null {
  const stepInput = asRecord(step?.input);
  const template = stringFrom(stepInput?.template);
  if (!template) return null;
  const rendered = renderTemplate(template, asRecord(input) ?? {});
  const maxChars = 4096;
  if (rendered.length > maxChars) return { text: `${rendered.slice(0, maxChars)}...`, truncated: true, maxChars };
  return { text: rendered, truncated: false, maxChars };
}

function renderTemplate(template: string, input: Record<string, unknown>): string {
  return template
    .replace(/{{\s*inputs\.([a-zA-Z0-9_]+)\s*}}/g, (_match, key: string) => stringFrom(input[key]) ?? '')
    .replace(/{{\s*source\.response\s*}}/g, 'Implementer response included above.');
}

type RoleSession = { workspaceId: string; sessionId: string };

function readResolvedRoles(output: unknown): Record<string, RoleSession> {
  const roles = asRecord(asRecord(output)?.roles);
  const result: Record<string, RoleSession> = {};
  if (!roles) return result;
  for (const [key, raw] of Object.entries(roles)) {
    const record = asRecord(raw);
    const roleName = stringFrom(record?.roleName);
    const workspaceId = stringFrom(record?.workspaceId);
    const sessionId = stringFrom(record?.sessionId);
    if (roleName && workspaceId && sessionId) result[key] = { workspaceId, sessionId };
  }
  return result;
}

function summarizeHumanResolution(value: unknown): string {
  const submission = asRecord(asRecord(value)?.submission) ?? asRecord(value);
  if (!submission) return 'Answered.';
  return Object.entries(submission).map(([key, val]) => `${key}: ${String(val)}`).join('\n');
}

function cleanStepStatus(status: string): string {
  switch (status) {
    case 'completed': return 'Complete';
    case 'waiting': return 'Waiting';
    case 'running': return 'In progress';
    case 'failed': return 'Needs attention';
    case 'cancelled': return 'Closed';
    default: return 'Not started';
  }
}

function humanizeWorkflowId(value: string): string {
  return value.split(/[-_]/g).filter(Boolean).map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`).join(' ');
}

function shortCommit(value: string | null): string | null {
  return value ? value.slice(0, 12) : null;
}

function stringFrom(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

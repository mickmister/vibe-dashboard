import { randomUUID } from 'node:crypto';
import type { AgentTeam, TeamAgent } from '../../teams/agentTeams';
import type { QueueFollowUpResponse, AgentResponse } from '../../server/vk-client';
import type { ResolveRoleSessionsInput, ResolveRoleSessionsResult } from '../../server/role-session-resolver';
import type {
  DbWorkflowOrchestrationStore,
  WorkflowInstanceReadModel,
  WorkflowScopedTriggerReadModel,
  WorkflowStepStateReadModel,
} from '../../server/workflow-orchestration-store';
import type {
  DeclarativeQueuePromptStep,
  DeclarativeResolveRolesStep,
  DeclarativeWaitForNextCompletedResponseStep,
  DeclarativeWorkflowDefinition,
  DeclarativeWorkflowStep,
} from './definitions';
import { normalizeDeclarativeWorkflowDefinition } from './definitions';

export interface DeclarativeWorkflowRuntimeVkClient {
  queueFollowUp(sessionId: string, prompt: string, options?: { source?: 'workflow' | 'system' | 'agent' | 'from_user' }): Promise<QueueFollowUpResponse>;
  getSessionLatestResponse(sessionId: string): Promise<AgentResponse | null>;
}

export interface DeclarativeWorkflowRuntimeResolver {
  resolve(input: ResolveRoleSessionsInput): Promise<ResolveRoleSessionsResult>;
  persistResolvedBindings(input: ResolveRoleSessionsInput, resolution: ResolveRoleSessionsResult): Promise<ResolveRoleSessionsResult>;
}

export interface DeclarativeWorkflowStartInput {
  definition: DeclarativeWorkflowDefinition | unknown;
  input: Record<string, unknown>;
  team: AgentTeam;
  trigger?: string;
  instanceId?: string;
  teamId?: string | null;
}

export interface DeclarativeWorkflowResolvedRole {
  key: string;
  roleId: string;
  roleName: string;
  workspaceId: string;
  sessionId: string;
  bindingId: string | null;
  warnings: string[];
}

export interface DeclarativeWorkflowStartResult {
  instance: WorkflowInstanceReadModel;
  steps: WorkflowStepStateReadModel[];
  trigger: WorkflowScopedTriggerReadModel;
  resolvedRoles: Record<string, DeclarativeWorkflowResolvedRole>;
  queuedSource: {
    stepId: string;
    roleKey: string;
    sessionId: string;
    workspaceId: string;
    queueItemId: string;
    queuedCount: number;
  };
  cursor: {
    executionProcessId: string | null;
    completedAt: string | null;
  };
}

export class DeclarativeWorkflowRuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeclarativeWorkflowRuntimeError';
  }
}

interface RuntimeStepIds {
  instanceId: string;
  stepStateId: (stepId: string) => string;
  triggerId: (stepId: string) => string;
}

export class DeclarativeWorkflowRuntime {
  private readonly store: DbWorkflowOrchestrationStore;
  private readonly resolver: DeclarativeWorkflowRuntimeResolver;
  private readonly vk: DeclarativeWorkflowRuntimeVkClient;
  private readonly createId: () => string;
  private readonly now: () => number;

  constructor(options: {
    store: DbWorkflowOrchestrationStore;
    resolver: DeclarativeWorkflowRuntimeResolver;
    vk: DeclarativeWorkflowRuntimeVkClient;
    createId?: () => string;
    now?: () => number;
  }) {
    this.store = options.store;
    this.resolver = options.resolver;
    this.vk = options.vk;
    this.createId = options.createId ?? (() => randomUUID());
    this.now = options.now ?? Date.now;
  }

  async start(args: DeclarativeWorkflowStartInput): Promise<DeclarativeWorkflowStartResult> {
    const definition = normalizeDeclarativeWorkflowDefinition(args.definition);
    const workflowInput = validateWorkflowInput(definition, args.input);
    const resolveStep = firstStepOfType(definition, 'resolve_roles');
    const sourceQueueStep = firstStepOfType(definition, 'queue_prompt');
    const waitStep = firstStepOfType(definition, 'wait_for_next_completed_response');
    if (waitStep.target !== sourceQueueStep.target) {
      throw new DeclarativeWorkflowRuntimeError(`First wait step ${waitStep.id} must target first queued role ${sourceQueueStep.target}`);
    }
    const ids: RuntimeStepIds = {
      instanceId: args.instanceId ?? `workflow_instance_${this.createId()}`,
      stepStateId: (stepId) => `${ids.instanceId}_${stepId}`,
      triggerId: (stepId) => `${ids.instanceId}_${stepId}_trigger`,
    };
    const workspaceId = readRequiredInput(workflowInput, resolveStep.workspaceInput);
    const laneId = resolveStep.laneInput ? readOptionalInput(workflowInput, resolveStep.laneInput) : null;

    const instance = await this.store.createInstance({
      instanceId: ids.instanceId,
      workflowId: definition.id,
      trigger: args.trigger ?? definition.trigger,
      templateId: definition.id,
      templateVersion: definition.version,
      teamId: args.teamId ?? args.team.id,
      laneId,
      input: workflowInput,
      state: { phase: 'created', definitionId: definition.id, definitionVersion: definition.version },
      currentStepId: definition.steps[0]?.id ?? null,
    });

    const steps: WorkflowStepStateReadModel[] = [];
    for (const step of definition.steps) {
      steps.push(await this.store.createStepState({
        id: ids.stepStateId(step.id),
        instanceId: ids.instanceId,
        stepKey: step.id,
        input: step,
      }));
    }

    try {
      await this.store.startInstance(ids.instanceId, { currentStepId: resolveStep.id });
      const resolvedRoles = await this.runResolveRoles({ definition, instanceId: ids.instanceId, step: resolveStep, input: workflowInput, team: args.team, workspaceId, laneId });
      if (definition.policies.blockSameSession) assertDistinctSessions(resolvedRoles);
      await this.store.markStepRunning(ids.stepStateId(resolveStep.id));
      await this.store.completeStep(ids.stepStateId(resolveStep.id), { roles: resolvedRoles });

      await this.store.markStepRunning(ids.stepStateId(sourceQueueStep.id));
      const sourceRole = resolvedRoles[sourceQueueStep.target];
      if (!sourceRole) throw new DeclarativeWorkflowRuntimeError(`No resolved role for queued target ${sourceQueueStep.target}`);
      const cursor = await this.vk.getSessionLatestResponse(sourceRole.sessionId);
      const prompt = renderTemplate(sourceQueueStep.template, workflowInput);
      const queued = await this.vk.queueFollowUp(sourceRole.sessionId, prompt, { source: 'workflow' });
      await this.store.completeStep(ids.stepStateId(sourceQueueStep.id), {
        roleKey: sourceQueueStep.target,
        sessionId: sourceRole.sessionId,
        workspaceId: queued.queued_item.workspace_id,
        queueItemId: queued.queued_item.id,
        queuedCount: queued.status.count,
      });

      await this.store.markStepRunning(ids.stepStateId(waitStep.id));
      const trigger = await this.store.createScopedTrigger({
        triggerId: ids.triggerId(waitStep.id),
        instanceId: ids.instanceId,
        stepStateId: ids.stepStateId(waitStep.id),
        stepKey: waitStep.id,
        roleId: sourceRole.roleId,
        laneId,
        workspaceId: queued.queued_item.workspace_id,
        sessionId: sourceRole.sessionId,
        mode: 'next_completion_after_cursor',
        cursorCompletedAt: cursor?.completed_at ? new Date(cursor.completed_at).getTime() : null,
        cursorExecutionProcessId: cursor?.execution_process_id ?? null,
        expectedQueueItemId: queued.queued_item.id,
        timeoutAt: this.computeTriggerTimeoutAt(definition),
      });
      const waitingInstance = await this.store.markInstanceWaiting(ids.instanceId, {
        currentStepId: waitStep.id,
        waitingTriggerId: trigger.triggerId,
      });
      return {
        instance: waitingInstance,
        steps: await this.getInstanceSteps(ids.instanceId),
        trigger,
        resolvedRoles,
        queuedSource: {
          stepId: sourceQueueStep.id,
          roleKey: sourceQueueStep.target,
          sessionId: sourceRole.sessionId,
          workspaceId: queued.queued_item.workspace_id,
          queueItemId: queued.queued_item.id,
          queuedCount: queued.status.count,
        },
        cursor: {
          executionProcessId: cursor?.execution_process_id ?? null,
          completedAt: cursor?.completed_at ?? null,
        },
      };
    } catch (error) {
      await this.markFailedBestEffort(ids.instanceId, definition.steps, ids, error);
      throw error;
    }
  }

  private async runResolveRoles(args: {
    definition: DeclarativeWorkflowDefinition;
    instanceId: string;
    step: DeclarativeResolveRolesStep;
    input: Record<string, string>;
    team: AgentTeam;
    workspaceId: string;
    laneId: string | null;
  }): Promise<Record<string, DeclarativeWorkflowResolvedRole>> {
    const requested = args.step.roles.map((role) => ({ role, agent: findAgentForRole(args.team, args.input, role) }));
    const roleIds = requested.map((entry) => entry.agent.id);
    const overrides = Object.fromEntries(
      requested.flatMap((entry) => {
        const sessionId = entry.role.sessionInput ? readOptionalInput(args.input, entry.role.sessionInput) : null;
        return sessionId ? [[entry.agent.id, { sessionId }]] : [];
      }),
    );
    const resolveInput: ResolveRoleSessionsInput = {
      team: args.team,
      workflowId: args.definition.id,
      instanceId: args.instanceId,
      laneId: args.laneId,
      workspaceId: args.workspaceId,
      roleIds,
      overrides,
      allowAutoCreate: args.definition.policies.allowAutoCreateSessions,
      allowRoleNameReuse: true,
      persistBindings: false,
    };
    const preflight = await this.resolver.resolve(resolveInput);
    if (!preflight.ok) throw new DeclarativeWorkflowRuntimeError(formatResolutionError(preflight));
    const preflightRoles = mapResolvedRoles(requested, preflight);
    if (args.definition.policies.blockSameSession) assertDistinctSessions(preflightRoles);
    const resolution = await this.resolver.persistResolvedBindings({ ...resolveInput, persistBindings: true }, preflight);
    return mapResolvedRoles(requested, resolution);
  }

  private computeTriggerTimeoutAt(definition: DeclarativeWorkflowDefinition): number | null {
    const staleAfterMinutes = definition.policies.stall.staleAfterMinutes;
    return staleAfterMinutes > 0 ? this.now() + staleAfterMinutes * 60_000 : null;
  }

  private async getInstanceSteps(instanceId: string): Promise<WorkflowStepStateReadModel[]> {
    return this.store.listStepStates(instanceId);
  }

  private async markFailedBestEffort(instanceId: string, steps: DeclarativeWorkflowStep[], ids: RuntimeStepIds, error: unknown): Promise<void> {
    const serialized = serializeError(error);
    for (const step of steps) {
      try {
        await this.store.failStep(ids.stepStateId(step.id), serialized, serialized.message);
        break;
      } catch {
        // Keep trying pending/running/waiting steps; terminal/non-created rows can reject.
      }
    }
    try {
      await this.store.failInstance(instanceId, serialized);
    } catch {
      // Best-effort failure marking only; preserve original error.
    }
  }
}

function validateWorkflowInput(definition: DeclarativeWorkflowDefinition, input: Record<string, unknown>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, spec] of Object.entries(definition.inputs)) {
    const value = input[key];
    if (value == null || value === '') {
      if (spec.required) throw new DeclarativeWorkflowRuntimeError(`Missing required workflow input: ${key}`);
      continue;
    }
    if (typeof value !== 'string') throw new DeclarativeWorkflowRuntimeError(`Workflow input ${key} must be a string`);
    normalized[key] = value;
  }
  return normalized;
}

function firstStepOfType<T extends DeclarativeWorkflowStep['type']>(definition: DeclarativeWorkflowDefinition, type: T): Extract<DeclarativeWorkflowStep, { type: T }> {
  const step = definition.steps.find((entry): entry is Extract<DeclarativeWorkflowStep, { type: T }> => entry.type === type);
  if (!step) throw new DeclarativeWorkflowRuntimeError(`Definition ${definition.id} is missing required ${type} step`);
  return step;
}

function findAgentForRole(team: AgentTeam, input: Record<string, string>, role: DeclarativeResolveRolesStep['roles'][number]): TeamAgent {
  const requested = role.roleInput ? input[role.roleInput] : null;
  const candidates = [requested, role.defaultRole, role.key].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    const normalized = candidate.toLowerCase();
    const agent = team.agents.find((entry) => entry.id === candidate || entry.role.toLowerCase() === normalized || entry.displayName.toLowerCase() === normalized);
    if (agent) return agent;
  }
  throw new DeclarativeWorkflowRuntimeError(`Could not find team agent for role target ${role.key}`);
}

function mapResolvedRoles(
  requested: Array<{ role: DeclarativeResolveRolesStep['roles'][number]; agent: TeamAgent }>,
  resolution: ResolveRoleSessionsResult,
): Record<string, DeclarativeWorkflowResolvedRole> {
  const byRoleId = new Map(resolution.results.map((result) => [result.roleId, result]));
  const mapped: Record<string, DeclarativeWorkflowResolvedRole> = {};
  for (const entry of requested) {
    const result = byRoleId.get(entry.agent.id);
    if (!result?.sessionId) throw new DeclarativeWorkflowRuntimeError(`Role ${entry.role.key} did not resolve a VK session`);
    mapped[entry.role.key] = {
      key: entry.role.key,
      roleId: result.roleId,
      roleName: result.roleName,
      workspaceId: result.workspaceId,
      sessionId: result.sessionId,
      bindingId: result.bindingId,
      warnings: result.warnings,
    };
  }
  return mapped;
}

function assertDistinctSessions(roles: Record<string, DeclarativeWorkflowResolvedRole>): void {
  const seen = new Map<string, string>();
  for (const role of Object.values(roles)) {
    const previous = seen.get(role.sessionId);
    if (previous) throw new DeclarativeWorkflowRuntimeError(`Workflow role targets ${previous} and ${role.key} resolved to the same VK session ${role.sessionId}`);
    seen.set(role.sessionId, role.key);
  }
}

function renderTemplate(template: string, input: Record<string, string>): string {
  return template.replace(/{{\s*inputs\.([a-zA-Z0-9_]+)\s*}}/g, (_match, key: string) => input[key] ?? '');
}

function readRequiredInput(input: Record<string, string>, key: string): string {
  const value = input[key];
  if (!value) throw new DeclarativeWorkflowRuntimeError(`Missing required workflow input: ${key}`);
  return value;
}

function readOptionalInput(input: Record<string, string>, key: string): string | null {
  return input[key] || null;
}

function formatResolutionError(result: ResolveRoleSessionsResult): string {
  return result.errors.map((error) => error.error ?? `${error.roleName} failed to resolve`).join('; ') || 'Role session resolution failed';
}

function serializeError(error: unknown): { message: string; name?: string } {
  if (error instanceof Error) return { message: error.message, name: error.name };
  return { message: String(error) };
}

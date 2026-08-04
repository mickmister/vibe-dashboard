import { createHash, randomUUID } from 'node:crypto';
import type { AgentTeam, TeamAgent } from '../../teams/agentTeams';
import type { QueueFollowUpResponse, AgentResponse, Session } from '../../server/vk-client';
import type { ResolveRoleSessionsInput, ResolveRoleSessionsResult } from '../../server/role-session-resolver';
import type { PipeResponseResult, PipeResponseInput } from '../../server/response-pipe-service';
import { ResponsePipeValidationError } from '../../server/response-pipe-service';
import type { DbResponsePipeStore } from '../../server/response-pipe-store';
import type {
  DbWorkflowOrchestrationStore,
  WorkflowInstanceReadModel,
  WorkflowScopedTriggerReadModel,
  WorkflowStepStateReadModel,
} from '../../server/workflow-orchestration-store';
import type {
  DeclarativeQueuePromptStep,
  DeclarativePipeResponseStep,
  DeclarativeResolveRolesStep,
  DeclarativeNotifyOverseerStep,
  DeclarativeCompleteStep,
  DeclarativeWaitForNextCompletedResponseStep,
  DeclarativeWorkflowDefinition,
  DeclarativeWorkflowStep,
} from './definitions';
import { normalizeDeclarativeWorkflowDefinition } from './definitions';
import { getBuiltInDeclarativeWorkflowDefinition } from './builtins';

export interface DeclarativeWorkflowRuntimeVkClient {
  queueFollowUp(sessionId: string, prompt: string, options?: { source?: 'workflow' | 'system' | 'agent' | 'from_user' }): Promise<QueueFollowUpResponse>;
  getSessionLatestResponse(sessionId: string): Promise<AgentResponse | null>;
  getExecutionProcessFinalMessage(processId: string): Promise<AgentResponse>;
  getSession(sessionId: string): Promise<Session>;
}

export interface DeclarativeWorkflowRuntimeResolver {
  resolve(input: ResolveRoleSessionsInput): Promise<ResolveRoleSessionsResult>;
  persistResolvedBindings(input: ResolveRoleSessionsInput, resolution: ResolveRoleSessionsResult): Promise<ResolveRoleSessionsResult>;
}

export interface DeclarativeWorkflowRuntimeResponsePipe {
  pipeResponse(input: PipeResponseInput): Promise<PipeResponseResult>;
}

export interface DeclarativeWorkflowRuntimeScopedTriggerSatisfier {
  runOnce(): Promise<unknown>;
}

export type DeclarativeWorkflowNotificationStore = Pick<DbResponsePipeStore, 'getDeliveryByDedupeKey' | 'planDelivery' | 'markDeliveryRendered' | 'markDeliveryQueued'>;

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

export interface DeclarativeWorkflowResumeInput {
  definition: DeclarativeWorkflowDefinition | unknown;
}

export interface DeclarativeWorkflowResumeHandoff {
  instanceId: string;
  sourceExecutionProcessId: string;
  reviewerSessionId: string;
  reviewerQueueItemId: string;
  reviewerTrigger: WorkflowScopedTriggerReadModel;
  pipeResult: PipeResponseResult;
}

export interface DeclarativeWorkflowRunOnceResult {
  resumed: DeclarativeWorkflowResumeHandoff[];
  completed: Array<{ instanceId: string; notified: boolean; overseerQueueItemId: string | null; output: Record<string, unknown> }>;
  skipped: Array<{ instanceId: string; reason: string }>;
  errors: Array<{ instanceId: string; error: { message: string; name?: string } }>;
}

export interface DeclarativeWorkflowStatus {
  instance: WorkflowInstanceReadModel | null;
  steps: WorkflowStepStateReadModel[];
  triggers: WorkflowScopedTriggerReadModel[];
  output: unknown;
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
  private readonly responsePipe?: DeclarativeWorkflowRuntimeResponsePipe;
  private readonly scopedTriggerSatisfier?: DeclarativeWorkflowRuntimeScopedTriggerSatisfier;
  private readonly notificationStore?: DeclarativeWorkflowNotificationStore;
  private readonly createId: () => string;
  private readonly now: () => number;

  constructor(options: {
    store: DbWorkflowOrchestrationStore;
    resolver: DeclarativeWorkflowRuntimeResolver;
    vk: DeclarativeWorkflowRuntimeVkClient;
    responsePipe?: DeclarativeWorkflowRuntimeResponsePipe;
    scopedTriggerSatisfier?: DeclarativeWorkflowRuntimeScopedTriggerSatisfier;
    notificationStore?: DeclarativeWorkflowNotificationStore;
    createId?: () => string;
    now?: () => number;
  }) {
    this.store = options.store;
    this.resolver = options.resolver;
    this.vk = options.vk;
    this.responsePipe = options.responsePipe;
    this.scopedTriggerSatisfier = options.scopedTriggerSatisfier;
    this.notificationStore = options.notificationStore;
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
      state: {
        phase: 'created',
        definitionId: definition.id,
        definitionVersion: definition.version,
        definition,
      },
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

  async runOnce(args: DeclarativeWorkflowResumeInput): Promise<DeclarativeWorkflowRunOnceResult> {
    if (!this.responsePipe) throw new DeclarativeWorkflowRuntimeError('Declarative workflow runtime resume requires responsePipe');
    await this.scopedTriggerSatisfier?.runOnce();
    const definition = normalizeDeclarativeWorkflowDefinition(args.definition);
    const running = await this.store.listInstances({ workflowId: definition.id, status: 'running', limit: 100 });
    return this.runReadyInstances(running.instances, (instance) => this.resolveDefinitionForInstance(instance, definition));
  }

  async runReady(): Promise<DeclarativeWorkflowRunOnceResult> {
    if (!this.responsePipe) throw new DeclarativeWorkflowRuntimeError('Declarative workflow runtime resume requires responsePipe');
    await this.scopedTriggerSatisfier?.runOnce();
    const running = await this.listAllRunningInstances();
    return this.runReadyInstances(running, (instance) => this.resolveDefinitionForInstance(instance));
  }

  private async runReadyInstances(
    instances: WorkflowInstanceReadModel[],
    resolveDefinition: (instance: WorkflowInstanceReadModel) => DeclarativeWorkflowDefinition,
  ): Promise<DeclarativeWorkflowRunOnceResult> {
    const resumed: DeclarativeWorkflowResumeHandoff[] = [];
    const completed: DeclarativeWorkflowRunOnceResult['completed'] = [];
    const skipped: DeclarativeWorkflowRunOnceResult['skipped'] = [];
    const errors: DeclarativeWorkflowRunOnceResult['errors'] = [];

    for (const instance of instances) {
      try {
        const definition = resolveDefinition(instance);
        const resolveStep = firstStepOfType(definition, 'resolve_roles');
        const sourceWaitStep = firstStepOfType(definition, 'wait_for_next_completed_response');
        const reviewPipeStep = firstStepOfType(definition, 'pipe_response');
        const reviewWaitStep = findWaitStepAfter(definition, reviewPipeStep.id);
        const notifyStep = firstStepOfType(definition, 'notify_overseer');
        const completeStep = firstStepOfType(definition, 'complete');
        const finished = await this.completeAfterReviewerResponse(definition, instance, sourceWaitStep, reviewWaitStep, notifyStep, completeStep);
        if (finished) {
          completed.push(finished);
          continue;
        }
        const handoff = await this.resumeSourceToReviewer(definition, instance, resolveStep, sourceWaitStep, reviewPipeStep, reviewWaitStep);
        if (handoff) resumed.push(handoff);
        else skipped.push({ instanceId: instance.instanceId, reason: 'not_ready' });
      } catch (error) {
        errors.push({ instanceId: instance.instanceId, error: serializeError(error) });
      }
    }

    return { resumed, completed, skipped, errors };
  }

  private async listAllRunningInstances(): Promise<WorkflowInstanceReadModel[]> {
    const instances: WorkflowInstanceReadModel[] = [];
    let offset = 0;
    for (;;) {
      const page = await this.store.listInstances({ status: 'running', limit: 100, offset });
      instances.push(...page.instances);
      if (!page.hasMore) return instances;
      offset += page.limit;
    }
  }

  private resolveDefinitionForInstance(
    instance: WorkflowInstanceReadModel,
    explicitDefinition?: DeclarativeWorkflowDefinition,
  ): DeclarativeWorkflowDefinition {
    const state = asOptionalRecord(instance.state);
    const storedDefinition = state?.definition;
    if (storedDefinition) {
      const definition = normalizeDeclarativeWorkflowDefinition(storedDefinition);
      if (definition.id !== instance.workflowId) {
        throw new DeclarativeWorkflowRuntimeError(`Stored workflow definition ${definition.id} does not match instance workflow ${instance.workflowId}`);
      }
      if (explicitDefinition && explicitDefinition.id !== definition.id) {
        throw new DeclarativeWorkflowRuntimeError(`Explicit workflow definition ${explicitDefinition.id} does not match stored definition ${definition.id}`);
      }
      return definition;
    }
    const builtIn = getBuiltInDeclarativeWorkflowDefinition(instance.workflowId);
    if (builtIn) return builtIn;
    if (explicitDefinition) {
      if (explicitDefinition.id !== instance.workflowId) {
        throw new DeclarativeWorkflowRuntimeError(`Explicit workflow definition ${explicitDefinition.id} does not match instance workflow ${instance.workflowId}`);
      }
      return explicitDefinition;
    }
    throw new DeclarativeWorkflowRuntimeError(`No stored, built-in, or explicit declarative definition found for workflow ${instance.workflowId}`);
  }

  async getStatus(instanceId: string): Promise<DeclarativeWorkflowStatus> {
    const instance = await this.store.getInstance(instanceId);
    if (!instance) return { instance: null, steps: [], triggers: [], output: null };
    const [steps, triggers] = await Promise.all([
      this.store.listStepStates(instanceId),
      this.store.listTriggers({ instanceId, limit: 100 }),
    ]);
    return {
      instance,
      steps,
      triggers: triggers.triggers,
      output: asOptionalRecord(instance.state)?.output ?? null,
    };
  }

  private async completeAfterReviewerResponse(
    definition: DeclarativeWorkflowDefinition,
    instance: WorkflowInstanceReadModel,
    sourceWaitStep: DeclarativeWaitForNextCompletedResponseStep,
    reviewWaitStep: DeclarativeWaitForNextCompletedResponseStep,
    notifyStep: DeclarativeNotifyOverseerStep,
    completeStep: DeclarativeCompleteStep,
  ): Promise<{ instanceId: string; notified: boolean; overseerQueueItemId: string | null; output: Record<string, unknown> } | null> {
    const steps = await this.getInstanceSteps(instance.instanceId);
    const reviewWaitState = requireStepState(steps, reviewWaitStep.id);
    const notifyState = requireStepState(steps, notifyStep.id);
    const completeState = requireStepState(steps, completeStep.id);
    if (reviewWaitState.status !== 'completed') return null;
    if (completeState.status === 'completed') return null;
    if (notifyState.status !== 'pending' && notifyState.status !== 'running') return null;

    const resolvedRoles = readResolvedRoles(requireStepState(steps, firstStepOfType(definition, 'resolve_roles').id).output);
    const reviewRole = resolvedRoles[reviewWaitStep.target];
    if (reviewRole && await this.store.hasActiveExternalWaitForSession({ workspaceId: reviewRole.workspaceId, sessionId: reviewRole.sessionId })) {
      return null;
    }

    const sourceOutput = readResponseStepOutput(requireStepState(steps, sourceWaitStep.id).output);
    const reviewOutput = readResponseStepOutput(reviewWaitState.output);
    const [sourceResponse, reviewResponse] = await Promise.all([
      this.vk.getExecutionProcessFinalMessage(sourceOutput.executionProcessId),
      this.vk.getExecutionProcessFinalMessage(reviewOutput.executionProcessId),
    ]);
    const output = {
      workflowId: definition.id,
      instanceId: instance.instanceId,
      sourceExecutionProcessId: sourceOutput.executionProcessId,
      reviewExecutionProcessId: reviewOutput.executionProcessId,
      refs: {
        source: responseRef(sourceResponse),
        review: responseRef(reviewResponse),
      },
    };

    let overseerQueueItemId: string | null = null;
    const input = instance.input as Record<string, string>;
    const overseerSessionId = readOptionalInput(input, notifyStep.sessionInput);
    if (overseerSessionId) {
      const dedupe = notificationDedupe(instance, notifyStep, overseerSessionId);
      const existingNotification = await this.notificationStore?.getDeliveryByDedupeKey(dedupe.dedupeKey);
      let overseerSession: Session | null = null;
      if (!(existingNotification?.status === 'queued' && existingNotification.queueItemId)) {
        overseerSession = await this.vk.getSession(overseerSessionId);
        if (await this.store.hasActiveExternalWaitForSession({ workspaceId: overseerSession.workspace_id, sessionId: overseerSession.id })) {
          return null;
        }
      }
      const prompt = renderNotificationTemplate(
        notifyStep.template,
        input,
        instance.instanceId,
        { stepId: sourceWaitStep.id, response: sourceResponse },
        { stepId: reviewWaitStep.id, response: reviewResponse },
      );
      overseerQueueItemId = await this.queueCompletionNotification({
        instance,
        notifyStep,
        overseerSessionId,
        overseerSession,
        prompt,
        reviewResponse,
        ...dedupe,
      });
    }
    await this.store.completeWorkflowAfterNotification({
      instanceId: instance.instanceId,
      notifyStepStateId: notifyState.id,
      notifyOutput: {
        notified: Boolean(overseerSessionId),
        overseerSessionId: overseerSessionId ?? null,
        queueItemId: overseerQueueItemId,
      },
      completeStepStateId: completeState.id,
      completeOutput: {
        summary: renderCompleteSummary(completeStep.summaryTemplate, input),
        output,
      },
      finalState: { phase: 'completed', output },
      latestRunId: reviewOutput.executionProcessId,
    });
    return { instanceId: instance.instanceId, notified: Boolean(overseerSessionId), overseerQueueItemId, output };
  }

  private async queueCompletionNotification(args: {
    instance: WorkflowInstanceReadModel;
    notifyStep: DeclarativeNotifyOverseerStep;
    overseerSessionId: string;
    overseerSession: Session | null;
    prompt: string;
    reviewResponse: AgentResponse;
    templateHash: string;
    dedupeKey: string;
  }): Promise<string> {
    if (!this.notificationStore) {
      throw new DeclarativeWorkflowRuntimeError('Declarative workflow notification requires notificationStore');
    }
    const overseerSession = args.overseerSession ?? await this.vk.getSession(args.overseerSessionId);
    const planned = await this.notificationStore.planDelivery({
      deliveryId: `notification_${this.createId()}`,
      workflowInstanceId: args.instance.instanceId,
      triggerId: null,
      sourceWorkspaceId: args.reviewResponse.workspace_id,
      sourceSessionId: args.reviewResponse.session_id,
      sourceExecutionProcessId: args.reviewResponse.execution_process_id,
      sourceCompletedAt: args.reviewResponse.completed_at == null ? null : new Date(args.reviewResponse.completed_at).getTime(),
      targetWorkspaceId: overseerSession.workspace_id,
      targetSessionId: overseerSession.id,
      templateId: `${args.instance.workflowId}.${args.notifyStep.id}`,
      templateVersion: args.instance.templateVersion,
      templateHash: args.templateHash,
      dedupeKey: args.dedupeKey,
      metadata: { kind: 'workflow_completion_notification', stepId: args.notifyStep.id },
    });
    if (planned.delivery.status === 'queued' && planned.delivery.queueItemId) {
      return planned.delivery.queueItemId;
    }
    if (planned.delivery.status !== 'planned' && planned.delivery.status !== 'rendered') {
      throw new DeclarativeWorkflowRuntimeError(`Completion notification delivery ${planned.delivery.deliveryId} is ${planned.delivery.status}`);
    }
    const rendered = planned.delivery.status === 'rendered'
      ? planned.delivery
      : await this.notificationStore.markDeliveryRendered(planned.delivery.deliveryId, {
          promptHash: sha256(args.prompt),
          promptLength: args.prompt.length,
        });

    // If VK accepts the queue item but markDeliveryQueued() fails, retry can
    // still duplicate the notification. This mirrors the known response-pipe
    // hard edge; once markDeliveryQueued() succeeds, later DB completion
    // failures are idempotently recovered without re-queueing.
    const queued = await this.vk.queueFollowUp(args.overseerSessionId, args.prompt, { source: 'workflow' });
    const delivery = await this.notificationStore.markDeliveryQueued(rendered.deliveryId, {
      queueItemId: queued.queued_item.id,
    });
    if (!delivery.queueItemId) throw new DeclarativeWorkflowRuntimeError(`Completion notification delivery ${delivery.deliveryId} did not record queue item`);
    return delivery.queueItemId;
  }

  private async resumeSourceToReviewer(
    definition: DeclarativeWorkflowDefinition,
    instance: WorkflowInstanceReadModel,
    resolveStep: DeclarativeResolveRolesStep,
    sourceWaitStep: DeclarativeWaitForNextCompletedResponseStep,
    reviewPipeStep: DeclarativePipeResponseStep,
    reviewWaitStep: DeclarativeWaitForNextCompletedResponseStep,
  ): Promise<DeclarativeWorkflowResumeHandoff | null> {
    const steps = await this.getInstanceSteps(instance.instanceId);
    const sourceWaitState = requireStepState(steps, sourceWaitStep.id);
    const reviewPipeState = requireStepState(steps, reviewPipeStep.id);
    const reviewWaitState = requireStepState(steps, reviewWaitStep.id);
    if (sourceWaitState.status !== 'completed') return null;
    if (reviewWaitState.status === 'waiting') return null;
    if (reviewPipeState.status === 'completed') return null;
    if (reviewPipeState.status !== 'pending' && reviewPipeState.status !== 'running') return null;

    const resolvedRoles = readResolvedRoles(requireStepState(steps, resolveStep.id).output);
    const sourceRole = resolvedRoles[reviewPipeStep.source === sourceWaitStep.id ? sourceWaitStep.target : reviewPipeStep.source] ?? resolvedRoles.source;
    const reviewRole = resolvedRoles[reviewPipeStep.target];
    if (!sourceRole) throw new DeclarativeWorkflowRuntimeError(`No resolved source role for pipe step ${reviewPipeStep.id}`);
    if (!reviewRole) throw new DeclarativeWorkflowRuntimeError(`No resolved reviewer role for pipe step ${reviewPipeStep.id}`);
    if (definition.policies.blockSameSession) assertDistinctSessions({ source: sourceRole, review: reviewRole });

    const sourceOutput = readResponseStepOutput(sourceWaitState.output);
    const sourceTrigger = await this.findTriggerForStep(instance.instanceId, sourceWaitStep.id, 'satisfied');
    if (await this.store.hasActiveExternalWaitForSession({ workspaceId: sourceRole.workspaceId, sessionId: sourceRole.sessionId })) {
      return null;
    }
    if (await this.store.hasActiveExternalWaitForSession({ workspaceId: reviewRole.workspaceId, sessionId: reviewRole.sessionId })) {
      return null;
    }

    if (reviewPipeState.status === 'pending') await this.store.markStepRunning(reviewPipeState.id);
    const reviewerCursor = await this.vk.getSessionLatestResponse(reviewRole.sessionId);

    try {
      const pipeResult = await this.responsePipe!.pipeResponse({
        sourceExecutionProcessId: sourceOutput.executionProcessId,
        template: {
          templateId: `${definition.id}.${reviewPipeStep.id}`,
          templateVersion: definition.version,
          body: renderPipeTemplateForResponsePipe(reviewPipeStep.template, instance.input as Record<string, string>),
        },
        targets: [{
          workspaceId: reviewRole.workspaceId,
          sessionId: reviewRole.sessionId,
          roleId: reviewRole.roleId,
          laneId: instance.laneId,
        }],
        workflowInstanceId: instance.instanceId,
        triggerId: sourceTrigger?.triggerId ?? sourceWaitState.waitingTriggerId,
        sourceRoleId: sourceRole.roleId,
        sourceLaneId: instance.laneId,
        allowCrossWorkspace: false,
        allowTruncatedSource: definition.policies.allowTruncatedSourceDelivery,
        queueSource: 'workflow',
        metadata: { stepId: reviewPipeStep.id },
      });
      const queuedDelivery = pipeResult.deliveries.find((delivery) => delivery.delivery.queueItemId);
      const queueItemId = queuedDelivery?.delivery.queueItemId;
      if (!queueItemId) return null;

      const handoff = await this.store.completePipeHandoffAndWait({
        instanceId: instance.instanceId,
        pipeStepStateId: reviewPipeState.id,
        waitStepStateId: reviewWaitState.id,
        waitStepKey: reviewWaitStep.id,
        pipeOutput: {
          sourceStepId: sourceWaitStep.id,
          sourceExecutionProcessId: sourceOutput.executionProcessId,
          targetRoleKey: reviewPipeStep.target,
          targetSessionId: reviewRole.sessionId,
          targetWorkspaceId: reviewRole.workspaceId,
          deliveryId: queuedDelivery.delivery.deliveryId,
          queueItemId,
        },
        trigger: {
          triggerId: `${instance.instanceId}_${reviewWaitStep.id}_trigger`,
          instanceId: instance.instanceId,
          stepStateId: reviewWaitState.id,
          stepKey: reviewWaitStep.id,
          roleId: reviewRole.roleId,
          laneId: instance.laneId,
          workspaceId: reviewRole.workspaceId,
          sessionId: reviewRole.sessionId,
          mode: 'next_completion_after_cursor',
          cursorCompletedAt: reviewerCursor?.completed_at ? new Date(reviewerCursor.completed_at).getTime() : null,
          cursorExecutionProcessId: reviewerCursor?.execution_process_id ?? null,
          expectedQueueItemId: queueItemId,
          timeoutAt: this.computeTriggerTimeoutAt(definition),
        },
      });
      return {
        instanceId: instance.instanceId,
        sourceExecutionProcessId: sourceOutput.executionProcessId,
        reviewerSessionId: reviewRole.sessionId,
        reviewerQueueItemId: queueItemId,
        reviewerTrigger: handoff.trigger,
        pipeResult,
      };
    } catch (error) {
      if (error instanceof ResponsePipeValidationError) {
        const serialized = serializeError(error);
        await this.store.failStep(reviewPipeState.id, serialized, serialized.message);
        await this.store.failInstance(instance.instanceId, serialized);
      }
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

  private async findTriggerForStep(instanceId: string, stepKey: string, status: WorkflowScopedTriggerReadModel['status']): Promise<WorkflowScopedTriggerReadModel | null> {
    const triggers = await this.store.listTriggers({ instanceId, status, limit: 100 });
    return triggers.triggers.find((trigger) => trigger.stepKey === stepKey) ?? null;
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

function findWaitStepAfter(definition: DeclarativeWorkflowDefinition, afterStepId: string): DeclarativeWaitForNextCompletedResponseStep {
  const step = definition.steps.find((entry): entry is DeclarativeWaitForNextCompletedResponseStep => entry.type === 'wait_for_next_completed_response' && entry.after === afterStepId);
  if (!step) throw new DeclarativeWorkflowRuntimeError(`Definition ${definition.id} is missing wait step after ${afterStepId}`);
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

function renderPipeTemplateForResponsePipe(template: string, input: Record<string, string>): string {
  return renderTemplate(template, input).replace(/{{\s*source\.response\s*}}/g, '{{source_response}}');
}

function renderNotificationTemplate(
  template: string,
  input: Record<string, string>,
  instanceId: string,
  source: { stepId: string; response: AgentResponse },
  review: { stepId: string; response: AgentResponse },
): string {
  const rendered = renderTemplate(template, input)
    .replace(new RegExp(`{{\\s*responses\\.${escapeRegExp(source.stepId)}\\s*}}`, 'g'), source.response.content ?? '')
    .replace(new RegExp(`{{\\s*responses\\.${escapeRegExp(review.stepId)}\\s*}}`, 'g'), review.response.content ?? '')
    .replace(/{{\s*instance\.id\s*}}/g, instanceId);
  const truncationNotes = [
    source.response.truncated ? `Source response was truncated at ${source.response.max_chars} chars; inspect VK session ${source.response.session_id} / execution ${source.response.execution_process_id} for full context.` : null,
    review.response.truncated ? `Review response was truncated at ${review.response.max_chars} chars; inspect VK session ${review.response.session_id} / execution ${review.response.execution_process_id} for full context.` : null,
  ].filter(Boolean);
  return [
    rendered,
    '',
    'Workflow refs:',
    `- Instance: ${instanceId}`,
    `- Source session: ${source.response.session_id}`,
    `- Source execution: ${source.response.execution_process_id}`,
    `- Review session: ${review.response.session_id}`,
    `- Review execution: ${review.response.execution_process_id}`,
    ...(truncationNotes.length > 0 ? ['', 'Truncation notes:', ...truncationNotes] : []),
  ].join('\n');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function renderCompleteSummary(template: string | null | undefined, input: Record<string, string>): string | null {
  return template ? renderTemplate(template, input) : null;
}

function responseRef(response: AgentResponse): Record<string, unknown> {
  const content = response.content ?? '';
  return {
    executionProcessId: response.execution_process_id,
    sessionId: response.session_id,
    workspaceId: response.workspace_id,
    completedAt: response.completed_at,
    codingAgentTurnId: response.coding_agent_turn_id,
    agentSessionId: response.agent_session_id,
    agentMessageId: response.agent_message_id,
    truncated: response.truncated,
    maxChars: response.max_chars,
    sourceKind: response.source_kind,
    contentHash: sha256(content),
    contentLength: content.length,
  };
}

function notificationDedupe(instance: WorkflowInstanceReadModel, notifyStep: DeclarativeNotifyOverseerStep, overseerSessionId: string): { templateHash: string; dedupeKey: string } {
  const templateHash = sha256(notifyStep.template);
  return {
    templateHash,
    dedupeKey: sha256(JSON.stringify({
      workflowInstanceId: instance.instanceId,
      notifyStepId: notifyStep.id,
      overseerSessionId,
      templateHash,
    })),
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function requireStepState(steps: WorkflowStepStateReadModel[], stepKey: string): WorkflowStepStateReadModel {
  const step = steps.find((entry) => entry.stepKey === stepKey);
  if (!step) throw new DeclarativeWorkflowRuntimeError(`Missing workflow step state ${stepKey}`);
  return step;
}

function readResolvedRoles(value: unknown): Record<string, DeclarativeWorkflowResolvedRole> {
  const record = asRecord(value, 'resolved roles output');
  return asRecord(record.roles, 'resolved roles');
}

function readResponseStepOutput(value: unknown): { executionProcessId: string } {
  const record = asRecord(value, 'response step output');
  return { executionProcessId: readStringField(record, 'executionProcessId') };
}

function asRecord(value: unknown, label: string): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new DeclarativeWorkflowRuntimeError(`${label} must be an object`);
  }
  return value as Record<string, any>;
}

function asOptionalRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : null;
}

function readStringField(record: Record<string, any>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || !value) throw new DeclarativeWorkflowRuntimeError(`${key} must be a non-empty string`);
  return value;
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

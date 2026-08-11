import type { Kysely, Selectable } from 'kysely';
import type {
  DB,
  WorkflowAttentionItem,
  WorkflowAttentionItemKind,
  WorkflowAttentionItemStatus,
  WorkflowInstance,
  WorkflowInstanceStatus,
  WorkflowScopedTrigger,
  WorkflowScopedTriggerMode,
  WorkflowScopedTriggerStatus,
  WorkflowScopedTriggerType,
  WorkflowStepState,
  WorkflowStepStateStatus,
} from '../store/kysely_types';

export type JsonValue = unknown;

export interface WorkflowInstanceReadModel {
  instanceId: string;
  workflowId: string;
  templateId: string | null;
  templateVersion: number | null;
  teamId: string | null;
  laneId: string | null;
  status: WorkflowInstanceStatus;
  trigger: string;
  input: JsonValue;
  state: JsonValue;
  currentStepId: string | null;
  latestRunId: string | null;
  pauseRequestedAt: number | null;
  cancelRequestedAt: number | null;
  version: number;
  leaseOwner: string | null;
  leaseExpiresAt: number | null;
  error: JsonValue | null;
  createdAt: number;
  updatedAt: number;
}

export interface WorkflowStepStateReadModel {
  id: string;
  instanceId: string;
  stepKey: string;
  status: WorkflowStepStateStatus;
  attemptCount: number;
  lastRunId: string | null;
  blockedReason: string | null;
  waitingTriggerId: string | null;
  input: JsonValue | null;
  output: JsonValue | null;
  error: JsonValue | null;
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
  type: WorkflowScopedTriggerType;
  status: WorkflowScopedTriggerStatus;
  roleId: string | null;
  laneId: string | null;
  workspaceId: string | null;
  sessionId: string | null;
  mode: WorkflowScopedTriggerMode;
  cursorCompletedAt: number | null;
  cursorExecutionProcessId: string | null;
  sourceExecutionProcessId: string | null;
  expectedQueueItemId: string | null;
  timeoutAt: number | null;
  satisfiedByExecutionProcessId: string | null;
  satisfiedBy: JsonValue | null;
  createdAt: number;
  updatedAt: number;
  satisfiedAt: number | null;
  expiredAt: number | null;
  cancelledAt: number | null;
}

export interface WorkflowInstanceListFilters {
  workflowId?: string;
  status?: WorkflowInstanceStatus;
  teamId?: string;
  laneId?: string;
  limit?: number;
  offset?: number;
}

export interface WorkflowTriggerListFilters {
  instanceId?: string;
  status?: WorkflowScopedTriggerStatus;
  workspaceId?: string;
  sessionId?: string;
  limit?: number;
  offset?: number;
}

export interface WorkflowInstanceListResult {
  instances: WorkflowInstanceReadModel[];
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface WorkflowTriggerListResult {
  triggers: WorkflowScopedTriggerReadModel[];
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface WorkflowTriggerResumeResult {
  applied: boolean;
  reason: 'applied' | 'trigger_not_active' | 'instance_not_waiting' | 'external_wait_active';
  trigger: WorkflowScopedTriggerReadModel;
  instance: WorkflowInstanceReadModel | null;
  step: WorkflowStepStateReadModel | null;
}

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
  formSchema: JsonValue | null;
  resolution: JsonValue | null;
  createdAt: number;
  updatedAt: number;
  resolvedAt: number | null;
  cancelledAt: number | null;
}

export interface WorkflowAttentionListFilters {
  status?: WorkflowAttentionItemStatus;
  teamId?: string;
  laneId?: string;
  instanceId?: string;
  limit?: number;
  offset?: number;
}

export interface WorkflowAttentionListResult {
  items: WorkflowAttentionItemReadModel[];
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface CreateHumanAttentionInput {
  attentionItemId: string;
  instanceId: string;
  stepStateId: string;
  stepKey: string;
  stateVisitId: string;
  idempotencyKey: string;
  title: string;
  description?: string | null;
  stateId?: string | null;
  presentationUrl?: string | null;
  formRef?: string | null;
  formSchema?: JsonValue | null;
}

export interface CompleteHumanAttentionInput {
  attentionItemId: string;
  stateVisitId?: string | null;
  submission: JsonValue;
}

export type CompleteHumanAttentionReason =
  | 'applied'
  | 'attention_not_active'
  | 'instance_not_waiting'
  | 'stale_state_visit'
  | 'invalid_submission';

export interface CompleteHumanAttentionResult {
  applied: boolean;
  reason: CompleteHumanAttentionReason;
  attention: WorkflowAttentionItemReadModel;
  instance: WorkflowInstanceReadModel | null;
  step: WorkflowStepStateReadModel | null;
  validationErrors: Array<{ path: string; message: string }>;
}

export interface CreateWorkflowInstanceInput {
  instanceId: string;
  workflowId: string;
  trigger: string;
  templateId?: string | null;
  templateVersion?: number | null;
  teamId?: string | null;
  laneId?: string | null;
  input?: JsonValue;
  state?: JsonValue;
  currentStepId?: string | null;
  latestRunId?: string | null;
}

export interface CreateWorkflowStepStateInput {
  id: string;
  instanceId: string;
  stepKey: string;
  status?: WorkflowStepStateStatus;
  attemptCount?: number;
  lastRunId?: string | null;
  blockedReason?: string | null;
  waitingTriggerId?: string | null;
  input?: JsonValue | null;
  output?: JsonValue | null;
  error?: JsonValue | null;
  startedAt?: number | null;
  completedAt?: number | null;
}

export interface CreateWorkflowScopedTriggerInput {
  triggerId: string;
  instanceId: string;
  stepStateId?: string | null;
  stepKey?: string | null;
  type?: WorkflowScopedTriggerType;
  roleId?: string | null;
  laneId?: string | null;
  workspaceId?: string | null;
  sessionId?: string | null;
  mode: WorkflowScopedTriggerMode;
  cursorCompletedAt?: number | null;
  cursorExecutionProcessId?: string | null;
  sourceExecutionProcessId?: string | null;
  expectedQueueItemId?: string | null;
  timeoutAt?: number | null;
}

export interface CompletePipeHandoffInput {
  instanceId: string;
  pipeStepStateId: string;
  waitStepStateId: string;
  waitStepKey: string;
  pipeOutput: JsonValue;
  trigger: CreateWorkflowScopedTriggerInput;
  workflowCoreSnapshot?: JsonValue;
}

export interface CompleteWorkflowNotificationInput {
  instanceId: string;
  notifyStepStateId: string;
  notifyOutput: JsonValue;
  completeStepStateId?: string | null;
  completeOutput?: JsonValue;
  finalState: JsonValue;
  latestRunId?: string | null;
}

export class WorkflowOrchestrationTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkflowOrchestrationTransitionError';
  }
}

const DEFAULT_INSTANCE_LIMIT = 50;
const MAX_INSTANCE_LIMIT = 100;
const DEFAULT_TRIGGER_LIMIT = 50;
const MAX_TRIGGER_LIMIT = 200;
const DEFAULT_ATTENTION_LIMIT = 50;
const MAX_ATTENTION_LIMIT = 200;
const ACTIVE_INSTANCE_STATUSES: WorkflowInstanceStatus[] = ['running', 'waiting'];
const CANCELLABLE_INSTANCE_STATUSES: WorkflowInstanceStatus[] = ['created', 'running', 'waiting', 'paused'];
const PAUSABLE_INSTANCE_STATUSES: WorkflowInstanceStatus[] = ['created', 'running', 'waiting'];
const FAILABLE_INSTANCE_STATUSES: WorkflowInstanceStatus[] = ['created', 'running', 'waiting', 'paused'];
const COMPLETABLE_INSTANCE_STATUSES: WorkflowInstanceStatus[] = ['running', 'waiting'];

export class DbWorkflowOrchestrationStore {
  private readonly getDbHandle: () => Promise<Kysely<DB>> | Kysely<DB>;
  private readonly now: () => number;

  constructor(options: { db?: Kysely<DB>; getDb?: () => Promise<Kysely<DB>> | Kysely<DB>; now?: () => number }) {
    if (!options.db && !options.getDb) {
      throw new Error('DbWorkflowOrchestrationStore requires db or getDb');
    }
    this.getDbHandle = options.getDb ?? (() => options.db as Kysely<DB>);
    this.now = options.now ?? Date.now;
  }

  async createInstance(input: CreateWorkflowInstanceInput): Promise<WorkflowInstanceReadModel> {
    const db = await this.getDb();
    const now = this.now();
    await db
      .insertInto('WorkflowInstance')
      .values({
        instanceId: input.instanceId,
        workflowId: input.workflowId,
        templateId: input.templateId ?? null,
        templateVersion: input.templateVersion ?? null,
        teamId: input.teamId ?? null,
        laneId: input.laneId ?? null,
        status: 'created',
        trigger: input.trigger,
        inputJson: serializeJson(input.input ?? {}),
        stateJson: serializeJson(input.state ?? {}),
        currentStepId: input.currentStepId ?? null,
        latestRunId: input.latestRunId ?? null,
        pauseRequestedAt: null,
        cancelRequestedAt: null,
        version: 1,
        leaseOwner: null,
        leaseExpiresAt: null,
        errorJson: null,
        createdAt: now,
        updatedAt: now,
      })
      .execute();
    return this.getRequiredInstance(input.instanceId);
  }

  async startInstance(instanceId: string, args: { currentStepId?: string | null; latestRunId?: string | null; expectedVersion?: number } = {}): Promise<WorkflowInstanceReadModel> {
    await this.updateInstanceStatus(instanceId, ['created'], 'running', {
      currentStepId: args.currentStepId,
      latestRunId: args.latestRunId,
      expectedVersion: args.expectedVersion,
    });
    return this.getRequiredInstance(instanceId);
  }

  async markInstanceWaiting(instanceId: string, args: { currentStepId: string; waitingTriggerId?: string | null; workflowCoreSnapshot?: JsonValue; expectedVersion?: number }): Promise<WorkflowInstanceReadModel> {
    const db = await this.getDb();
    const now = this.now();
    await db.transaction().execute(async (trx) => {
      const existingInstance = args.workflowCoreSnapshot !== undefined
        ? await trx
            .selectFrom('WorkflowInstance')
            .select(['stateJson'])
            .where('instanceId', '=', instanceId)
            .executeTakeFirst()
        : null;
      let instanceQuery = trx
        .updateTable('WorkflowInstance')
        .set((eb) => ({
          status: 'waiting' as const,
          currentStepId: args.currentStepId,
          ...(args.workflowCoreSnapshot !== undefined ? { stateJson: serializeJson(mergeWorkflowCoreSnapshotJson(existingInstance?.stateJson, args.workflowCoreSnapshot)) } : {}),
          updatedAt: now,
          version: eb('version', '+', 1),
        }))
        .where('instanceId', '=', instanceId)
        .where('status', '=', 'running');
      if (args.expectedVersion != null) {
        instanceQuery = instanceQuery.where('version', '=', args.expectedVersion);
      }
      await assertUpdated(
        instanceQuery.executeTakeFirst(),
        `Cannot mark workflow instance ${instanceId} waiting from its current state`,
      );

      await assertUpdated(
        trx
          .updateTable('WorkflowStepState')
          .set({
            status: 'waiting',
            waitingTriggerId: args.waitingTriggerId ?? null,
            updatedAt: now,
          })
          .where('instanceId', '=', instanceId)
          .where('stepKey', '=', args.currentStepId)
          .where('status', '=', 'running')
          .executeTakeFirst(),
        `Cannot mark workflow step ${args.currentStepId} waiting from its current state`,
      );
    });

    return this.getRequiredInstance(instanceId);
  }

  async pauseInstance(instanceId: string, expectedVersion?: number): Promise<WorkflowInstanceReadModel> {
    const now = this.now();
    await this.updateInstanceStatus(instanceId, PAUSABLE_INSTANCE_STATUSES, 'paused', {
      pauseRequestedAt: now,
      expectedVersion,
    });
    return this.getRequiredInstance(instanceId);
  }

  async resumeInstance(instanceId: string, expectedVersion?: number): Promise<WorkflowInstanceReadModel> {
    await this.updateInstanceStatus(instanceId, ['paused'], 'running', {
      pauseRequestedAt: null,
      expectedVersion,
    });
    return this.getRequiredInstance(instanceId);
  }

  async cancelInstance(instanceId: string, expectedVersion?: number): Promise<WorkflowInstanceReadModel> {
    const now = this.now();
    await this.updateInstanceStatus(instanceId, CANCELLABLE_INSTANCE_STATUSES, 'cancelled', {
      cancelRequestedAt: now,
      expectedVersion,
    });
    await this.cancelActiveTriggersForInstance(instanceId, now);
    await this.cancelActiveAttentionForInstance(instanceId, now);
    return this.getRequiredInstance(instanceId);
  }

  async completeInstance(instanceId: string, args: { state?: JsonValue; latestRunId?: string | null; expectedVersion?: number } = {}): Promise<WorkflowInstanceReadModel> {
    await this.updateInstanceStatus(instanceId, COMPLETABLE_INSTANCE_STATUSES, 'completed', {
      state: args.state,
      latestRunId: args.latestRunId,
      expectedVersion: args.expectedVersion,
    });
    await this.cancelActiveAttentionForInstance(instanceId, this.now());
    return this.getRequiredInstance(instanceId);
  }

  async failInstance(instanceId: string, error: JsonValue, expectedVersion?: number): Promise<WorkflowInstanceReadModel> {
    await this.updateInstanceStatus(instanceId, FAILABLE_INSTANCE_STATUSES, 'failed', {
      error,
      expectedVersion,
    });
    await this.cancelActiveAttentionForInstance(instanceId, this.now());
    return this.getRequiredInstance(instanceId);
  }

  async updateWorkflowCoreSnapshot(instanceId: string, snapshot: JsonValue, expectedVersion?: number): Promise<WorkflowInstanceReadModel> {
    const db = await this.getDb();
    const now = this.now();
    await db.transaction().execute(async (trx) => {
      const existing = await trx
        .selectFrom('WorkflowInstance')
        .select(['stateJson', 'version'])
        .where('instanceId', '=', instanceId)
        .executeTakeFirst();
      if (!existing) throw new Error(`Workflow instance ${instanceId} not found`);
      if (expectedVersion != null && existing.version !== expectedVersion) {
        throw new WorkflowOrchestrationTransitionError(`Cannot update workflow instance ${instanceId} workflow core snapshot from stale version`);
      }
      await assertUpdated(
        trx
          .updateTable('WorkflowInstance')
          .set((eb) => ({
            stateJson: serializeJson(mergeWorkflowCoreSnapshotJson(existing.stateJson, snapshot)),
            updatedAt: now,
            version: eb('version', '+', 1),
          }))
          .where('instanceId', '=', instanceId)
          .executeTakeFirst(),
        `Cannot update workflow instance ${instanceId} workflow core snapshot`,
      );
    });
    return this.getRequiredInstance(instanceId);
  }

  async createStepState(input: CreateWorkflowStepStateInput): Promise<WorkflowStepStateReadModel> {
    const db = await this.getDb();
    const now = this.now();
    await db
      .insertInto('WorkflowStepState')
      .values({
        id: input.id,
        instanceId: input.instanceId,
        stepKey: input.stepKey,
        status: input.status ?? 'pending',
        attemptCount: input.attemptCount ?? 0,
        lastRunId: input.lastRunId ?? null,
        blockedReason: input.blockedReason ?? null,
        waitingTriggerId: input.waitingTriggerId ?? null,
        inputJson: input.input == null ? null : serializeJson(input.input),
        outputJson: input.output == null ? null : serializeJson(input.output),
        errorJson: input.error == null ? null : serializeJson(input.error),
        startedAt: input.startedAt ?? null,
        completedAt: input.completedAt ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .execute();
    return this.getRequiredStepState(input.id);
  }

  async markStepRunning(id: string): Promise<WorkflowStepStateReadModel> {
    const now = this.now();
    await this.updateStepStatus(id, ['pending', 'blocked'], 'running', { startedAt: now, incrementAttemptCount: true });
    return this.getRequiredStepState(id);
  }

  async markStepWaiting(id: string, waitingTriggerId: string): Promise<WorkflowStepStateReadModel> {
    await this.updateStepStatus(id, ['running'], 'waiting', { waitingTriggerId });
    return this.getRequiredStepState(id);
  }

  async completeStep(id: string, output: JsonValue): Promise<WorkflowStepStateReadModel> {
    const now = this.now();
    await this.updateStepStatus(id, ['running', 'waiting'], 'completed', { output, completedAt: now });
    return this.getRequiredStepState(id);
  }

  async failStep(id: string, error: JsonValue, blockedReason?: string): Promise<WorkflowStepStateReadModel> {
    await this.updateStepStatus(id, ['pending', 'running', 'waiting', 'blocked'], 'failed', { error, blockedReason });
    return this.getRequiredStepState(id);
  }

  async createScopedTrigger(input: CreateWorkflowScopedTriggerInput): Promise<WorkflowScopedTriggerReadModel> {
    const db = await this.getDb();
    const now = this.now();
    await db
      .insertInto('WorkflowScopedTrigger')
      .values({
        triggerId: input.triggerId,
        instanceId: input.instanceId,
        stepStateId: input.stepStateId ?? null,
        stepKey: input.stepKey ?? null,
        type: input.type ?? 'session_response',
        status: 'active',
        roleId: input.roleId ?? null,
        laneId: input.laneId ?? null,
        workspaceId: input.workspaceId ?? null,
        sessionId: input.sessionId ?? null,
        mode: input.mode,
        cursorCompletedAt: input.cursorCompletedAt ?? null,
        cursorExecutionProcessId: input.cursorExecutionProcessId ?? null,
        sourceExecutionProcessId: input.sourceExecutionProcessId ?? null,
        expectedQueueItemId: input.expectedQueueItemId ?? null,
        timeoutAt: input.timeoutAt ?? null,
        satisfiedByExecutionProcessId: null,
        satisfiedByJson: null,
        createdAt: now,
        updatedAt: now,
        satisfiedAt: null,
        expiredAt: null,
        cancelledAt: null,
      })
      .execute();
    return this.getRequiredTrigger(input.triggerId);
  }

  async satisfyScopedTrigger(triggerId: string, args: { executionProcessId: string; response?: JsonValue }): Promise<WorkflowScopedTriggerReadModel> {
    const db = await this.getDb();
    const now = this.now();
    await assertUpdated(
      db
        .updateTable('WorkflowScopedTrigger')
        .set({
          status: 'satisfied',
          satisfiedByExecutionProcessId: args.executionProcessId,
          satisfiedByJson: args.response == null ? null : serializeJson(args.response),
          satisfiedAt: now,
          updatedAt: now,
        })
        .where('triggerId', '=', triggerId)
        .where('status', '=', 'active')
        .executeTakeFirst(),
      `Cannot satisfy scoped trigger ${triggerId} from its current state`,
    );
    return this.getRequiredTrigger(triggerId);
  }

  async satisfyScopedTriggerAndResumeWaitingStep(
    triggerId: string,
    args: { executionProcessId: string; response?: JsonValue },
  ): Promise<WorkflowTriggerResumeResult> {
    const db = await this.getDb();
    const now = this.now();
    let result: WorkflowTriggerResumeResult | undefined;

    await db.transaction().execute(async (trx) => {
      const triggerRow = await trx
        .selectFrom('WorkflowScopedTrigger')
        .selectAll()
        .where('triggerId', '=', triggerId)
        .executeTakeFirst();
      if (!triggerRow) throw new Error(`Workflow scoped trigger ${triggerId} not found`);
      const trigger = mapTrigger(triggerRow);

      const instanceRow = await trx
        .selectFrom('WorkflowInstance')
        .selectAll()
        .where('instanceId', '=', trigger.instanceId)
        .executeTakeFirst();
      const instance = instanceRow ? mapInstance(instanceRow) : null;

      const stepRow = trigger.stepStateId
        ? await trx
            .selectFrom('WorkflowStepState')
            .selectAll()
            .where('id', '=', trigger.stepStateId)
            .executeTakeFirst()
        : trigger.stepKey
          ? await trx
              .selectFrom('WorkflowStepState')
              .selectAll()
              .where('instanceId', '=', trigger.instanceId)
              .where('stepKey', '=', trigger.stepKey)
              .executeTakeFirst()
          : null;
      const step = stepRow ? mapStepState(stepRow) : null;

      if (trigger.status !== 'active') {
        result = { applied: false, reason: 'trigger_not_active', trigger, instance, step };
        return;
      }
      if (instance?.status !== 'waiting') {
        result = { applied: false, reason: 'instance_not_waiting', trigger, instance, step };
        return;
      }
      if (trigger.workspaceId && trigger.sessionId) {
        const activeExternalWait = await trx
          .selectFrom('WorkflowExternalWait')
          .select(['waitId'])
          .where('status', '=', 'active')
          .where('workspaceId', '=', trigger.workspaceId)
          .where('sessionId', '=', trigger.sessionId)
          .executeTakeFirst();
        if (activeExternalWait) {
          result = { applied: false, reason: 'external_wait_active', trigger, instance, step };
          return;
        }
      }
      if (!step) {
        throw new WorkflowOrchestrationTransitionError(
          `Cannot satisfy scoped trigger ${triggerId}: waiting step is missing`,
        );
      }

      await assertUpdated(
        trx
          .updateTable('WorkflowScopedTrigger')
          .set({
            status: 'satisfied',
            satisfiedByExecutionProcessId: args.executionProcessId,
            satisfiedByJson: args.response == null ? null : serializeJson(args.response),
            satisfiedAt: now,
            updatedAt: now,
          })
          .where('triggerId', '=', triggerId)
          .where('status', '=', 'active')
          .executeTakeFirst(),
        `Cannot satisfy scoped trigger ${triggerId} from its current state`,
      );

      await assertUpdated(
        trx
          .updateTable('WorkflowStepState')
          .set({
            status: 'completed',
            waitingTriggerId: null,
            outputJson: args.response == null ? null : serializeJson(args.response),
            completedAt: now,
            updatedAt: now,
          })
          .where('id', '=', step.id)
          .where('instanceId', '=', trigger.instanceId)
          .where('status', '=', 'waiting')
          .where('waitingTriggerId', '=', triggerId)
          .executeTakeFirst(),
        `Cannot complete workflow step ${step.id} for scoped trigger ${triggerId} from its current state`,
      );

      await assertUpdated(
        trx
          .updateTable('WorkflowInstance')
          .set((eb) => ({
            status: 'running' as const,
            latestRunId: args.executionProcessId,
            updatedAt: now,
            version: eb('version', '+', 1),
          }))
          .where('instanceId', '=', trigger.instanceId)
          .where('status', '=', 'waiting')
          .executeTakeFirst(),
        `Cannot resume workflow instance ${trigger.instanceId} from its current state`,
      );

      const [updatedTriggerRow, updatedInstanceRow, updatedStepRow] = await Promise.all([
        trx.selectFrom('WorkflowScopedTrigger').selectAll().where('triggerId', '=', triggerId).executeTakeFirstOrThrow(),
        trx.selectFrom('WorkflowInstance').selectAll().where('instanceId', '=', trigger.instanceId).executeTakeFirstOrThrow(),
        trx.selectFrom('WorkflowStepState').selectAll().where('id', '=', step.id).executeTakeFirstOrThrow(),
      ]);
      result = {
        applied: true,
        reason: 'applied',
        trigger: mapTrigger(updatedTriggerRow),
        instance: mapInstance(updatedInstanceRow),
        step: mapStepState(updatedStepRow),
      };
    });

    return result ?? {
      applied: false,
      reason: 'trigger_not_active',
      trigger: await this.getRequiredTrigger(triggerId),
      instance: null,
      step: null,
    };
  }

  async completePipeHandoffAndWait(input: CompletePipeHandoffInput): Promise<{ trigger: WorkflowScopedTriggerReadModel; instance: WorkflowInstanceReadModel; pipeStep: WorkflowStepStateReadModel; waitStep: WorkflowStepStateReadModel }> {
    const db = await this.getDb();
    const now = this.now();
    let result:
      | { trigger: WorkflowScopedTriggerReadModel; instance: WorkflowInstanceReadModel; pipeStep: WorkflowStepStateReadModel; waitStep: WorkflowStepStateReadModel }
      | undefined;

    await db.transaction().execute(async (trx) => {
      await assertUpdated(
        trx
          .updateTable('WorkflowStepState')
          .set({
            status: 'completed',
            outputJson: serializeJson(input.pipeOutput),
            completedAt: now,
            updatedAt: now,
          })
          .where('id', '=', input.pipeStepStateId)
          .where('instanceId', '=', input.instanceId)
          .where('status', '=', 'running')
          .executeTakeFirst(),
        `Cannot complete workflow pipe step ${input.pipeStepStateId} from its current state`,
      );

      await assertUpdated(
        trx
          .updateTable('WorkflowStepState')
          .set({
            status: 'waiting',
            waitingTriggerId: input.trigger.triggerId,
            startedAt: now,
            updatedAt: now,
          })
          .where('id', '=', input.waitStepStateId)
          .where('instanceId', '=', input.instanceId)
          .where('stepKey', '=', input.waitStepKey)
          .where('status', 'in', ['pending', 'running'])
          .executeTakeFirst(),
        `Cannot mark workflow wait step ${input.waitStepStateId} waiting from its current state`,
      );

      await trx
        .insertInto('WorkflowScopedTrigger')
        .values({
          triggerId: input.trigger.triggerId,
          instanceId: input.instanceId,
          stepStateId: input.trigger.stepStateId ?? input.waitStepStateId,
          stepKey: input.trigger.stepKey ?? input.waitStepKey,
          type: input.trigger.type ?? 'session_response',
          status: 'active',
          roleId: input.trigger.roleId ?? null,
          laneId: input.trigger.laneId ?? null,
          workspaceId: input.trigger.workspaceId ?? null,
          sessionId: input.trigger.sessionId ?? null,
          mode: input.trigger.mode,
          cursorCompletedAt: input.trigger.cursorCompletedAt ?? null,
          cursorExecutionProcessId: input.trigger.cursorExecutionProcessId ?? null,
          sourceExecutionProcessId: input.trigger.sourceExecutionProcessId ?? null,
          expectedQueueItemId: input.trigger.expectedQueueItemId ?? null,
          timeoutAt: input.trigger.timeoutAt ?? null,
          satisfiedByExecutionProcessId: null,
          satisfiedByJson: null,
          createdAt: now,
          updatedAt: now,
          satisfiedAt: null,
          expiredAt: null,
          cancelledAt: null,
        })
        .execute();

      const instanceRowForCoreState = input.workflowCoreSnapshot !== undefined
        ? await trx
            .selectFrom('WorkflowInstance')
            .select(['stateJson'])
            .where('instanceId', '=', input.instanceId)
            .executeTakeFirst()
        : null;

      await assertUpdated(
        trx
          .updateTable('WorkflowInstance')
          .set((eb) => ({
            status: 'waiting' as const,
            currentStepId: input.waitStepKey,
            ...(input.workflowCoreSnapshot !== undefined ? { stateJson: serializeJson(mergeWorkflowCoreSnapshotJson(instanceRowForCoreState?.stateJson, input.workflowCoreSnapshot)) } : {}),
            updatedAt: now,
            version: eb('version', '+', 1),
          }))
          .where('instanceId', '=', input.instanceId)
          .where('status', '=', 'running')
          .executeTakeFirst(),
        `Cannot mark workflow instance ${input.instanceId} waiting from its current state`,
      );

      const [triggerRow, instanceRow, pipeStepRow, waitStepRow] = await Promise.all([
        trx.selectFrom('WorkflowScopedTrigger').selectAll().where('triggerId', '=', input.trigger.triggerId).executeTakeFirstOrThrow(),
        trx.selectFrom('WorkflowInstance').selectAll().where('instanceId', '=', input.instanceId).executeTakeFirstOrThrow(),
        trx.selectFrom('WorkflowStepState').selectAll().where('id', '=', input.pipeStepStateId).executeTakeFirstOrThrow(),
        trx.selectFrom('WorkflowStepState').selectAll().where('id', '=', input.waitStepStateId).executeTakeFirstOrThrow(),
      ]);
      result = {
        trigger: mapTrigger(triggerRow),
        instance: mapInstance(instanceRow),
        pipeStep: mapStepState(pipeStepRow),
        waitStep: mapStepState(waitStepRow),
      };
    });

    if (!result) throw new WorkflowOrchestrationTransitionError(`Cannot complete pipe handoff for workflow instance ${input.instanceId}`);
    return result;
  }

  async completeWorkflowAfterNotification(input: CompleteWorkflowNotificationInput): Promise<{ instance: WorkflowInstanceReadModel; notifyStep: WorkflowStepStateReadModel; completeStep: WorkflowStepStateReadModel | null }> {
    const db = await this.getDb();
    const now = this.now();
    let result: { instance: WorkflowInstanceReadModel; notifyStep: WorkflowStepStateReadModel; completeStep: WorkflowStepStateReadModel | null } | undefined;

    await db.transaction().execute(async (trx) => {
      await assertUpdated(
        trx
          .updateTable('WorkflowStepState')
          .set({
            status: 'completed',
            outputJson: serializeJson(input.notifyOutput),
            completedAt: now,
            updatedAt: now,
          })
          .where('id', '=', input.notifyStepStateId)
          .where('instanceId', '=', input.instanceId)
          .where('status', 'in', ['pending', 'running'])
          .executeTakeFirst(),
        `Cannot complete workflow notify step ${input.notifyStepStateId} from its current state`,
      );

      if (input.completeStepStateId) {
        await assertUpdated(
          trx
            .updateTable('WorkflowStepState')
            .set({
              status: 'completed',
              outputJson: input.completeOutput === undefined ? null : serializeJson(input.completeOutput),
              startedAt: now,
              completedAt: now,
              updatedAt: now,
            })
            .where('id', '=', input.completeStepStateId)
            .where('instanceId', '=', input.instanceId)
            .where('status', '=', 'pending')
            .executeTakeFirst(),
          `Cannot complete workflow final step ${input.completeStepStateId} from its current state`,
        );
      }

      await assertUpdated(
        trx
          .updateTable('WorkflowInstance')
          .set((eb) => ({
            status: 'completed' as const,
            stateJson: serializeJson(input.finalState),
            latestRunId: input.latestRunId ?? null,
            updatedAt: now,
            version: eb('version', '+', 1),
          }))
          .where('instanceId', '=', input.instanceId)
          .where('status', '=', 'running')
          .executeTakeFirst(),
        `Cannot complete workflow instance ${input.instanceId} from its current state`,
      );

      const [instanceRow, notifyStepRow, completeStepRow] = await Promise.all([
        trx.selectFrom('WorkflowInstance').selectAll().where('instanceId', '=', input.instanceId).executeTakeFirstOrThrow(),
        trx.selectFrom('WorkflowStepState').selectAll().where('id', '=', input.notifyStepStateId).executeTakeFirstOrThrow(),
        input.completeStepStateId
          ? trx.selectFrom('WorkflowStepState').selectAll().where('id', '=', input.completeStepStateId).executeTakeFirst()
          : Promise.resolve(null),
      ]);
      result = { instance: mapInstance(instanceRow), notifyStep: mapStepState(notifyStepRow), completeStep: completeStepRow ? mapStepState(completeStepRow) : null };
    });

    if (!result) throw new WorkflowOrchestrationTransitionError(`Cannot complete workflow instance ${input.instanceId} after notification`);
    return result;
  }

  async expireScopedTrigger(triggerId: string): Promise<WorkflowScopedTriggerReadModel> {
    const db = await this.getDb();
    const now = this.now();
    await assertUpdated(
      db
        .updateTable('WorkflowScopedTrigger')
        .set({ status: 'expired', expiredAt: now, updatedAt: now })
        .where('triggerId', '=', triggerId)
        .where('status', '=', 'active')
        .executeTakeFirst(),
      `Cannot expire scoped trigger ${triggerId} from its current state`,
    );
    return this.getRequiredTrigger(triggerId);
  }

  async createHumanAttention(input: CreateHumanAttentionInput): Promise<{ item: WorkflowAttentionItemReadModel; created: boolean; instance: WorkflowInstanceReadModel; step: WorkflowStepStateReadModel }> {
    const db = await this.getDb();
    const now = this.now();
    let result: { item: WorkflowAttentionItemReadModel; created: boolean; instance: WorkflowInstanceReadModel; step: WorkflowStepStateReadModel } | undefined;

    await db.transaction().execute(async (trx) => {
      const existing = await trx
        .selectFrom('WorkflowAttentionItem')
        .selectAll()
        .where('idempotencyKey', '=', input.idempotencyKey)
        .executeTakeFirst();
      if (existing) {
        const [instanceRow, stepRow] = await Promise.all([
          trx.selectFrom('WorkflowInstance').selectAll().where('instanceId', '=', existing.instanceId).executeTakeFirstOrThrow(),
          existing.stepStateId
            ? trx.selectFrom('WorkflowStepState').selectAll().where('id', '=', existing.stepStateId).executeTakeFirstOrThrow()
            : trx.selectFrom('WorkflowStepState').selectAll().where('instanceId', '=', existing.instanceId).where('stepKey', '=', existing.stepId).executeTakeFirstOrThrow(),
        ]);
        result = {
          item: mapAttentionItem(existing),
          created: false,
          instance: mapInstance(instanceRow),
          step: mapStepState(stepRow),
        };
        return;
      }

      const instanceRow = await trx
        .selectFrom('WorkflowInstance')
        .selectAll()
        .where('instanceId', '=', input.instanceId)
        .executeTakeFirst();
      if (!instanceRow) throw new Error(`Workflow instance ${input.instanceId} not found`);
      if (instanceRow.status !== 'running') {
        throw new WorkflowOrchestrationTransitionError(`Cannot create human attention item for workflow instance ${input.instanceId} from status ${instanceRow.status}`);
      }

      await assertUpdated(
        trx
          .updateTable('WorkflowStepState')
          .set({
            status: 'waiting',
            blockedReason: 'human_attention_required',
            updatedAt: now,
          })
          .where('id', '=', input.stepStateId)
          .where('instanceId', '=', input.instanceId)
          .where('stepKey', '=', input.stepKey)
          .where('status', '=', 'running')
          .executeTakeFirst(),
        `Cannot mark human workflow step ${input.stepStateId} waiting from its current state`,
      );

      await trx
        .insertInto('WorkflowAttentionItem')
        .values({
          attentionItemId: input.attentionItemId,
          instanceId: input.instanceId,
          stepStateId: input.stepStateId,
          workflowId: instanceRow.workflowId,
          teamId: instanceRow.teamId,
          laneId: instanceRow.laneId,
          status: 'active',
          kind: 'human_turn',
          title: input.title,
          description: input.description ?? null,
          stateId: input.stateId ?? null,
          stepId: input.stepKey,
          stateVisitId: input.stateVisitId,
          idempotencyKey: input.idempotencyKey,
          presentationUrl: input.presentationUrl ?? null,
          formRef: input.formRef ?? null,
          formSchemaJson: input.formSchema == null ? null : serializeJson(input.formSchema),
          resolutionJson: null,
          createdAt: now,
          updatedAt: now,
          resolvedAt: null,
          cancelledAt: null,
        })
        .execute();

      await assertUpdated(
        trx
          .updateTable('WorkflowInstance')
          .set((eb) => ({
            status: 'waiting' as const,
            currentStepId: input.stepKey,
            updatedAt: now,
            version: eb('version', '+', 1),
          }))
          .where('instanceId', '=', input.instanceId)
          .where('status', '=', 'running')
          .executeTakeFirst(),
        `Cannot mark workflow instance ${input.instanceId} waiting for human attention from its current state`,
      );

      const [itemRow, updatedInstanceRow, updatedStepRow] = await Promise.all([
        trx.selectFrom('WorkflowAttentionItem').selectAll().where('attentionItemId', '=', input.attentionItemId).executeTakeFirstOrThrow(),
        trx.selectFrom('WorkflowInstance').selectAll().where('instanceId', '=', input.instanceId).executeTakeFirstOrThrow(),
        trx.selectFrom('WorkflowStepState').selectAll().where('id', '=', input.stepStateId).executeTakeFirstOrThrow(),
      ]);
      result = {
        item: mapAttentionItem(itemRow),
        created: true,
        instance: mapInstance(updatedInstanceRow),
        step: mapStepState(updatedStepRow),
      };
    });

    if (!result) throw new WorkflowOrchestrationTransitionError(`Cannot create human attention item for workflow instance ${input.instanceId}`);
    return result;
  }

  async completeHumanAttention(input: CompleteHumanAttentionInput): Promise<CompleteHumanAttentionResult> {
    const db = await this.getDb();
    const now = this.now();
    let result: CompleteHumanAttentionResult | undefined;

    await db.transaction().execute(async (trx) => {
      const itemRow = await trx
        .selectFrom('WorkflowAttentionItem')
        .selectAll()
        .where('attentionItemId', '=', input.attentionItemId)
        .executeTakeFirst();
      if (!itemRow) throw new Error(`Workflow attention item ${input.attentionItemId} not found`);

      const instanceRow = await trx
        .selectFrom('WorkflowInstance')
        .selectAll()
        .where('instanceId', '=', itemRow.instanceId)
        .executeTakeFirst();
      const stepRow = itemRow.stepStateId
        ? await trx.selectFrom('WorkflowStepState').selectAll().where('id', '=', itemRow.stepStateId).executeTakeFirst()
        : await trx.selectFrom('WorkflowStepState').selectAll().where('instanceId', '=', itemRow.instanceId).where('stepKey', '=', itemRow.stepId).executeTakeFirst();
      const attention = mapAttentionItem(itemRow);
      const instance = instanceRow ? mapInstance(instanceRow) : null;
      const step = stepRow ? mapStepState(stepRow) : null;

      if (itemRow.status !== 'active') {
        result = { applied: false, reason: 'attention_not_active', attention, instance, step, validationErrors: [] };
        return;
      }
      if (input.stateVisitId && input.stateVisitId !== itemRow.stateVisitId) {
        result = { applied: false, reason: 'stale_state_visit', attention, instance, step, validationErrors: [] };
        return;
      }

      if (instanceRow?.status !== 'waiting' || stepRow?.status !== 'waiting') {
        result = { applied: false, reason: 'instance_not_waiting', attention, instance, step, validationErrors: [] };
        return;
      }

      const validationErrors = validateHumanSubmission(input.submission, attention.formSchema);
      if (validationErrors.length > 0) {
        result = { applied: false, reason: 'invalid_submission', attention, instance, step, validationErrors };
        return;
      }

      const resolution = {
        submittedAt: now,
        submission: input.submission,
      };

      await assertUpdated(
        trx
          .updateTable('WorkflowAttentionItem')
          .set({
            status: 'resolved',
            resolutionJson: serializeJson(resolution),
            resolvedAt: now,
            updatedAt: now,
          })
          .where('attentionItemId', '=', input.attentionItemId)
          .where('status', '=', 'active')
          .executeTakeFirst(),
        `Cannot resolve workflow attention item ${input.attentionItemId} from its current state`,
      );

      await assertUpdated(
        trx
          .updateTable('WorkflowStepState')
          .set({
            status: 'completed',
            outputJson: serializeJson({
              kind: 'human_turn_submission',
              attentionItemId: input.attentionItemId,
              formRef: itemRow.formRef,
              submission: input.submission,
            }),
            completedAt: now,
            updatedAt: now,
          })
          .where('id', '=', stepRow.id)
          .where('instanceId', '=', itemRow.instanceId)
          .where('status', '=', 'waiting')
          .executeTakeFirst(),
        `Cannot complete human workflow step ${stepRow.id} from its current state`,
      );

      await assertUpdated(
        trx
          .updateTable('WorkflowInstance')
          .set((eb) => ({
            status: 'running' as const,
            updatedAt: now,
            version: eb('version', '+', 1),
          }))
          .where('instanceId', '=', itemRow.instanceId)
          .where('status', '=', 'waiting')
          .executeTakeFirst(),
        `Cannot resume workflow instance ${itemRow.instanceId} after human attention from its current state`,
      );

      const [updatedItemRow, updatedInstanceRow, updatedStepRow] = await Promise.all([
        trx.selectFrom('WorkflowAttentionItem').selectAll().where('attentionItemId', '=', input.attentionItemId).executeTakeFirstOrThrow(),
        trx.selectFrom('WorkflowInstance').selectAll().where('instanceId', '=', itemRow.instanceId).executeTakeFirstOrThrow(),
        trx.selectFrom('WorkflowStepState').selectAll().where('id', '=', stepRow.id).executeTakeFirstOrThrow(),
      ]);
      result = {
        applied: true,
        reason: 'applied',
        attention: mapAttentionItem(updatedItemRow),
        instance: mapInstance(updatedInstanceRow),
        step: mapStepState(updatedStepRow),
        validationErrors: [],
      };
    });

    if (!result) throw new WorkflowOrchestrationTransitionError(`Cannot complete workflow attention item ${input.attentionItemId}`);
    return result;
  }

  async listAttentionItems(filters: WorkflowAttentionListFilters = {}): Promise<WorkflowAttentionListResult> {
    const db = await this.getDb();
    const limit = clampLimit(filters.limit, DEFAULT_ATTENTION_LIMIT, MAX_ATTENTION_LIMIT);
    const offset = normalizeOffset(filters.offset);
    let query = db.selectFrom('WorkflowAttentionItem').selectAll();
    if (filters.status) query = query.where('status', '=', filters.status);
    if (filters.teamId) query = query.where('teamId', '=', filters.teamId);
    if (filters.laneId) query = query.where('laneId', '=', filters.laneId);
    if (filters.instanceId) query = query.where('instanceId', '=', filters.instanceId);
    const rows = await query.orderBy('updatedAt', 'desc').orderBy('attentionItemId', 'desc').limit(limit + 1).offset(offset).execute();
    return { items: rows.slice(0, limit).map(mapAttentionItem), limit, offset, hasMore: rows.length > limit };
  }

  async getAttentionItem(attentionItemId: string): Promise<WorkflowAttentionItemReadModel | null> {
    const db = await this.getDb();
    const row = await db.selectFrom('WorkflowAttentionItem').selectAll().where('attentionItemId', '=', attentionItemId).executeTakeFirst();
    return row ? mapAttentionItem(row) : null;
  }

  async listStepStates(instanceId: string): Promise<WorkflowStepStateReadModel[]> {
    const db = await this.getDb();
    const rows = await db
      .selectFrom('WorkflowStepState')
      .selectAll()
      .where('instanceId', '=', instanceId)
      .orderBy('createdAt', 'asc')
      .orderBy('id', 'asc')
      .execute();
    return rows.map(mapStepState);
  }

  async hasActiveExternalWaitForSession(args: { workspaceId: string; sessionId: string; instanceId?: string | null; stepStateId?: string | null }): Promise<boolean> {
    const db = await this.getDb();
    let query = db
      .selectFrom('WorkflowExternalWait')
      .select(['waitId'])
      .where('status', '=', 'active')
      .where('workspaceId', '=', args.workspaceId)
      .where('sessionId', '=', args.sessionId);
    if (args.instanceId) query = query.where('instanceId', '=', args.instanceId);
    if (args.stepStateId) query = query.where('stepStateId', '=', args.stepStateId);
    const row = await query.executeTakeFirst();
    return Boolean(row);
  }

  async listActiveTriggers(now = this.now()): Promise<WorkflowScopedTriggerReadModel[]> {
    const db = await this.getDb();
    const rows = await db
      .selectFrom('WorkflowScopedTrigger')
      .selectAll()
      .where('status', '=', 'active')
      .where((eb) => eb.or([eb('timeoutAt', 'is', null), eb('timeoutAt', '>', now)]))
      .orderBy('createdAt', 'asc')
      .orderBy('triggerId', 'asc')
      .execute();
    return rows.map(mapTrigger);
  }

  async listRecoverableInstances(now = this.now()): Promise<WorkflowInstanceReadModel[]> {
    const db = await this.getDb();
    const rows = await db
      .selectFrom('WorkflowInstance')
      .selectAll()
      .where('status', 'in', ACTIVE_INSTANCE_STATUSES)
      .where((eb) => eb.or([eb('leaseExpiresAt', 'is', null), eb('leaseExpiresAt', '<=', now)]))
      .orderBy('updatedAt', 'asc')
      .orderBy('instanceId', 'asc')
      .execute();
    return rows.map(mapInstance);
  }

  async listInstances(filters: WorkflowInstanceListFilters = {}): Promise<WorkflowInstanceListResult> {
    const db = await this.getDb();
    const limit = clampLimit(filters.limit, DEFAULT_INSTANCE_LIMIT, MAX_INSTANCE_LIMIT);
    const offset = normalizeOffset(filters.offset);
    let query = db.selectFrom('WorkflowInstance').selectAll();
    if (filters.workflowId) query = query.where('workflowId', '=', filters.workflowId);
    if (filters.status) query = query.where('status', '=', filters.status);
    if (filters.teamId) query = query.where('teamId', '=', filters.teamId);
    if (filters.laneId) query = query.where('laneId', '=', filters.laneId);
    const rows = await query.orderBy('updatedAt', 'desc').orderBy('instanceId', 'desc').limit(limit + 1).offset(offset).execute();
    return { instances: rows.slice(0, limit).map(mapInstance), limit, offset, hasMore: rows.length > limit };
  }

  async getInstance(instanceId: string): Promise<WorkflowInstanceReadModel | null> {
    const db = await this.getDb();
    const row = await db.selectFrom('WorkflowInstance').selectAll().where('instanceId', '=', instanceId).executeTakeFirst();
    return row ? mapInstance(row) : null;
  }

  async listTriggers(filters: WorkflowTriggerListFilters = {}): Promise<WorkflowTriggerListResult> {
    const db = await this.getDb();
    const limit = clampLimit(filters.limit, DEFAULT_TRIGGER_LIMIT, MAX_TRIGGER_LIMIT);
    const offset = normalizeOffset(filters.offset);
    let query = db.selectFrom('WorkflowScopedTrigger').selectAll();
    if (filters.instanceId) query = query.where('instanceId', '=', filters.instanceId);
    if (filters.status) query = query.where('status', '=', filters.status);
    if (filters.workspaceId) query = query.where('workspaceId', '=', filters.workspaceId);
    if (filters.sessionId) query = query.where('sessionId', '=', filters.sessionId);
    const rows = await query.orderBy('updatedAt', 'desc').orderBy('triggerId', 'desc').limit(limit + 1).offset(offset).execute();
    return { triggers: rows.slice(0, limit).map(mapTrigger), limit, offset, hasMore: rows.length > limit };
  }

  async getTrigger(triggerId: string): Promise<WorkflowScopedTriggerReadModel | null> {
    const db = await this.getDb();
    const row = await db.selectFrom('WorkflowScopedTrigger').selectAll().where('triggerId', '=', triggerId).executeTakeFirst();
    return row ? mapTrigger(row) : null;
  }

  private async getRequiredInstance(instanceId: string): Promise<WorkflowInstanceReadModel> {
    const instance = await this.getInstance(instanceId);
    if (!instance) throw new Error(`Workflow instance ${instanceId} not found`);
    return instance;
  }

  private async getRequiredStepState(id: string): Promise<WorkflowStepStateReadModel> {
    const db = await this.getDb();
    const row = await db.selectFrom('WorkflowStepState').selectAll().where('id', '=', id).executeTakeFirst();
    if (!row) throw new Error(`Workflow step state ${id} not found`);
    return mapStepState(row);
  }

  private async getRequiredTrigger(triggerId: string): Promise<WorkflowScopedTriggerReadModel> {
    const trigger = await this.getTrigger(triggerId);
    if (!trigger) throw new Error(`Workflow scoped trigger ${triggerId} not found`);
    return trigger;
  }

  private async updateInstanceStatus(
    instanceId: string,
    allowedFrom: WorkflowInstanceStatus[],
    status: WorkflowInstanceStatus,
    args: {
      currentStepId?: string | null;
      latestRunId?: string | null;
      pauseRequestedAt?: number | null;
      cancelRequestedAt?: number | null;
      state?: JsonValue;
      error?: JsonValue;
      expectedVersion?: number;
    } = {},
  ): Promise<void> {
    const db = await this.getDb();
    const now = this.now();
    let query = db
      .updateTable('WorkflowInstance')
      .set((eb) => ({
        status,
        updatedAt: now,
        version: eb('version', '+', 1),
        ...(args.currentStepId !== undefined ? { currentStepId: args.currentStepId } : {}),
        ...(args.latestRunId !== undefined ? { latestRunId: args.latestRunId } : {}),
        ...(args.pauseRequestedAt !== undefined ? { pauseRequestedAt: args.pauseRequestedAt } : {}),
        ...(args.cancelRequestedAt !== undefined ? { cancelRequestedAt: args.cancelRequestedAt } : {}),
        ...(args.state !== undefined ? { stateJson: serializeJson(args.state) } : {}),
        ...(args.error !== undefined ? { errorJson: serializeJson(args.error) } : {}),
      }))
      .where('instanceId', '=', instanceId)
      .where('status', 'in', allowedFrom);
    if (args.expectedVersion != null) query = query.where('version', '=', args.expectedVersion);
    await assertUpdated(query.executeTakeFirst(), `Cannot transition workflow instance ${instanceId} to ${status} from its current state`);
  }

  private async updateStepStatus(
    id: string,
    allowedFrom: WorkflowStepStateStatus[],
    status: WorkflowStepStateStatus,
    args: {
      waitingTriggerId?: string | null;
      output?: JsonValue;
      error?: JsonValue;
      blockedReason?: string | null;
      startedAt?: number | null;
      completedAt?: number | null;
      incrementAttemptCount?: boolean;
    } = {},
  ): Promise<void> {
    const db = await this.getDb();
    const now = this.now();
    await assertUpdated(
      db
        .updateTable('WorkflowStepState')
        .set((eb) => ({
          status,
          updatedAt: now,
          ...(args.waitingTriggerId !== undefined ? { waitingTriggerId: args.waitingTriggerId } : {}),
          ...(args.output !== undefined ? { outputJson: serializeJson(args.output) } : {}),
          ...(args.error !== undefined ? { errorJson: serializeJson(args.error) } : {}),
          ...(args.blockedReason !== undefined ? { blockedReason: args.blockedReason } : {}),
          ...(args.startedAt !== undefined ? { startedAt: args.startedAt } : {}),
          ...(args.completedAt !== undefined ? { completedAt: args.completedAt } : {}),
          ...(args.incrementAttemptCount ? { attemptCount: eb('attemptCount', '+', 1) } : {}),
        }))
        .where('id', '=', id)
        .where('status', 'in', allowedFrom)
        .executeTakeFirst(),
      `Cannot transition workflow step ${id} to ${status} from its current state`,
    );
  }

  private async cancelActiveTriggersForInstance(instanceId: string, now: number): Promise<void> {
    const db = await this.getDb();
    await db
      .updateTable('WorkflowScopedTrigger')
      .set({ status: 'cancelled', cancelledAt: now, updatedAt: now })
      .where('instanceId', '=', instanceId)
      .where('status', '=', 'active')
      .execute();
  }

  private async cancelActiveAttentionForInstance(instanceId: string, now: number): Promise<void> {
    const db = await this.getDb();
    await db
      .updateTable('WorkflowAttentionItem')
      .set({ status: 'cancelled', cancelledAt: now, updatedAt: now })
      .where('instanceId', '=', instanceId)
      .where('status', '=', 'active')
      .execute();
  }

  private async getDb(): Promise<Kysely<DB>> {
    return this.getDbHandle();
  }
}

export function parseWorkflowInstanceStatus(value: string | null): WorkflowInstanceStatus | undefined {
  return isWorkflowInstanceStatus(value) ? value : undefined;
}

export function parseWorkflowTriggerStatus(value: string | null): WorkflowScopedTriggerStatus | undefined {
  return isWorkflowTriggerStatus(value) ? value : undefined;
}

export function parseWorkflowAttentionStatus(value: string | null): WorkflowAttentionItemStatus | undefined {
  return isWorkflowAttentionStatus(value) ? value : undefined;
}

export function isWorkflowInstanceStatus(value: unknown): value is WorkflowInstanceStatus {
  return value === 'created' || value === 'running' || value === 'waiting' || value === 'paused' || value === 'completed' || value === 'failed' || value === 'cancelled';
}

export function isWorkflowTriggerStatus(value: unknown): value is WorkflowScopedTriggerStatus {
  return value === 'active' || value === 'satisfied' || value === 'expired' || value === 'cancelled';
}

export function isWorkflowAttentionStatus(value: unknown): value is WorkflowAttentionItemStatus {
  return value === 'active' || value === 'resolved' || value === 'cancelled';
}

function mapInstance(row: Selectable<WorkflowInstance>): WorkflowInstanceReadModel {
  return {
    instanceId: row.instanceId,
    workflowId: row.workflowId,
    templateId: row.templateId,
    templateVersion: row.templateVersion,
    teamId: row.teamId,
    laneId: row.laneId,
    status: row.status,
    trigger: row.trigger,
    input: parseStoredJson(row.inputJson),
    state: parseStoredJson(row.stateJson),
    currentStepId: row.currentStepId,
    latestRunId: row.latestRunId,
    pauseRequestedAt: row.pauseRequestedAt,
    cancelRequestedAt: row.cancelRequestedAt,
    version: row.version,
    leaseOwner: row.leaseOwner,
    leaseExpiresAt: row.leaseExpiresAt,
    error: row.errorJson == null ? null : parseStoredJson(row.errorJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapAttentionItem(row: Selectable<WorkflowAttentionItem>): WorkflowAttentionItemReadModel {
  return {
    attentionItemId: row.attentionItemId,
    instanceId: row.instanceId,
    stepStateId: row.stepStateId,
    workflowId: row.workflowId,
    teamId: row.teamId,
    laneId: row.laneId,
    status: row.status,
    kind: row.kind,
    title: row.title,
    description: row.description,
    stateId: row.stateId,
    stepId: row.stepId,
    stateVisitId: row.stateVisitId,
    idempotencyKey: row.idempotencyKey,
    presentationUrl: row.presentationUrl,
    formRef: row.formRef,
    formSchema: row.formSchemaJson == null ? null : parseStoredJson(row.formSchemaJson),
    resolution: row.resolutionJson == null ? null : parseStoredJson(row.resolutionJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    resolvedAt: row.resolvedAt,
    cancelledAt: row.cancelledAt,
  };
}

function mapStepState(row: Selectable<WorkflowStepState>): WorkflowStepStateReadModel {
  return {
    id: row.id,
    instanceId: row.instanceId,
    stepKey: row.stepKey,
    status: row.status,
    attemptCount: row.attemptCount,
    lastRunId: row.lastRunId,
    blockedReason: row.blockedReason,
    waitingTriggerId: row.waitingTriggerId,
    input: row.inputJson == null ? null : parseStoredJson(row.inputJson),
    output: row.outputJson == null ? null : parseStoredJson(row.outputJson),
    error: row.errorJson == null ? null : parseStoredJson(row.errorJson),
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function validateHumanSubmission(
  submission: JsonValue,
  formSchema: JsonValue,
): Array<{ path: string; message: string }> {
  const fields = asRecord(asRecord(formSchema)?.fields);
  if (!fields) return [];
  const submitted = asRecord(submission) ?? {};
  const errors: Array<{ path: string; message: string }> = [];
  for (const [fieldName, specValue] of Object.entries(fields)) {
    const spec = asRecord(specValue);
    if (spec?.required === true && (submitted[fieldName] == null || submitted[fieldName] === '')) {
      errors.push({ path: `submission.${fieldName}`, message: 'field is required' });
    }
  }
  return errors;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function mapTrigger(row: Selectable<WorkflowScopedTrigger>): WorkflowScopedTriggerReadModel {
  return {
    triggerId: row.triggerId,
    instanceId: row.instanceId,
    stepStateId: row.stepStateId,
    stepKey: row.stepKey,
    type: row.type,
    status: row.status,
    roleId: row.roleId,
    laneId: row.laneId,
    workspaceId: row.workspaceId,
    sessionId: row.sessionId,
    mode: row.mode,
    cursorCompletedAt: row.cursorCompletedAt,
    cursorExecutionProcessId: row.cursorExecutionProcessId,
    sourceExecutionProcessId: row.sourceExecutionProcessId,
    expectedQueueItemId: row.expectedQueueItemId,
    timeoutAt: row.timeoutAt,
    satisfiedByExecutionProcessId: row.satisfiedByExecutionProcessId,
    satisfiedBy: row.satisfiedByJson == null ? null : parseStoredJson(row.satisfiedByJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    satisfiedAt: row.satisfiedAt,
    expiredAt: row.expiredAt,
    cancelledAt: row.cancelledAt,
  };
}

async function assertUpdated(resultPromise: Promise<{ numUpdatedRows: bigint | number }>, message: string): Promise<void> {
  const result = await resultPromise;
  if (Number(result.numUpdatedRows) !== 1) throw new WorkflowOrchestrationTransitionError(message);
}

function serializeJson(value: JsonValue): string {
  return JSON.stringify(value ?? null);
}

function mergeWorkflowCoreSnapshotJson(stateJson: string | null | undefined, snapshot: JsonValue): JsonValue {
  const state = stateJson ? parseStoredJson(stateJson) : null;
  const record = state && typeof state === 'object' && !Array.isArray(state)
    ? state as Record<string, unknown>
    : {};
  return {
    ...record,
    workflowCoreBridge: {
      schemaVersion: 1,
      kind: 'declarative_two_agent_review_round',
    },
    workflowCoreSnapshot: snapshot,
  };
}

function parseStoredJson(value: string): JsonValue {
  try {
    return JSON.parse(value) as JsonValue;
  } catch {
    return null;
  }
}

function clampLimit(value: number | undefined, defaultLimit: number, maxLimit: number): number {
  if (!Number.isSafeInteger(value) || value == null || value <= 0) return defaultLimit;
  return Math.min(value, maxLimit);
}

function normalizeOffset(value: number | undefined): number {
  return Number.isSafeInteger(value) && value != null && value > 0 ? value : 0;
}

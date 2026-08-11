import type { Kysely, Selectable } from 'kysely';
import {
  advanceWorkflow,
  createInitialWorkflowSnapshot,
  normalizeWorkflowDefinitionV1,
  planNextWorkflowEffect,
  type AgentTurnObservation,
  type DecisionResponseValidator,
  type DecisionValidationResult,
  type HumanFormObservation,
  type NormalizedAgentWorkflowModel,
  type NormalizedWorkflowAction,
  type WorkflowAdvanceResult,
  type WorkflowPlanEffect,
  type WorkflowRuntimeIssue,
  type WorkflowRuntimeSnapshot,
} from '@vibe-dashboard/workflow-core';
import type { DB, WorkflowPersistedRun, WorkflowPersistedRunStatus } from '../../../../store/kysely_types';
import type { DbWorkflowOrchestrationStore } from '../../../../server/workflow-orchestration-store';
import { WorkflowExtensionRegistry, createDefaultWorkflowExtensionRegistry } from '../extensions/workflowExtensionRegistry';
import { DbWorkflowDesignStore } from './workflowDesignStore';

export interface WorkflowRoleSessionBindingInput {
  sessionId: string;
  workspaceId?: string;
}

export interface WorkflowQueueAgentTurnRequest {
  runId: string;
  workspaceId: string;
  sessionId: string;
  role: string;
  state: string;
  stepId: string;
  turnId: string;
  prompt: string;
}

export interface WorkflowQueueAgentTurnResult {
  queueItemRef: string;
}

export interface PersistedWorkflowRuntimeQueue {
  queueAgentTurn(request: WorkflowQueueAgentTurnRequest): Promise<WorkflowQueueAgentTurnResult>;
}

export interface PersistedWorkflowRuntimeEvent {
  kind:
    | 'run_created'
    | 'agent_turn_queued'
    | 'agent_turn_observed'
    | 'human_form_created'
    | 'human_form_submitted'
    | 'observation_ignored'
    | 'workflow_status_changed'
    | 'queue_failed';
  at: number;
  data: Record<string, unknown>;
}

export interface PersistedWorkflowRunReadModel {
  runId: string;
  runSnapshotId: string;
  designId: string;
  designVersion: number;
  workspaceId: string;
  status: WorkflowPersistedRunStatus;
  coreModel: NormalizedAgentWorkflowModel;
  coreSnapshot: WorkflowRuntimeSnapshot;
  roleBindings: Record<string, WorkflowRoleSessionBindingInput>;
  pendingEffect: WorkflowPlanEffect | null;
  queuedTurns: Record<string, WorkflowQueueAgentTurnResult & { role: string; sessionId: string }>;
  events: PersistedWorkflowRuntimeEvent[];
  error: unknown | null;
  createdAt: number;
  updatedAt: number;
}

export class PersistedWorkflowRuntimeError extends Error {
  readonly code: 'WORKFLOW_RUNTIME_MISSING_ROLE_BINDING' | 'WORKFLOW_RUNTIME_QUEUE_FAILED' | 'WORKFLOW_RUNTIME_RUN_NOT_FOUND';
  readonly path: string;

  constructor(code: PersistedWorkflowRuntimeError['code'], path: string, message: string) {
    super(message);
    this.name = 'PersistedWorkflowRuntimeError';
    this.code = code;
    this.path = path;
  }
}

export class PersistedWorkflowRuntimeService {
  private readonly db: Kysely<DB>;
  private readonly designStore: DbWorkflowDesignStore;
  private readonly queue: PersistedWorkflowRuntimeQueue;
  private readonly now: () => number;
  private readonly createId: () => string;
  private readonly validator: DecisionResponseValidator;
  private readonly orchestrationStore?: DbWorkflowOrchestrationStore;
  private readonly extensionRegistry: WorkflowExtensionRegistry;

  constructor(options: {
    db: Kysely<DB>;
    designStore?: DbWorkflowDesignStore;
    queue: PersistedWorkflowRuntimeQueue;
    orchestrationStore?: DbWorkflowOrchestrationStore;
    extensionRegistry?: WorkflowExtensionRegistry;
    now?: () => number;
    createId?: () => string;
    validator?: DecisionResponseValidator;
  }) {
    this.db = options.db;
    this.designStore = options.designStore ?? new DbWorkflowDesignStore({ db: options.db });
    this.queue = options.queue;
    this.now = options.now ?? Date.now;
    this.createId = options.createId ?? (() => `workflow_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`);
    this.validator = options.validator ?? new SimpleWorkflowXmlDecisionValidator();
    this.orchestrationStore = options.orchestrationStore;
    this.extensionRegistry = options.extensionRegistry ?? createDefaultWorkflowExtensionRegistry();
  }

  async launch(input: {
    runId: string;
    runSnapshotId: string;
    designId: string;
    version?: number;
    workspaceId: string;
    inputs: Record<string, unknown>;
    additionalInstructions?: string | null;
    roleBindings: Record<string, WorkflowRoleSessionBindingInput>;
  }): Promise<PersistedWorkflowRunReadModel> {
    const requestedDesign = await this.designStore.getDesign(input.designId);
    const requestedVersion = input.version ?? requestedDesign?.latestPublishedVersion;
    if (requestedVersion == null) throw new PersistedWorkflowRuntimeError('WORKFLOW_RUNTIME_RUN_NOT_FOUND', 'designId', `workflow design ${input.designId} has no published version`);
    const published = await this.designStore.getVersion(input.designId, requestedVersion);
    if (!published) throw new PersistedWorkflowRuntimeError('WORKFLOW_RUNTIME_RUN_NOT_FOUND', 'designId', `workflow design ${input.designId} version ${requestedVersion} not found`);
    const preflightModel = normalizeWorkflowDefinitionV1(published.resolvedDefinition, {
      workflowId: `${published.designId}@${published.version}`,
    });
    this.assertRoleBindings(preflightModel, input.roleBindings);

    const runSnapshot = await this.designStore.createRunSnapshot({
      runSnapshotId: input.runSnapshotId,
      designId: input.designId,
      version: requestedVersion,
      workspaceId: input.workspaceId,
      runInput: input.inputs,
      roleBindings: input.roleBindings,
      additionalInstructions: input.additionalInstructions ?? null,
    });
    const model = normalizeWorkflowDefinitionV1(runSnapshot.resolvedDefinition, {
      workflowId: `${runSnapshot.designId}@${runSnapshot.designVersion}`,
    });

    const initialSnapshot = createInitialWorkflowSnapshot(model, {
      instanceId: input.runId,
      inputs: input.inputs,
      now: this.now,
      createId: this.createId,
    });
    const createdAt = this.now();
    const created = event('run_created', createdAt, {
      runId: input.runId,
      designId: runSnapshot.designId,
      designVersion: runSnapshot.designVersion,
      workspaceId: input.workspaceId,
    });

    await this.db.insertInto('WorkflowPersistedRun').values({
      runId: input.runId,
      runSnapshotId: input.runSnapshotId,
      designId: runSnapshot.designId,
      designVersion: runSnapshot.designVersion,
      workspaceId: input.workspaceId,
      status: initialSnapshot.status,
      coreModelJson: stableJson(model),
      coreSnapshotJson: stableJson(initialSnapshot),
      roleBindingsJson: stableJson(input.roleBindings),
      pendingEffectJson: null,
      queuedTurnsJson: '{}',
      eventsJson: stableJson([created]),
      errorJson: null,
      createdAt,
      updatedAt: createdAt,
    }).execute();

    return this.runReady(input.runId);
  }

  async runReady(runId: string): Promise<PersistedWorkflowRunReadModel> {
    const run = await this.getRequiredRun(runId);
    if (run.coreSnapshot.status !== 'running') return run;
    if (run.coreSnapshot.waitingFor) {
      if (run.coreSnapshot.waitingFor.kind === 'human_form') {
        const state = run.coreModel.states[run.coreSnapshot.waitingFor.state];
        const step = state && !state.terminal ? state.steps.find((candidate) => candidate.id === run.coreSnapshot.waitingFor?.stepId) : null;
        if (step?.type === 'human_form') {
          return this.createHumanFormEffect(run, {
            kind: 'create_human_form',
            state: run.coreSnapshot.waitingFor.state,
            stepId: step.id,
            turnId: run.coreSnapshot.waitingFor.turnId,
            title: step.title,
            description: step.description,
            form: step.form,
          });
        }
      }
      return run;
    }

    const planned = planNextWorkflowEffect(run.coreModel, run.coreSnapshot, this.deps());
    return this.persistPlanResult(run, planned.snapshot, planned.effect);
  }

  async completeHumanForm(input: { runId: string; turnId: string; responseRef: string; submission: Record<string, unknown> }): Promise<{ applied: boolean; reason: 'applied' | 'duplicate' | 'stale' | 'terminal'; run: PersistedWorkflowRunReadModel }> {
    const run = await this.getRequiredRun(input.runId);
    if (run.coreSnapshot.status !== 'running') return { applied: false, reason: 'terminal', run };
    if (run.coreSnapshot.history.some((entry) => entry.kind === 'human_form_completed' && entry.turnId === input.turnId)) {
      return { applied: false, reason: 'duplicate', run };
    }
    const observation: HumanFormObservation = {
      kind: 'human_form_completed',
      turnId: input.turnId,
      responseRef: input.responseRef,
      submission: input.submission,
    };
    const advanced = advanceWorkflow(run.coreModel, run.coreSnapshot, observation, this.deps());
    if (advanced.ignored) {
      const ignoredRun = await this.updateRun(run, run.coreSnapshot, run.pendingEffect, [event('observation_ignored', this.now(), { turnId: input.turnId, reason: advanced.ignored })]);
      return { applied: false, reason: 'stale', run: ignoredRun };
    }
    const persisted = await this.persistAdvanceResult(run, advanced, { turnId: input.turnId, responseRef: input.responseRef }, [], 'human_form_submitted');
    return { applied: true, reason: 'applied', run: persisted };
  }

  async completeAgentTurn(input: { runId: string; turnId: string; responseRef: string; finalResponseText?: string }): Promise<{ applied: boolean; reason: 'applied' | 'duplicate' | 'stale' | 'terminal'; run: PersistedWorkflowRunReadModel }> {
    const run = await this.getRequiredRun(input.runId);
    if (run.coreSnapshot.status !== 'running') return { applied: false, reason: 'terminal', run };
    if (run.coreSnapshot.history.some((entry) => entry.kind === 'agent_turn_completed' && entry.turnId === input.turnId)) {
      return { applied: false, reason: 'duplicate', run };
    }

    const observation: AgentTurnObservation = {
      kind: 'agent_turn_completed',
      turnId: input.turnId,
      responseRef: input.responseRef,
      finalResponseText: input.finalResponseText,
    };
    const advanced = advanceWorkflow(run.coreModel, run.coreSnapshot, observation, this.deps());
    if (advanced.ignored) {
      const ignoredRun = await this.updateRun(run, run.coreSnapshot, run.pendingEffect, [event('observation_ignored', this.now(), { turnId: input.turnId, reason: advanced.ignored })]);
      return { applied: false, reason: 'stale', run: ignoredRun };
    }
    const persisted = await this.persistAdvanceResult(run, advanced, input);
    return { applied: true, reason: 'applied', run: persisted };
  }

  async getRun(runId: string): Promise<PersistedWorkflowRunReadModel | null> {
    const row = await this.db.selectFrom('WorkflowPersistedRun').selectAll().where('runId', '=', runId).executeTakeFirst();
    return row ? mapRun(row) : null;
  }

  private async persistAdvanceResult(
    previous: PersistedWorkflowRunReadModel,
    advanced: WorkflowAdvanceResult,
    observation: { turnId: string; responseRef: string },
    extraEvents: PersistedWorkflowRuntimeEvent[] = [],
    observedKind: PersistedWorkflowRuntimeEvent['kind'] = 'agent_turn_observed',
  ): Promise<PersistedWorkflowRunReadModel> {
    const observed = event(observedKind, this.now(), { turnId: observation.turnId, responseRef: observation.responseRef });
    const statusChanged = previous.coreSnapshot.status !== advanced.snapshot.status
      ? [event('workflow_status_changed', this.now(), { from: previous.coreSnapshot.status, to: advanced.snapshot.status })]
      : [];
    const withObservation = await this.updateRun(previous, advanced.snapshot, advanced.effect, [...extraEvents, observed, ...statusChanged]);
    if (advanced.effect.kind === 'send_agent_turn') {
      return this.queueEffect(withObservation, advanced.effect);
    }
    if (advanced.effect.kind === 'create_human_form') return this.createHumanFormEffect(withObservation, advanced.effect);
    return withObservation;
  }

  private async persistPlanResult(
    previous: PersistedWorkflowRunReadModel,
    snapshot: WorkflowRuntimeSnapshot,
    effect: WorkflowPlanEffect,
  ): Promise<PersistedWorkflowRunReadModel> {
    const planned = await this.updateRun(previous, snapshot, effect, []);
    if (effect.kind === 'send_agent_turn') return this.queueEffect(planned, effect);
    if (effect.kind === 'create_human_form') return this.createHumanFormEffect(planned, effect);
    return planned;
  }

  private async createHumanFormEffect(run: PersistedWorkflowRunReadModel, effect: Extract<WorkflowPlanEffect, { kind: 'create_human_form' }>): Promise<PersistedWorkflowRunReadModel> {
    if (!this.orchestrationStore) return run;
    const idempotencyKey = `${run.runId}:${run.coreSnapshot.visitId}:${effect.stepId}`;
    const artifact = await this.extensionRegistry.createArtifact({
      providerType: effect.form.providerType,
      artifactKind: 'form',
      idempotencyKey,
      input: {
        title: effect.title,
        descriptionMarkdown: effect.description,
        formSchema: effect.form.formSchema,
        submitLabel: effect.form.submitLabel,
      },
    }, {
      run: {
        runId: run.runId,
        workspaceId: run.workspaceId,
        stateId: effect.state,
        visitId: run.coreSnapshot.visitId,
      },
    });
    await this.ensureMirrorHumanInstance(run, effect, artifact.artifactRef.durableRef);
    const attention = await this.orchestrationStore.createHumanAttention({
      attentionItemId: `attention-${effect.turnId}`,
      instanceId: run.runId,
      stepStateId: `${run.runId}-${effect.turnId}`,
      stepKey: effect.stepId,
      stateId: effect.state,
      stateVisitId: run.coreSnapshot.visitId,
      idempotencyKey,
      title: effect.title,
      description: effect.description ?? null,
      presentationUrl: `/dashboard/workflows/${run.runId}`,
      formRef: artifact.artifactRef.durableRef,
      formSchema: effect.form.formSchema,
    });
    return this.updateRun(run, run.coreSnapshot, effect, attention.created ? [event('human_form_created', this.now(), { turnId: effect.turnId, attentionItemId: attention.item.attentionItemId, formRef: artifact.artifactRef.durableRef })] : []);
  }

  private async ensureMirrorHumanInstance(run: PersistedWorkflowRunReadModel, effect: Extract<WorkflowPlanEffect, { kind: 'create_human_form' }>, formRef: string): Promise<void> {
    if (!this.orchestrationStore) return;
    const existing = await this.orchestrationStore.getInstance(run.runId);
    if (!existing) {
      await this.orchestrationStore.createInstance({
        instanceId: run.runId,
        workflowId: run.coreModel.workflowId,
        trigger: 'workflow_run',
        input: { ...run.coreSnapshot.inputs, workspaceId: run.workspaceId },
        state: { definition: { name: run.coreModel.name }, persistedWorkflowRunId: run.runId },
      });
      await this.orchestrationStore.startInstance(run.runId, { currentStepId: effect.stepId });
    } else if (existing.status !== 'running') {
      return;
    }
    const stepStateId = `${run.runId}-${effect.turnId}`;
    const existingSteps = await this.orchestrationStore.listStepStates(run.runId);
    if (!existingSteps.some((step) => step.id === stepStateId)) {
      await this.orchestrationStore.createStepState({
        id: stepStateId,
        instanceId: run.runId,
        stepKey: effect.stepId,
        input: { title: effect.title, description: effect.description ?? null, formRef },
      });
      await this.orchestrationStore.markStepRunning(stepStateId);
    }
  }

  private async queueEffect(run: PersistedWorkflowRunReadModel, effect: Extract<WorkflowPlanEffect, { kind: 'send_agent_turn' }>): Promise<PersistedWorkflowRunReadModel> {
    if (run.queuedTurns[effect.turnId]) return run;
    const binding = run.roleBindings[effect.role];
    if (!binding?.sessionId) throw new PersistedWorkflowRuntimeError('WORKFLOW_RUNTIME_MISSING_ROLE_BINDING', `roleBindings.${effect.role}.sessionId`, `missing session binding for role ${effect.role}`);
    try {
      const queued = await this.queue.queueAgentTurn({
        runId: run.runId,
        workspaceId: run.workspaceId,
        sessionId: binding.sessionId,
        role: effect.role,
        state: effect.state,
        stepId: effect.stepId,
        turnId: effect.turnId,
        prompt: effect.prompt,
      });
      const queuedTurns = { ...run.queuedTurns, [effect.turnId]: { ...queued, role: effect.role, sessionId: binding.sessionId } };
      return this.updateRun(run, run.coreSnapshot, effect, [event('agent_turn_queued', this.now(), { turnId: effect.turnId, role: effect.role, sessionId: binding.sessionId, queueItemRef: queued.queueItemRef })], queuedTurns);
    } catch (error) {
      const runtimeError = normalizeError(error);
      const failedSnapshot: WorkflowRuntimeSnapshot = {
        ...run.coreSnapshot,
        status: 'failed',
        updatedAt: this.now(),
        blockedReason: { code: 'WORKFLOW_DECISION_VALIDATION_FAILED', path: 'queue', message: runtimeError.message } as WorkflowRuntimeIssue,
      };
      return this.updateRun(run, failedSnapshot, { kind: 'none' }, [event('queue_failed', this.now(), { turnId: effect.turnId, error: runtimeError })], run.queuedTurns, runtimeError);
    }
  }

  private async updateRun(
    previous: PersistedWorkflowRunReadModel,
    snapshot: WorkflowRuntimeSnapshot,
    pendingEffect: WorkflowPlanEffect | null,
    newEvents: PersistedWorkflowRuntimeEvent[],
    queuedTurns: PersistedWorkflowRunReadModel['queuedTurns'] = previous.queuedTurns,
    error: unknown | null = previous.error,
  ): Promise<PersistedWorkflowRunReadModel> {
    const now = this.now();
    const events = [...previous.events, ...newEvents];
    await this.db.updateTable('WorkflowPersistedRun').set({
      status: snapshot.status,
      coreSnapshotJson: stableJson(snapshot),
      pendingEffectJson: pendingEffect ? stableJson(pendingEffect) : null,
      queuedTurnsJson: stableJson(queuedTurns),
      eventsJson: stableJson(events),
      errorJson: error == null ? null : stableJson(error),
      updatedAt: now,
    }).where('runId', '=', previous.runId).execute();
    return this.getRequiredRun(previous.runId);
  }

  private async getRequiredRun(runId: string): Promise<PersistedWorkflowRunReadModel> {
    const run = await this.getRun(runId);
    if (!run) throw new PersistedWorkflowRuntimeError('WORKFLOW_RUNTIME_RUN_NOT_FOUND', 'runId', `workflow run ${runId} not found`);
    return run;
  }

  private assertRoleBindings(model: NormalizedAgentWorkflowModel, roleBindings: Record<string, WorkflowRoleSessionBindingInput>): void {
    for (const roleId of Object.keys(model.roles)) {
      if (!roleBindings[roleId]?.sessionId) {
        throw new PersistedWorkflowRuntimeError('WORKFLOW_RUNTIME_MISSING_ROLE_BINDING', `roleBindings.${roleId}.sessionId`, `missing session binding for role ${roleId}`);
      }
    }
  }

  private deps() {
    return { now: this.now, createId: this.createId, validator: this.validator };
  }
}

export class SimpleWorkflowXmlDecisionValidator implements DecisionResponseValidator {
  validate(args: { actions: Record<string, NormalizedWorkflowAction>; responseText: string; rawXmlMaxChars: number }): DecisionValidationResult {
    const text = args.responseText.trim();
    if (!text.startsWith('<') || !text.endsWith('>')) {
      return invalidXml('response must be XML');
    }
    const action = readAction(text);
    if (!action) return invalidXml('XML response must include an action');
    const parsed = readSimpleFields(text);
    delete parsed.action;
    const unknownFields = Object.keys(parsed).filter((key) => !Object.values(args.actions).some((candidate) => candidate.result?.fields?.[key]));
    return { valid: true, action, rawXml: text, parsed, unknownFields };
  }
}

function readAction(xml: string): string | null {
  const attr = xml.match(/<decision\b[^>]*\baction=["']([^"']+)["'][^>]*>/iu)?.[1];
  if (attr) return attr;
  return xml.match(/<action>([\s\S]*?)<\/action>/iu)?.[1]?.trim() || null;
}

function readSimpleFields(xml: string): Record<string, unknown> {
  const parsed: Record<string, unknown> = {};
  const tagPattern = /<([A-Za-z_][\w.-]*)>([\s\S]*?)<\/\1>/gu;
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(xml)) !== null) {
    const [, tag, rawValue] = match;
    if (!tag || tag === 'decision') continue;
    const value = stripCdata(rawValue ?? '').trim();
    const existing = parsed[tag];
    if (existing === undefined) parsed[tag] = value;
    else if (Array.isArray(existing)) existing.push(value);
    else parsed[tag] = [existing, value];
  }
  return parsed;
}

function stripCdata(value: string): string {
  return value.replace(/^<!\[CDATA\[/u, '').replace(/\]\]>$/u, '');
}

function invalidXml(message: string): DecisionValidationResult {
  return { valid: false, errors: [{ code: 'WORKFLOW_DECISION_VALIDATION_FAILED', path: '$', message }] };
}

function event(kind: PersistedWorkflowRuntimeEvent['kind'], at: number, data: Record<string, unknown>): PersistedWorkflowRuntimeEvent {
  return { kind, at, data };
}

function mapRun(row: Selectable<WorkflowPersistedRun>): PersistedWorkflowRunReadModel {
  return {
    runId: row.runId,
    runSnapshotId: row.runSnapshotId,
    designId: row.designId,
    designVersion: row.designVersion,
    workspaceId: row.workspaceId,
    status: row.status,
    coreModel: JSON.parse(row.coreModelJson) as NormalizedAgentWorkflowModel,
    coreSnapshot: JSON.parse(row.coreSnapshotJson) as WorkflowRuntimeSnapshot,
    roleBindings: JSON.parse(row.roleBindingsJson) as Record<string, WorkflowRoleSessionBindingInput>,
    pendingEffect: row.pendingEffectJson ? JSON.parse(row.pendingEffectJson) as WorkflowPlanEffect : null,
    queuedTurns: JSON.parse(row.queuedTurnsJson) as PersistedWorkflowRunReadModel['queuedTurns'],
    events: JSON.parse(row.eventsJson) as PersistedWorkflowRuntimeEvent[],
    error: row.errorJson ? JSON.parse(row.errorJson) as unknown : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

function normalizeError(error: unknown): { name: string; message: string } {
  if (error instanceof Error) return { name: error.name, message: error.message };
  return { name: 'NonErrorThrown', message: String(error) };
}

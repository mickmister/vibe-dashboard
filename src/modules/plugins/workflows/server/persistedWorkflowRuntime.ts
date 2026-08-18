import type { Kysely, Selectable } from "kysely";
import {
  compileBeadsForm,
  createBeadsFormWorkflowArtifactRef,
  parseBeadsFormXml,
} from "@vibe-dashboard/beads-form";
import {
  advanceWorkflow,
  createInitialWorkflowSnapshot,
  normalizeWorkflowDefinitionV1,
  planNextWorkflowEffect,
  type AgentTurnObservation,
  type DecisionResponseValidator,
  type DecisionValidationResult,
  type GitHubCiCompletionStatus,
  type HumanFormObservation,
  type NormalizedAgentWorkflowModel,
  type NormalizedWorkflowAction,
  type WorkflowAdvanceResult,
  type WorkflowCommandObservation,
  type WorkflowPlanEffect,
  type WorkflowRuntimeIssue,
  type WorkflowRuntimeSnapshot,
  type WorkflowSnapshotStatus,
} from "@vibe-dashboard/workflow-core";
import type {
  DB,
  WorkflowPersistedRun,
  WorkflowPersistedRunStatus,
} from "../../../../store/kysely_types";
import type { DbWorkflowOrchestrationStore } from "../../../../server/workflow-orchestration-store";
import {
  WorkflowExtensionRegistry,
  createDefaultWorkflowExtensionRegistry,
} from "../extensions/workflowExtensionRegistry";
import { DbWorkflowDesignStore } from "./workflowDesignStore";
import type { DbWorkspaceLaneStore } from "../../../../server/workspace-lane-store";
import type { BeadMetadataProvider } from "./beadMetaWorkflowRuntime";
import {
  composeWorkflowAgentPrompt,
  resolveWorkflowBeadPromptContext,
  withWorkflowBeadContextInput,
} from "../shared/workflowPromptContext";
import {
  WorkflowCommandProviderError,
  WorkflowCommandProviderRegistry,
  capText,
  createDefaultWorkflowCommandProviderRegistry,
  normalizeCommandPolicy,
  redact,
  validateCommandPolicyAgainstSpec,
  type WorkflowCommandResult,
} from "../extensions/workflowCommandProviders";

export interface WorkflowRoleSessionBindingInput {
  sessionId: string;
  workspaceId?: string;
  executorType?: string | null;
  model?: string | null;
  preferenceMode?: "preferred" | null;
  preferenceSource?: "role_default" | "launch_override" | "workspace_default";
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
  provenance: {
    kind: "workflow";
    label: string;
    workflow_run_id: string;
    workflow_name: string;
    workflow_design_id: string;
    workflow_version: number;
    workflow_role_id?: string;
    workflow_role_executor?: string | null;
    workflow_role_model?: string | null;
  };
  executorPreference?: {
    executorType: string | null;
    model: string | null;
    mode: "preferred";
  };
}

export interface WorkflowQueueAgentTurnResult {
  queueItemRef: string;
}

export interface PersistedWorkflowRuntimeQueue {
  queueAgentTurn(
    request: WorkflowQueueAgentTurnRequest,
  ): Promise<WorkflowQueueAgentTurnResult>;
}

export interface PersistedWorkflowRuntimeEvent {
  kind:
    | "run_created"
    | "agent_turn_queued"
    | "agent_turn_observed"
    | "human_form_created"
    | "human_form_submitted"
    | "workflow_call_started"
    | "workflow_call_completed"
    | "github_ci_watch_started"
    | "github_ci_watch_completed"
    | "github_ci_watch_poll_error"
    | "github_ci_watch_provider_missing"
    | "command_attempt_created"
    | "command_step_completed"
    | "command_step_denied"
    | "observation_ignored"
    | "workflow_status_changed"
    | "queue_failed"
    | "form_artifact_created"
    | "form_artifact_failed";
  at: number;
  data: Record<string, unknown>;
}

export interface GitHubCiWatchProvider {
  startWatch(request: {
    runId: string;
    workspaceId: string;
    turnId: string;
    action: string;
    ciRunId?: string;
    checkRunId?: string;
    repo?: string;
    sha?: string;
  }): Promise<{ watchRef: string }>;
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
  queuedTurns: Record<
    string,
    WorkflowQueueAgentTurnResult & {
      role: string;
      sessionId: string;
      executorType?: string | null;
      model?: string | null;
    }
  >;
  events: PersistedWorkflowRuntimeEvent[];
  error: unknown | null;
  createdAt: number;
  updatedAt: number;
}

export class PersistedWorkflowRuntimeError extends Error {
  readonly code:
    | "WORKFLOW_RUNTIME_MISSING_ROLE_BINDING"
    | "WORKFLOW_RUNTIME_QUEUE_FAILED"
    | "WORKFLOW_RUNTIME_RUN_NOT_FOUND";
  readonly path: string;

  constructor(
    code: PersistedWorkflowRuntimeError["code"],
    path: string,
    message: string,
  ) {
    super(message);
    this.name = "PersistedWorkflowRuntimeError";
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
  private readonly githubCiWatchProvider?: GitHubCiWatchProvider;
  private readonly commandProviders: WorkflowCommandProviderRegistry;
  private readonly laneStore?: DbWorkspaceLaneStore;
  private readonly beadProvider?: BeadMetadataProvider;

  constructor(options: {
    db: Kysely<DB>;
    designStore?: DbWorkflowDesignStore;
    queue: PersistedWorkflowRuntimeQueue;
    orchestrationStore?: DbWorkflowOrchestrationStore;
    extensionRegistry?: WorkflowExtensionRegistry;
    githubCiWatchProvider?: GitHubCiWatchProvider;
    commandProviders?: WorkflowCommandProviderRegistry;
    laneStore?: DbWorkspaceLaneStore;
    beadProvider?: BeadMetadataProvider;
    now?: () => number;
    createId?: () => string;
    validator?: DecisionResponseValidator;
  }) {
    this.db = options.db;
    this.designStore =
      options.designStore ?? new DbWorkflowDesignStore({ db: options.db });
    this.queue = options.queue;
    this.now = options.now ?? Date.now;
    this.createId =
      options.createId ??
      (() =>
        `workflow_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`);
    this.validator =
      options.validator ?? new SimpleWorkflowXmlDecisionValidator();
    this.orchestrationStore = options.orchestrationStore;
    this.extensionRegistry =
      options.extensionRegistry ?? createDefaultWorkflowExtensionRegistry();
    this.githubCiWatchProvider = options.githubCiWatchProvider;
    this.commandProviders =
      options.commandProviders ?? createDefaultWorkflowCommandProviderRegistry();
    this.laneStore = options.laneStore;
    this.beadProvider = options.beadProvider;
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
    beadIds?: string[];
  }): Promise<PersistedWorkflowRunReadModel> {
    const requestedDesign = await this.designStore.getDesign(input.designId);
    const requestedVersion =
      input.version ?? requestedDesign?.latestPublishedVersion;
    if (requestedVersion == null)
      throw new PersistedWorkflowRuntimeError(
        "WORKFLOW_RUNTIME_RUN_NOT_FOUND",
        "designId",
        `workflow design ${input.designId} has no published version`,
      );
    const published = await this.designStore.getVersion(
      input.designId,
      requestedVersion,
    );
    if (!published)
      throw new PersistedWorkflowRuntimeError(
        "WORKFLOW_RUNTIME_RUN_NOT_FOUND",
        "designId",
        `workflow design ${input.designId} version ${requestedVersion} not found`,
      );
    const preflightModel = normalizeWorkflowDefinitionV1(
      published.resolvedDefinition,
      {
        workflowId: `${published.designId}@${published.version}`,
      },
    );
    const resolvedRoleBindings = resolveRuntimeRoleBindings(
      preflightModel,
      input.roleBindings,
    );
    this.assertRoleBindings(preflightModel, resolvedRoleBindings);
    const runInputs = input.beadIds?.length
      ? withWorkflowBeadContextInput(input.inputs, input.beadIds)
      : input.inputs;

    const runSnapshot = await this.designStore.createRunSnapshot({
      runSnapshotId: input.runSnapshotId,
      designId: input.designId,
      version: requestedVersion,
      workspaceId: input.workspaceId,
      runInput: runInputs,
      roleBindings: resolvedRoleBindings,
      additionalInstructions: input.additionalInstructions ?? null,
    });
    const model = normalizeWorkflowDefinitionV1(
      runSnapshot.resolvedDefinition,
      {
        workflowId: `${runSnapshot.designId}@${runSnapshot.designVersion}`,
      },
    );

    const initialSnapshot = createInitialWorkflowSnapshot(model, {
      instanceId: input.runId,
      inputs: runInputs,
      now: this.now,
      createId: this.createId,
    });
    const createdAt = this.now();
    const created = event("run_created", createdAt, {
      runId: input.runId,
      designId: runSnapshot.designId,
      designVersion: runSnapshot.designVersion,
      workspaceId: input.workspaceId,
    });

    await this.db
      .insertInto("WorkflowPersistedRun")
      .values({
        runId: input.runId,
        runSnapshotId: input.runSnapshotId,
        designId: runSnapshot.designId,
        designVersion: runSnapshot.designVersion,
        workspaceId: input.workspaceId,
        status: initialSnapshot.status,
        coreModelJson: stableJson(model),
        coreSnapshotJson: stableJson(initialSnapshot),
        roleBindingsJson: stableJson(resolvedRoleBindings),
        pendingEffectJson: null,
        queuedTurnsJson: "{}",
        eventsJson: stableJson([created]),
        errorJson: null,
        createdAt,
        updatedAt: createdAt,
      })
      .execute();

    return this.runReady(input.runId);
  }

  async runReady(runId: string): Promise<PersistedWorkflowRunReadModel> {
    const run = await this.getRequiredRun(runId);
    if (run.coreSnapshot.status !== "running") return run;
    if (run.coreSnapshot.waitingFor) {
      if (
        run.coreSnapshot.waitingFor.kind === "workflow_call" &&
        run.pendingEffect?.kind === "start_workflow_call"
      ) {
        return this.startWorkflowCallEffect(run, run.pendingEffect);
      }
      if (
        run.coreSnapshot.waitingFor.kind === "github_ci" &&
        run.pendingEffect?.kind === "start_github_ci_watch"
      ) {
        return this.startGithubCiWatchEffect(run, run.pendingEffect);
      }
      if (
        run.coreSnapshot.waitingFor.kind === "command" &&
        run.pendingEffect?.kind === "start_command"
      ) {
        return this.startCommandEffect(run, run.pendingEffect);
      }
      if (run.coreSnapshot.waitingFor.kind === "human_form") {
        const state = run.coreModel.states[run.coreSnapshot.waitingFor.state];
        const step =
          state && !state.terminal
            ? state.steps.find(
                (candidate) =>
                  candidate.id === run.coreSnapshot.waitingFor?.stepId,
              )
            : null;
        if (step?.type === "human_form") {
          return this.createHumanFormEffect(run, {
            kind: "create_human_form",
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

    const planned = planNextWorkflowEffect(
      run.coreModel,
      run.coreSnapshot,
      this.deps(),
    );
    return this.persistPlanResult(run, planned.snapshot, planned.effect);
  }

  async completeHumanForm(input: {
    runId: string;
    turnId: string;
    responseRef: string;
    submission: Record<string, unknown>;
  }): Promise<{
    applied: boolean;
    reason: "applied" | "duplicate" | "stale" | "terminal";
    run: PersistedWorkflowRunReadModel;
  }> {
    const run = await this.getRequiredRun(input.runId);
    if (run.coreSnapshot.status !== "running")
      return { applied: false, reason: "terminal", run };
    if (
      run.coreSnapshot.history.some(
        (entry) =>
          entry.kind === "human_form_completed" &&
          entry.turnId === input.turnId,
      )
    ) {
      return { applied: false, reason: "duplicate", run };
    }
    const observation: HumanFormObservation = {
      kind: "human_form_completed",
      turnId: input.turnId,
      responseRef: input.responseRef,
      submission: input.submission,
    };
    const advanced = advanceWorkflow(
      run.coreModel,
      run.coreSnapshot,
      observation,
      this.deps(),
    );
    if (advanced.ignored) {
      const ignoredRun = await this.updateRun(
        run,
        run.coreSnapshot,
        run.pendingEffect,
        [
          event("observation_ignored", this.now(), {
            turnId: input.turnId,
            reason: advanced.ignored,
          }),
        ],
      );
      return { applied: false, reason: "stale", run: ignoredRun };
    }
    const persisted = await this.persistAdvanceResult(
      run,
      advanced,
      { turnId: input.turnId, responseRef: input.responseRef },
      [],
      "human_form_submitted",
    );
    await this.resumeParentsIfTerminal(persisted);
    return { applied: true, reason: "applied", run: persisted };
  }

  async completeAgentTurn(input: {
    runId: string;
    turnId: string;
    responseRef: string;
    finalResponseText?: string;
  }): Promise<{
    applied: boolean;
    reason: "applied" | "duplicate" | "stale" | "terminal";
    run: PersistedWorkflowRunReadModel;
  }> {
    const run = await this.getRequiredRun(input.runId);
    if (run.coreSnapshot.status !== "running")
      return { applied: false, reason: "terminal", run };
    if (
      run.coreSnapshot.history.some(
        (entry) =>
          entry.kind === "agent_turn_completed" &&
          entry.turnId === input.turnId,
      )
    ) {
      return { applied: false, reason: "duplicate", run };
    }

    const observation: AgentTurnObservation = {
      kind: "agent_turn_completed",
      turnId: input.turnId,
      responseRef: input.responseRef,
      finalResponseText: input.finalResponseText,
    };
    const advanced = advanceWorkflow(
      run.coreModel,
      run.coreSnapshot,
      observation,
      this.deps(),
    );
    if (advanced.ignored) {
      const ignoredRun = await this.updateRun(
        run,
        run.coreSnapshot,
        run.pendingEffect,
        [
          event("observation_ignored", this.now(), {
            turnId: input.turnId,
            reason: advanced.ignored,
          }),
        ],
      );
      return { applied: false, reason: "stale", run: ignoredRun };
    }
    const persisted = await this.persistAdvanceResult(run, advanced, input);
    await this.resumeParentsIfTerminal(persisted);
    return { applied: true, reason: "applied", run: persisted };
  }

  async completeWorkflowCall(input: {
    runId: string;
    turnId: string;
    childRunId: string;
    responseRef: string;
    childStatus: WorkflowSnapshotStatus;
    outputRef?: string;
    statusSummary?: string;
  }): Promise<{
    applied: boolean;
    reason: "applied" | "duplicate" | "stale" | "terminal";
    run: PersistedWorkflowRunReadModel;
  }> {
    const run = await this.getRequiredRun(input.runId);
    if (run.coreSnapshot.status !== "running")
      return { applied: false, reason: "terminal", run };
    if (
      run.coreSnapshot.history.some(
        (entry) =>
          entry.kind === "workflow_call_completed" &&
          entry.turnId === input.turnId,
      )
    ) {
      return { applied: false, reason: "duplicate", run };
    }
    const advanced = advanceWorkflow(
      run.coreModel,
      run.coreSnapshot,
      {
        kind: "workflow_call_completed",
        turnId: input.turnId,
        responseRef: input.responseRef,
        childRunId: input.childRunId,
        childStatus: input.childStatus,
        outputRef: input.outputRef,
        statusSummary: input.statusSummary,
      },
      this.deps(),
    );
    if (advanced.ignored) {
      const ignoredRun = await this.updateRun(
        run,
        run.coreSnapshot,
        run.pendingEffect,
        [
          event("observation_ignored", this.now(), {
            turnId: input.turnId,
            reason: advanced.ignored,
          }),
        ],
      );
      return { applied: false, reason: "stale", run: ignoredRun };
    }
    const persisted = await this.persistAdvanceResult(
      run,
      advanced,
      { turnId: input.turnId, responseRef: input.responseRef },
      [
        event("workflow_call_completed", this.now(), {
          turnId: input.turnId,
          childRunId: input.childRunId,
          childStatus: input.childStatus,
          outputRef: input.outputRef ?? null,
        }),
      ],
      "workflow_call_completed",
    );
    await this.resumeParentsIfTerminal(persisted);
    return { applied: true, reason: "applied", run: persisted };
  }

  async completeGithubCiWatch(input: {
    runId: string;
    turnId: string;
    responseRef: string;
    status: GitHubCiCompletionStatus;
    statusSummary?: string;
    detailsUrl?: string;
  }): Promise<{
    applied: boolean;
    reason: "applied" | "duplicate" | "stale" | "terminal";
    run: PersistedWorkflowRunReadModel;
  }> {
    const run = await this.getRequiredRun(input.runId);
    if (run.coreSnapshot.status !== "running")
      return { applied: false, reason: "terminal", run };
    if (
      run.coreSnapshot.history.some(
        (entry) =>
          entry.kind === "github_ci_wait_completed" &&
          entry.turnId === input.turnId,
      )
    ) {
      return { applied: false, reason: "duplicate", run };
    }
    const advanced = advanceWorkflow(
      run.coreModel,
      run.coreSnapshot,
      {
        kind: "github_ci_completed",
        turnId: input.turnId,
        responseRef: input.responseRef,
        status: input.status,
        statusSummary: input.statusSummary,
        detailsUrl: input.detailsUrl,
      },
      this.deps(),
    );
    if (advanced.ignored) {
      const ignoredRun = await this.updateRun(
        run,
        run.coreSnapshot,
        run.pendingEffect,
        [
          event("observation_ignored", this.now(), {
            turnId: input.turnId,
            reason: advanced.ignored,
          }),
        ],
      );
      return { applied: false, reason: "stale", run: ignoredRun };
    }
    const persisted = await this.persistAdvanceResult(
      run,
      advanced,
      { turnId: input.turnId, responseRef: input.responseRef },
      [
        event("github_ci_watch_completed", this.now(), {
          turnId: input.turnId,
          status: input.status,
          statusSummary: input.statusSummary ?? input.status,
          detailsUrl: input.detailsUrl ?? null,
        }),
      ],
      null,
    );
    await this.resumeParentsIfTerminal(persisted);
    return { applied: true, reason: "applied", run: persisted };
  }

  async recordGithubCiWatchPollError(input: {
    runId: string;
    turnId: string;
    error: { name: string; message: string; retryAfterMs?: number };
  }): Promise<PersistedWorkflowRunReadModel> {
    const run = await this.getRequiredRun(input.runId);
    if (
      run.coreSnapshot.status !== "running" ||
      run.coreSnapshot.waitingFor?.kind !== "github_ci" ||
      run.coreSnapshot.waitingFor.turnId !== input.turnId
    ) {
      return run;
    }
    return this.updateRun(run, run.coreSnapshot, run.pendingEffect, [
      event("github_ci_watch_poll_error", this.now(), {
        turnId: input.turnId,
        error: input.error,
      }),
    ]);
  }

  async getRun(runId: string): Promise<PersistedWorkflowRunReadModel | null> {
    const row = await this.db
      .selectFrom("WorkflowPersistedRun")
      .selectAll()
      .where("runId", "=", runId)
      .executeTakeFirst();
    return row ? mapRun(row) : null;
  }

  private async persistAdvanceResult(
    previous: PersistedWorkflowRunReadModel,
    advanced: WorkflowAdvanceResult,
    observation: { turnId: string; responseRef: string },
    extraEvents: PersistedWorkflowRuntimeEvent[] = [],
    observedKind:
      PersistedWorkflowRuntimeEvent["kind"] | null = "agent_turn_observed",
  ): Promise<PersistedWorkflowRunReadModel> {
    const observed = observedKind
      ? [
          event(observedKind, this.now(), {
            turnId: observation.turnId,
            responseRef: observation.responseRef,
          }),
        ]
      : [];
    const statusChanged =
      previous.coreSnapshot.status !== advanced.snapshot.status
        ? [
            event("workflow_status_changed", this.now(), {
              from: previous.coreSnapshot.status,
              to: advanced.snapshot.status,
            }),
          ]
        : [];
    const formArtifact = this.applyFormArtifactResult(
      previous,
      advanced.snapshot,
    );
    const nextSnapshot = formArtifact.snapshot;
    const nextStatusChanged =
      previous.coreSnapshot.status !== nextSnapshot.status
        ? [
            event("workflow_status_changed", this.now(), {
              from: previous.coreSnapshot.status,
              to: nextSnapshot.status,
            }),
          ]
        : statusChanged;
    const withObservation = await this.updateRun(
      previous,
      nextSnapshot,
      formArtifact.effect ?? advanced.effect,
      [
        ...extraEvents,
        ...observed,
        ...formArtifact.events,
        ...nextStatusChanged,
      ],
    );
    if (formArtifact.effect?.kind === "none") return withObservation;
    if (advanced.effect.kind === "send_agent_turn") {
      return this.queueEffect(withObservation, advanced.effect);
    }
    if (advanced.effect.kind === "create_human_form")
      return this.createHumanFormEffect(withObservation, advanced.effect);
    if (advanced.effect.kind === "start_workflow_call")
      return this.startWorkflowCallEffect(withObservation, advanced.effect);
    if (advanced.effect.kind === "start_github_ci_watch")
      return this.startGithubCiWatchEffect(withObservation, advanced.effect);
    if (advanced.effect.kind === "start_command")
      return this.startCommandEffect(withObservation, advanced.effect);
    return withObservation;
  }

  private applyFormArtifactResult(
    previous: PersistedWorkflowRunReadModel,
    snapshot: WorkflowRuntimeSnapshot,
  ): {
    snapshot: WorkflowRuntimeSnapshot;
    events: PersistedWorkflowRuntimeEvent[];
    effect?: WorkflowPlanEffect;
  } {
    const transition = snapshot.latestTransition;
    const parsed = transition?.parsed;
    if (!transition || !parsed) return { snapshot, events: [] };
    const rawFormSchema = parsed.formSchema;
    if (typeof rawFormSchema !== "string" || !rawFormSchema.trim())
      return { snapshot, events: [] };
    try {
      const form = parseWorkflowBeadsFormSchema(rawFormSchema);
      assertStandardBeadsForm(form);
      const compiled = compileBeadsForm(form);
      const ref = createBeadsFormWorkflowArtifactRef({
        idempotencyKey: `${previous.runId}:${transition.visitId}:${transition.action}:formSchema`,
        title: compiled.title,
        formSchema: form,
      });
      const nextParsed = {
        ...parsed,
        artifactRef:
          typeof parsed.artifactRef === "string" && parsed.artifactRef.trim()
            ? parsed.artifactRef
            : ref.durableRef,
      };
      return {
        snapshot: {
          ...snapshot,
          latestTransition: { ...transition, parsed: nextParsed },
        },
        events: [
          event("form_artifact_created", this.now(), {
            action: transition.action,
            artifactRef: nextParsed.artifactRef,
            formId: compiled.id,
          }),
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failedSnapshot: WorkflowRuntimeSnapshot = {
        ...snapshot,
        status: "failed",
        blockedReason: {
          code: "WORKFLOW_DECISION_VALIDATION_FAILED",
          path: "latestTransition.parsed.formSchema",
          message: `Invalid beads-form schema: ${message}`,
        },
        updatedAt: this.now(),
      };
      return {
        snapshot: failedSnapshot,
        events: [
          event("form_artifact_failed", this.now(), {
            action: transition.action,
            error: message,
          }),
        ],
        effect: { kind: "none" },
      };
    }
  }

  private async persistPlanResult(
    previous: PersistedWorkflowRunReadModel,
    snapshot: WorkflowRuntimeSnapshot,
    effect: WorkflowPlanEffect,
  ): Promise<PersistedWorkflowRunReadModel> {
    const planned = await this.updateRun(previous, snapshot, effect, []);
    if (effect.kind === "send_agent_turn")
      return this.queueEffect(planned, effect);
    if (effect.kind === "create_human_form")
      return this.createHumanFormEffect(planned, effect);
    if (effect.kind === "start_workflow_call")
      return this.startWorkflowCallEffect(planned, effect);
    if (effect.kind === "start_github_ci_watch")
      return this.startGithubCiWatchEffect(planned, effect);
    if (effect.kind === "start_command")
      return this.startCommandEffect(planned, effect);
    return planned;
  }

  private async startCommandEffect(
    run: PersistedWorkflowRunReadModel,
    effect: Extract<WorkflowPlanEffect, { kind: "start_command" }>,
  ): Promise<PersistedWorkflowRunReadModel> {
    if (
      run.coreSnapshot.history.some(
        (entry) =>
          entry.kind === "command_step_completed" &&
          entry.turnId === effect.turnId,
      )
    ) {
      return run;
    }
    const idempotencyKey = `${run.runId}:${run.coreSnapshot.visitId}:${effect.stepId}:${effect.turnId}`;
    const attemptExists = run.events.some(
      (entry) =>
        entry.kind === "command_attempt_created" &&
        entry.data.turnId === effect.turnId,
    );
    const withAttempt = attemptExists
      ? run
      : await this.updateRun(run, run.coreSnapshot, effect, [
          event("command_attempt_created", this.now(), {
            turnId: effect.turnId,
            provider: effect.provider,
            command: effect.command,
            access: effect.policy?.access ?? "read",
            idempotencyKey,
          }),
        ]);
    try {
      const executed = await this.executeCommandEffect(
        withAttempt,
        effect,
        idempotencyKey,
      );
      const result = sanitizeCommandResult(executed.result, executed.policy);
      const observation: WorkflowCommandObservation = {
        kind: "command_completed",
        turnId: effect.turnId,
        responseRef: result.artifactRef ?? `command:${effect.turnId}`,
        provider: effect.provider,
        command: effect.command,
        result: result.result,
        summary: result.summary,
        artifactRef: result.artifactRef,
      };
      const advanced = advanceWorkflow(
        withAttempt.coreModel,
        withAttempt.coreSnapshot,
        observation,
        this.deps(),
      );
      if (advanced.ignored) return withAttempt;
      return this.persistAdvanceResult(
        withAttempt,
        advanced,
        { turnId: effect.turnId, responseRef: observation.responseRef },
        [
          event("command_step_completed", this.now(), {
            turnId: effect.turnId,
            provider: effect.provider,
            command: effect.command,
            summary: result.summary,
            artifactRef: result.artifactRef ?? null,
            stdoutPreview: result.stdoutPreview ?? null,
            stdoutTruncated: result.stdoutTruncated === true,
            stderrPreview: result.stderrPreview ?? null,
            stderrTruncated: result.stderrTruncated === true,
            provenance: result.provenance,
          }),
        ],
        null,
      );
    } catch (error) {
      return this.blockCommandEffect(withAttempt, effect, normalizeCommandError(error));
    }
  }

  private async executeCommandEffect(
    run: PersistedWorkflowRunReadModel,
    effect: Extract<WorkflowPlanEffect, { kind: "start_command" }>,
    idempotencyKey: string,
  ): Promise<{
    result: WorkflowCommandResult;
    policy: ReturnType<typeof normalizeCommandPolicy>;
  }> {
    const provider = this.commandProviders.get(effect.provider);
    if (!provider) {
      throw new WorkflowCommandProviderError({
        code: "WORKFLOW_COMMAND_UNKNOWN_PROVIDER",
        path: `states.${effect.state}.steps.${effect.stepId}.provider`,
        message: `unknown command provider ${effect.provider}`,
      });
    }
    const spec = provider
      .listCommands()
      .find((candidate) => candidate.command === effect.command);
    if (!spec) {
      throw new WorkflowCommandProviderError({
        code: "WORKFLOW_COMMAND_UNKNOWN_ACTION",
        path: `states.${effect.state}.steps.${effect.stepId}.command`,
        message: `unknown command ${effect.command} for provider ${effect.provider}`,
      });
    }
    const policy = normalizeCommandPolicy(effect, spec);
    validateCommandPolicyAgainstSpec({
      provider: effect.provider,
      command: effect.command,
      policy,
      spec,
      path: `states.${effect.state}.steps.${effect.stepId}`,
    });
    const lane = await this.resolveCommandLane(run, policy.access);
    if (policy.access === "write") {
      if (!lane) {
        throw new WorkflowCommandProviderError({
          code: "WORKFLOW_COMMAND_DENIED",
          path: `states.${effect.state}.steps.${effect.stepId}.policy.access`,
          message: "Write-capable command requires a selected workflow lane.",
          productMessage: "Select a lane with write capacity before running this command.",
        });
      }
      if (lane.capacity.write.status !== "held") {
        throw new WorkflowCommandProviderError({
          code: "WORKFLOW_COMMAND_DENIED",
          path: `states.${effect.state}.steps.${effect.stepId}.policy.access`,
          message: `Lane write capacity is ${lane.capacity.write.status}.`,
          productMessage: lane.nextAction,
        });
      }
    }
    const result = await provider.executeCommand({
      provider: effect.provider,
      command: effect.command,
      args: effect.args,
      policy,
      context: {
        runId: run.runId,
        workspaceId: run.workspaceId,
        stateId: effect.state,
        stepId: effect.stepId,
        turnId: effect.turnId,
        idempotencyKey,
        lane,
        writeToken: lane?.capacity.write.activeLeaseId
          ? {
              leaseId: lane.capacity.write.activeLeaseId,
              ownerId: lane.capacity.write.ownerId ?? "workflow",
            }
          : null,
      },
    });
    return { result, policy };
  }

  private async resolveCommandLane(
    run: PersistedWorkflowRunReadModel,
    access: "read" | "write",
  ) {
    if (!this.laneStore) return null;
    const binding = await this.laneStore.getBinding("workflow_run", run.runId);
    if (!binding) return null;
    return this.laneStore.getLane(binding.parentWorkspaceId, binding.laneId);
  }

  private async blockCommandEffect(
    run: PersistedWorkflowRunReadModel,
    effect: Extract<WorkflowPlanEffect, { kind: "start_command" }>,
    error: WorkflowCommandProviderError,
  ): Promise<PersistedWorkflowRunReadModel> {
    const reason: WorkflowRuntimeIssue = {
      code:
        error.code === "WORKFLOW_COMMAND_FAILED"
          ? "WORKFLOW_COMMAND_FAILED"
          : "WORKFLOW_COMMAND_DENIED",
      path: error.path,
      message: error.productMessage,
    };
    const blockedSnapshot: WorkflowRuntimeSnapshot = {
      ...run.coreSnapshot,
      status: "blocked",
      waitingFor: undefined,
      blockedReason: reason,
      history: [
        ...run.coreSnapshot.history,
        { kind: "workflow_blocked", at: this.now(), reason },
      ],
      updatedAt: this.now(),
    };
    return this.updateRun(run, blockedSnapshot, { kind: "none" }, [
      event("command_step_denied", this.now(), {
        turnId: effect.turnId,
        provider: effect.provider,
        command: effect.command,
        code: error.code,
        message: error.productMessage,
        retryable: error.retryable,
      }),
      event("workflow_status_changed", this.now(), {
        from: run.coreSnapshot.status,
        to: "blocked",
      }),
    ]);
  }

  private async startGithubCiWatchEffect(
    run: PersistedWorkflowRunReadModel,
    effect: Extract<WorkflowPlanEffect, { kind: "start_github_ci_watch" }>,
  ): Promise<PersistedWorkflowRunReadModel> {
    const existingStart = run.events.find(
      (entry) =>
        entry.kind === "github_ci_watch_started" &&
        entry.data.turnId === effect.turnId,
    );
    if (existingStart) return run;
    if (!this.githubCiWatchProvider) {
      const reason: WorkflowRuntimeIssue = {
        code: "WORKFLOW_DECISION_VALIDATION_FAILED",
        path: `states.${effect.state}.actions.${effect.action}.waitFor`,
        message: "GitHub CI wait provider is not configured",
      };
      const failedSnapshot: WorkflowRuntimeSnapshot = {
        ...run.coreSnapshot,
        status: "blocked",
        waitingFor: undefined,
        blockedReason: reason,
        history: [
          ...run.coreSnapshot.history,
          { kind: "workflow_blocked", at: this.now(), reason },
        ],
        updatedAt: this.now(),
      };
      return this.updateRun(run, failedSnapshot, { kind: "none" }, [
        event("github_ci_watch_provider_missing", this.now(), {
          turnId: effect.turnId,
          action: effect.action,
        }),
        event("workflow_status_changed", this.now(), {
          from: run.coreSnapshot.status,
          to: "blocked",
        }),
      ]);
    }
    const started = await this.githubCiWatchProvider.startWatch({
      runId: run.runId,
      workspaceId: run.workspaceId,
      turnId: effect.turnId,
      action: effect.action,
      ciRunId: effect.ciRunId,
      checkRunId: effect.checkRunId,
      repo: effect.repo,
      sha: effect.sha,
    });
    return this.updateRun(run, run.coreSnapshot, effect, [
      event("github_ci_watch_started", this.now(), {
        turnId: effect.turnId,
        action: effect.action,
        watchRef: started.watchRef,
        ciRunId: effect.ciRunId ?? null,
        checkRunId: effect.checkRunId ?? null,
        repo: effect.repo ?? null,
        sha: effect.sha ?? null,
      }),
    ]);
  }

  private async startWorkflowCallEffect(
    run: PersistedWorkflowRunReadModel,
    effect: Extract<WorkflowPlanEffect, { kind: "start_workflow_call" }>,
  ): Promise<PersistedWorkflowRunReadModel> {
    const existingStart = run.events.find(
      (entry) =>
        entry.kind === "workflow_call_started" &&
        entry.data.turnId === effect.turnId,
    );
    let childRun = await this.getRun(effect.childRunId);
    if (!childRun) {
      const roleBindings = await this.resolveChildRoleBindings(
        effect,
        run.roleBindings,
      );
      childRun = await this.launch({
        runId: effect.childRunId,
        runSnapshotId: `${effect.childRunId}-snapshot`,
        designId: effect.workflow.designId,
        version: effect.workflow.version,
        workspaceId: run.workspaceId,
        inputs: effect.args,
        roleBindings,
      });
    }
    const withStart = existingStart
      ? run
      : await this.updateRun(run, run.coreSnapshot, effect, [
          event("workflow_call_started", this.now(), {
            turnId: effect.turnId,
            childRunId: childRun.runId,
            childDesignId: childRun.designId,
            childDesignVersion: childRun.designVersion,
            childStatus: childRun.status,
          }),
        ]);
    if (childRun.status !== "running") {
      return (
        await this.completeWorkflowCall({
          runId: run.runId,
          turnId: effect.turnId,
          childRunId: childRun.runId,
          responseRef: childRun.runId,
          childStatus: childRun.status,
          outputRef: childOutputRef(childRun.runId),
          statusSummary: childRun.status,
        })
      ).run;
    }
    return withStart;
  }

  private async createHumanFormEffect(
    run: PersistedWorkflowRunReadModel,
    effect: Extract<WorkflowPlanEffect, { kind: "create_human_form" }>,
  ): Promise<PersistedWorkflowRunReadModel> {
    if (!this.orchestrationStore) return run;
    const idempotencyKey = `${run.runId}:${run.coreSnapshot.visitId}:${effect.stepId}`;
    const artifact = await this.extensionRegistry.createArtifact(
      {
        providerType: effect.form.providerType,
        artifactKind: "form",
        idempotencyKey,
        input: {
          title: effect.title,
          descriptionMarkdown: effect.description,
          formSchema: effect.form.formSchema,
          submitLabel: effect.form.submitLabel,
        },
      },
      {
        run: {
          runId: run.runId,
          workspaceId: run.workspaceId,
          stateId: effect.state,
          visitId: run.coreSnapshot.visitId,
        },
      },
    );
    await this.ensureMirrorHumanInstance(
      run,
      effect,
      artifact.artifactRef.durableRef,
    );
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
    return this.updateRun(
      run,
      run.coreSnapshot,
      effect,
      attention.created
        ? [
            event("human_form_created", this.now(), {
              turnId: effect.turnId,
              attentionItemId: attention.item.attentionItemId,
              formRef: artifact.artifactRef.durableRef,
            }),
          ]
        : [],
    );
  }

  private async ensureMirrorHumanInstance(
    run: PersistedWorkflowRunReadModel,
    effect: Extract<WorkflowPlanEffect, { kind: "create_human_form" }>,
    formRef: string,
  ): Promise<void> {
    if (!this.orchestrationStore) return;
    const existing = await this.orchestrationStore.getInstance(run.runId);
    if (!existing) {
      await this.orchestrationStore.createInstance({
        instanceId: run.runId,
        workflowId: run.coreModel.workflowId,
        trigger: "workflow_run",
        input: { ...run.coreSnapshot.inputs, workspaceId: run.workspaceId },
        state: {
          definition: { name: run.coreModel.name },
          persistedWorkflowRunId: run.runId,
        },
      });
      await this.orchestrationStore.startInstance(run.runId, {
        currentStepId: effect.stepId,
      });
    } else if (existing.status !== "running") {
      return;
    }
    const stepStateId = `${run.runId}-${effect.turnId}`;
    const existingSteps = await this.orchestrationStore.listStepStates(
      run.runId,
    );
    if (!existingSteps.some((step) => step.id === stepStateId)) {
      await this.orchestrationStore.createStepState({
        id: stepStateId,
        instanceId: run.runId,
        stepKey: effect.stepId,
        input: {
          title: effect.title,
          description: effect.description ?? null,
          formRef,
        },
      });
      await this.orchestrationStore.markStepRunning(stepStateId);
    }
  }

  private async queueEffect(
    run: PersistedWorkflowRunReadModel,
    effect: Extract<WorkflowPlanEffect, { kind: "send_agent_turn" }>,
  ): Promise<PersistedWorkflowRunReadModel> {
    if (run.queuedTurns[effect.turnId]) return run;
    const binding = run.roleBindings[effect.role];
    if (!binding?.sessionId)
      throw new PersistedWorkflowRuntimeError(
        "WORKFLOW_RUNTIME_MISSING_ROLE_BINDING",
        `roleBindings.${effect.role}.sessionId`,
        `missing session binding for role ${effect.role}`,
      );
    try {
      const beadContext = await resolveWorkflowBeadPromptContext({
        inputs: run.coreSnapshot.inputs,
        provider: this.beadProvider,
      });
      const prompt = composeWorkflowAgentPrompt({
        basePrompt: effect.prompt,
        beadContext,
      });
      const queued = await this.queue.queueAgentTurn({
        runId: run.runId,
        workspaceId: run.workspaceId,
        sessionId: binding.sessionId,
        role: effect.role,
        state: effect.state,
        stepId: effect.stepId,
        turnId: effect.turnId,
        prompt,
        provenance: {
          kind: "workflow",
          label: "Workflow automation",
          workflow_run_id: run.runId,
          workflow_name: run.coreModel.name,
          workflow_design_id: run.designId,
          workflow_version: run.designVersion,
          workflow_role_id: effect.role,
          workflow_role_executor: binding.executorType ?? null,
          workflow_role_model: binding.model ?? null,
        },
        executorPreference: {
          executorType: binding.executorType ?? null,
          model: binding.model ?? null,
          mode: binding.preferenceMode ?? "preferred",
        },
      });
      const queuedTurns = {
        ...run.queuedTurns,
        [effect.turnId]: {
          ...queued,
          role: effect.role,
          sessionId: binding.sessionId,
          executorType: binding.executorType ?? null,
          model: binding.model ?? null,
        },
      };
      return this.updateRun(
        run,
        run.coreSnapshot,
        effect,
        [
          event("agent_turn_queued", this.now(), {
            turnId: effect.turnId,
            role: effect.role,
            sessionId: binding.sessionId,
            executorType: binding.executorType ?? null,
            model: binding.model ?? null,
            queueItemRef: queued.queueItemRef,
            promptPreview: prompt.slice(0, 4096),
            promptTruncated: prompt.length > 4096,
            beadIds: beadContext?.beadIds ?? [],
          }),
        ],
        queuedTurns,
      );
    } catch (error) {
      const runtimeError = normalizeError(error);
      const failedSnapshot: WorkflowRuntimeSnapshot = {
        ...run.coreSnapshot,
        status: "failed",
        updatedAt: this.now(),
        blockedReason: {
          code: "WORKFLOW_DECISION_VALIDATION_FAILED",
          path: "queue",
          message: runtimeError.message,
        } as WorkflowRuntimeIssue,
      };
      return this.updateRun(
        run,
        failedSnapshot,
        { kind: "none" },
        [
          event("queue_failed", this.now(), {
            turnId: effect.turnId,
            error: runtimeError,
          }),
        ],
        run.queuedTurns,
        runtimeError,
      );
    }
  }

  private async updateRun(
    previous: PersistedWorkflowRunReadModel,
    snapshot: WorkflowRuntimeSnapshot,
    pendingEffect: WorkflowPlanEffect | null,
    newEvents: PersistedWorkflowRuntimeEvent[],
    queuedTurns: PersistedWorkflowRunReadModel["queuedTurns"] = previous.queuedTurns,
    error: unknown | null = previous.error,
  ): Promise<PersistedWorkflowRunReadModel> {
    const now = this.now();
    const events = [...previous.events, ...newEvents];
    await this.db
      .updateTable("WorkflowPersistedRun")
      .set({
        status: snapshot.status,
        coreSnapshotJson: stableJson(snapshot),
        pendingEffectJson: pendingEffect ? stableJson(pendingEffect) : null,
        queuedTurnsJson: stableJson(queuedTurns),
        eventsJson: stableJson(events),
        errorJson: error == null ? null : stableJson(error),
        updatedAt: now,
      })
      .where("runId", "=", previous.runId)
      .execute();
    return this.getRequiredRun(previous.runId);
  }

  private async getRequiredRun(
    runId: string,
  ): Promise<PersistedWorkflowRunReadModel> {
    const run = await this.getRun(runId);
    if (!run)
      throw new PersistedWorkflowRuntimeError(
        "WORKFLOW_RUNTIME_RUN_NOT_FOUND",
        "runId",
        `workflow run ${runId} not found`,
      );
    return run;
  }

  private assertRoleBindings(
    model: NormalizedAgentWorkflowModel,
    roleBindings: Record<string, WorkflowRoleSessionBindingInput>,
  ): void {
    for (const roleId of Object.keys(model.roles)) {
      if (!roleBindings[roleId]?.sessionId) {
        throw new PersistedWorkflowRuntimeError(
          "WORKFLOW_RUNTIME_MISSING_ROLE_BINDING",
          `roleBindings.${roleId}.sessionId`,
          `missing session binding for role ${roleId}`,
        );
      }
    }
  }

  private async resolveChildRoleBindings(
    effect: Extract<WorkflowPlanEffect, { kind: "start_workflow_call" }>,
    parentBindings: Record<string, WorkflowRoleSessionBindingInput>,
  ): Promise<Record<string, WorkflowRoleSessionBindingInput>> {
    const design = await this.designStore.getDesign(effect.workflow.designId);
    const version = effect.workflow.version ?? design?.latestPublishedVersion;
    if (version == null)
      throw new PersistedWorkflowRuntimeError(
        "WORKFLOW_RUNTIME_RUN_NOT_FOUND",
        `workflowCall.${effect.stepId}.workflow.designId`,
        `workflow design ${effect.workflow.designId} has no published version`,
      );
    const childVersion = await this.designStore.getVersion(
      effect.workflow.designId,
      version,
    );
    if (!childVersion)
      throw new PersistedWorkflowRuntimeError(
        "WORKFLOW_RUNTIME_RUN_NOT_FOUND",
        `workflowCall.${effect.stepId}.workflow.designId`,
        `workflow design ${effect.workflow.designId} version ${version} not found`,
      );
    const childModel = normalizeWorkflowDefinitionV1(
      childVersion.resolvedDefinition,
      { workflowId: `${childVersion.designId}@${childVersion.version}` },
    );
    const bindings: Record<string, WorkflowRoleSessionBindingInput> = {};
    for (const roleId of Object.keys(childModel.roles)) {
      const explicit = effect.roleBindings?.[roleId]?.fromParentRole;
      const parentRole = explicit ?? roleId;
      const binding = parentBindings[parentRole];
      if (!binding?.sessionId) {
        throw new PersistedWorkflowRuntimeError(
          "WORKFLOW_RUNTIME_MISSING_ROLE_BINDING",
          `workflowCall.${effect.stepId}.roleBindings.${roleId}`,
          `missing parent session binding for child role ${roleId}`,
        );
      }
      bindings[roleId] = { ...binding };
    }
    return bindings;
  }

  private async resumeParentsIfTerminal(
    child: PersistedWorkflowRunReadModel,
  ): Promise<void> {
    if (child.status === "running") return;
    const parents = await this.db
      .selectFrom("WorkflowPersistedRun")
      .selectAll()
      .where("status", "=", "running")
      .execute();
    for (const row of parents) {
      const parent = mapRun(row);
      const waitingFor = parent.coreSnapshot.waitingFor;
      if (
        waitingFor?.kind !== "workflow_call" ||
        waitingFor.childRunId !== child.runId
      )
        continue;
      await this.completeWorkflowCall({
        runId: parent.runId,
        turnId: waitingFor.turnId,
        childRunId: child.runId,
        responseRef: child.runId,
        childStatus: child.status,
        outputRef: childOutputRef(child.runId),
        statusSummary: child.status,
      });
    }
  }

  private deps() {
    return {
      now: this.now,
      createId: this.createId,
      validator: this.validator,
    };
  }
}

export class SimpleWorkflowXmlDecisionValidator implements DecisionResponseValidator {
  validate(args: {
    actions: Record<string, NormalizedWorkflowAction>;
    responseText: string;
    rawXmlMaxChars: number;
  }): DecisionValidationResult {
    const text = args.responseText.trim();
    if (!text.startsWith("<") || !text.endsWith(">")) {
      return invalidXml("response must be XML");
    }
    const action = readAction(text);
    if (!action) return invalidXml("XML response must include an action");
    const parsed = readSimpleFields(text);
    delete parsed.action;
    const unknownFields = Object.keys(parsed).filter(
      (key) =>
        !Object.values(args.actions).some(
          (candidate) => candidate.result?.fields?.[key],
        ),
    );
    return { valid: true, action, rawXml: text, parsed, unknownFields };
  }
}

function readAction(xml: string): string | null {
  const attr = xml.match(
    /<decision\b[^>]*\baction=["']([^"']+)["'][^>]*>/iu,
  )?.[1];
  if (attr) return attr;
  return xml.match(/<action>([\s\S]*?)<\/action>/iu)?.[1]?.trim() || null;
}

function readSimpleFields(xml: string): Record<string, unknown> {
  const parsed: Record<string, unknown> = {};
  const tagPattern = /<([A-Za-z_][\w.-]*)>([\s\S]*?)<\/\1>/gu;
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(xml)) !== null) {
    const [, tag, rawValue] = match;
    if (!tag || tag === "decision") continue;
    const value = stripCdata(rawValue ?? "").trim();
    const existing = parsed[tag];
    if (existing === undefined) parsed[tag] = value;
    else if (Array.isArray(existing)) existing.push(value);
    else parsed[tag] = [existing, value];
  }
  return parsed;
}

function stripCdata(value: string): string {
  return value.replace(/^<!\[CDATA\[/u, "").replace(/\]\]>$/u, "");
}

function invalidXml(message: string): DecisionValidationResult {
  return {
    valid: false,
    errors: [
      { code: "WORKFLOW_DECISION_VALIDATION_FAILED", path: "$", message },
    ],
  };
}

function assertStandardBeadsForm(
  form: Parameters<typeof compileBeadsForm>[0],
): void {
  const record = form as {
    format?: unknown;
    title?: unknown;
    questions?: unknown;
  };
  if (record.format !== "standard")
    throw new Error("form format must be standard");
  if (typeof record.title !== "string" || !record.title.trim())
    throw new Error("form title is required");
  if (!Array.isArray(record.questions) || record.questions.length === 0)
    throw new Error("form questions must be non-empty");
}


function parseWorkflowBeadsFormSchema(rawFormSchema: string): Parameters<typeof compileBeadsForm>[0] {
  const trimmed = rawFormSchema.trim();
  if (trimmed.startsWith("<")) return parseBeadsFormXml(trimmed);
  return JSON.parse(trimmed) as Parameters<typeof compileBeadsForm>[0];
}

function event(
  kind: PersistedWorkflowRuntimeEvent["kind"],
  at: number,
  data: Record<string, unknown>,
): PersistedWorkflowRuntimeEvent {
  return { kind, at, data };
}

function mapRun(
  row: Selectable<WorkflowPersistedRun>,
): PersistedWorkflowRunReadModel {
  return {
    runId: row.runId,
    runSnapshotId: row.runSnapshotId,
    designId: row.designId,
    designVersion: row.designVersion,
    workspaceId: row.workspaceId,
    status: row.status,
    coreModel: JSON.parse(row.coreModelJson) as NormalizedAgentWorkflowModel,
    coreSnapshot: JSON.parse(row.coreSnapshotJson) as WorkflowRuntimeSnapshot,
    roleBindings: JSON.parse(row.roleBindingsJson) as Record<
      string,
      WorkflowRoleSessionBindingInput
    >,
    pendingEffect: row.pendingEffectJson
      ? (JSON.parse(row.pendingEffectJson) as WorkflowPlanEffect)
      : null,
    queuedTurns: JSON.parse(
      row.queuedTurnsJson,
    ) as PersistedWorkflowRunReadModel["queuedTurns"],
    events: JSON.parse(row.eventsJson) as PersistedWorkflowRuntimeEvent[],
    error: row.errorJson ? (JSON.parse(row.errorJson) as unknown) : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function resolveRuntimeRoleBindings(
  model: NormalizedAgentWorkflowModel,
  input: Record<string, WorkflowRoleSessionBindingInput>,
): Record<string, WorkflowRoleSessionBindingInput> {
  const resolved: Record<string, WorkflowRoleSessionBindingInput> = {};
  for (const [roleId, role] of Object.entries(model.roles)) {
    const binding = input[roleId];
    const preference = role.executorPreference;
    resolved[roleId] = {
      ...binding,
      sessionId: binding?.sessionId ?? "",
      workspaceId: binding?.workspaceId,
      executorType: binding?.executorType ?? preference?.executorType ?? null,
      model: binding?.model ?? preference?.model ?? null,
      preferenceMode:
        binding?.preferenceMode ?? preference?.mode ?? "preferred",
      preferenceSource:
        binding?.preferenceSource ??
        (preference ? "role_default" : "workspace_default"),
    };
  }
  for (const [roleId, binding] of Object.entries(input)) {
    if (resolved[roleId]) continue;
    resolved[roleId] = { ...binding };
  }
  return resolved;
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

function normalizeError(error: unknown): { name: string; message: string } {
  if (error instanceof Error)
    return { name: error.name, message: error.message };
  return { name: "NonErrorThrown", message: String(error) };
}

function sanitizeCommandResult(
  result: WorkflowCommandResult,
  policy: ReturnType<typeof normalizeCommandPolicy>,
): WorkflowCommandResult {
  const stdoutCap = policy.output.stdoutMaxChars;
  const stderrCap = policy.output.stderrMaxChars;
  const stdout = result.stdoutPreview
    ? capText(redact(result.stdoutPreview), stdoutCap)
    : null;
  const stderr = result.stderrPreview
    ? capText(redact(result.stderrPreview), stderrCap)
    : null;
  const combined = enforceCombinedOutputCap({
    stdoutText: stdout?.text,
    stderrText: stderr?.text,
    stdoutTruncated: result.stdoutTruncated === true || stdout?.truncated === true,
    stderrTruncated: result.stderrTruncated === true || stderr?.truncated === true,
    combinedMaxChars: policy.output.combinedMaxChars,
  });
  const sanitizedResult = Object.fromEntries(
    Object.entries(result.result).map(([key, value]) => [
      key,
      typeof value === "string" ? redact(value) : value,
    ]),
  );
  return {
    ...result,
    result: sanitizedResult,
    summary: redact(result.summary),
    stdoutPreview: combined.stdoutText,
    stderrPreview: combined.stderrText,
    stdoutTruncated: combined.stdoutTruncated,
    stderrTruncated: combined.stderrTruncated,
  };
}

function enforceCombinedOutputCap(args: {
  stdoutText?: string;
  stderrText?: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  combinedMaxChars: number;
}): { stdoutText?: string; stderrText?: string; stdoutTruncated: boolean; stderrTruncated: boolean } {
  const stdoutLength = args.stdoutText?.length ?? 0;
  const stderrLength = args.stderrText?.length ?? 0;
  if (stdoutLength + stderrLength <= args.combinedMaxChars) {
    return {
      stdoutText: args.stdoutText,
      stderrText: args.stderrText,
      stdoutTruncated: args.stdoutTruncated,
      stderrTruncated: args.stderrTruncated,
    };
  }

  const stdoutAllowed = Math.min(stdoutLength, args.combinedMaxChars);
  const stderrAllowed = Math.max(0, args.combinedMaxChars - stdoutAllowed);
  return {
    stdoutText: args.stdoutText?.slice(0, stdoutAllowed),
    stderrText: args.stderrText?.slice(0, stderrAllowed),
    stdoutTruncated: args.stdoutTruncated || stdoutLength > stdoutAllowed,
    stderrTruncated: args.stderrTruncated || stderrLength > stderrAllowed,
  };
}

function normalizeCommandError(error: unknown): WorkflowCommandProviderError {
  if (error instanceof WorkflowCommandProviderError) return error;
  const normalized = normalizeError(error);
  return new WorkflowCommandProviderError({
    code: "WORKFLOW_COMMAND_FAILED",
    path: "command",
    message: normalized.message,
    productMessage: "The command provider failed before completing safely.",
    retryable: false,
  });
}

function childOutputRef(childRunId: string): string {
  return `workflow-run://${encodeURIComponent(childRunId)}/output`;
}

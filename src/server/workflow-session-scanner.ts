import type { Kysely, Selectable } from "kysely";
import type {
  DB,
  WorkflowExternalWait,
  WorkflowRoleSessionBinding,
  WorkflowScopedTriggerStatus,
} from "../store/kysely_types";
import type {
  ActivitySession,
  ActivitySnapshot,
  AgentResponse,
  ExecutionProcess,
} from "./vk-client";
import type {
  DbWorkflowOrchestrationStore,
  WorkflowScopedTriggerReadModel,
} from "./workflow-orchestration-store";

/**
 * VD-owned workflow scheduling read model.
 *
 * This scanner is intentionally read/model-only for M02. It observes VK status
 * and VD workflow ownership records, then classifies sessions for later durable
 * trigger/scheduler workers. VK remains the execution/queue safety primitive;
 * VD uses this model to decide when workflow-owned sessions consume execution
 * budget, when they merely hold session ownership (callback/CI waits), and when
 * a session should not be reused for unrelated work.
 */
export type WorkflowSessionClassification =
  | "idle"
  | "queued_reserved"
  | "running"
  | "waiting_on_callback"
  | "waiting_on_ci"
  | "completed_since_cursor"
  | "failed_or_killed"
  | "stalled_needs_attention"
  | "unknown_unreachable";

export interface WorkflowScannerVkClient {
  getActivitySnapshot(): Promise<ActivitySnapshot>;
  getSessionLatestResponse(
    sessionId: string,
    cursor?: {
      afterExecutionProcessId?: string | null;
      afterCompletedAt?: string | null;
    },
  ): Promise<AgentResponse | null>;
  getExecutionProcess(processId: string): Promise<ExecutionProcess>;
  getExecutionProcessFinalMessage(processId: string): Promise<AgentResponse>;
}

export interface WorkflowSessionScanItem {
  workspaceId: string;
  sessionId: string;
  roleId: string | null;
  roleName: string | null;
  laneId: string | null;
  instanceId: string | null;
  stepStateId: string | null;
  triggerId: string | null;
  bindingId: string | null;
  externalWaitId: string | null;
  classification: WorkflowSessionClassification;
  reason: string;
  ownsWorkflowSession: boolean;
  consumesExecutionBudget: boolean;
  eligibleForUnrelatedWork: boolean;
  queueCount: number;
  runningExecutionProcessIds: string[];
  completedResponse: AgentResponse | null;
  executionProcess: ExecutionProcess | null;
  updatedAt: number;
  warnings: string[];
}

export interface WorkflowSchedulerBudgetPolicy {
  maxActiveExecutions: number;
  maxWorkflowOwnedSessions?: number | null;
}

export interface WorkflowSchedulerBudgetSnapshot {
  maxActiveExecutions: number;
  activeExecutionCount: number;
  availableExecutionSlots: number;
  maxWorkflowOwnedSessions: number | null;
  workflowOwnedSessionCount: number;
  availableWorkflowOwnedSessionSlots: number | null;
  vkQueuedCount: number;
  eligibleSessionCount: number;
  blockedSessionCount: number;
  eligibleSessions: WorkflowSchedulerSessionRef[];
}

export interface WorkflowSchedulerSessionRef {
  workspaceId: string;
  sessionId: string;
  roleId: string | null;
  laneId: string | null;
  bindingId: string | null;
}

export interface WorkflowActivityScanResult {
  generatedAt: number;
  vkGeneratedAt: string | null;
  callbackStateAvailable: boolean;
  sessions: WorkflowSessionScanItem[];
  budget: WorkflowSchedulerBudgetSnapshot;
  warnings: string[];
}

export class WorkflowActivityScanner {
  private readonly getDbHandle: () => Promise<Kysely<DB>> | Kysely<DB>;
  private readonly vk: WorkflowScannerVkClient;
  private readonly orchestrationStore: DbWorkflowOrchestrationStore;
  private readonly now: () => number;

  constructor(options: {
    db?: Kysely<DB>;
    getDb?: () => Promise<Kysely<DB>> | Kysely<DB>;
    vk: WorkflowScannerVkClient;
    orchestrationStore: DbWorkflowOrchestrationStore;
    now?: () => number;
  }) {
    if (!options.db && !options.getDb)
      throw new Error("WorkflowActivityScanner requires db or getDb");
    this.getDbHandle = options.getDb ?? (() => options.db as Kysely<DB>);
    this.vk = options.vk;
    this.orchestrationStore = options.orchestrationStore;
    this.now = options.now ?? Date.now;
  }

  async scanOnce(
    policy: WorkflowSchedulerBudgetPolicy,
  ): Promise<WorkflowActivityScanResult> {
    const generatedAt = this.now();
    const db = await this.getDb();
    const [bindings, triggers, externalWaits, activityResult] =
      await Promise.all([
        this.listValidBindings(db),
        this.listAllActiveTriggers(),
        this.listActiveExternalWaits(db),
        this.vk.getActivitySnapshot().then(
          (snapshot) => ({ ok: true as const, snapshot }),
          (error: unknown) => ({ ok: false as const, error }),
        ),
      ]);

    const warnings: string[] = [];
    let snapshot: ActivitySnapshot | null = null;
    if (activityResult.ok) {
      snapshot = activityResult.snapshot;
    } else {
      warnings.push(
        `VK activity snapshot unavailable: ${formatError(activityResult.error)}`,
      );
    }

    const activityBySession = mapActivityBySession(snapshot);
    const contexts = buildScanContexts(
      bindings,
      triggers,
      externalWaits,
      activityBySession,
    );
    const sessions = await Promise.all(
      contexts.map((context) =>
        this.classifyContext(
          context,
          activityBySession.get(
            sessionKey(context.workspaceId, context.sessionId),
          ),
          generatedAt,
          snapshot == null,
        ),
      ),
    );
    sessions.sort(compareScanItems);

    return {
      generatedAt,
      vkGeneratedAt: snapshot?.generated_at ?? null,
      callbackStateAvailable: snapshot?.callback_state_available ?? false,
      sessions,
      budget: computeWorkflowSchedulerBudget(sessions, snapshot, policy),
      warnings,
    };
  }

  private async classifyContext(
    context: ScanContext,
    activity: ActivitySession | undefined,
    generatedAt: number,
    activityUnavailable: boolean,
  ): Promise<WorkflowSessionScanItem> {
    let base = makeBaseItem(context, activity, generatedAt);
    const trigger = context.trigger;
    const exactExecutionId = getExactExecutionId(trigger);
    let exactExecutionLookupFailed = false;
    if (exactExecutionId) {
      try {
        base = {
          ...base,
          executionProcess: await this.vk.getExecutionProcess(exactExecutionId),
        };
      } catch (error) {
        exactExecutionLookupFailed = true;
        base = {
          ...base,
          warnings: [`VK execution lookup failed: ${formatError(error)}`],
        };
      }
    }

    const timeoutAt = trigger?.timeoutAt ?? null;
    if (timeoutAt != null && timeoutAt <= generatedAt) {
      return applyClassification(
        base,
        "stalled_needs_attention",
        "active workflow trigger timed out",
      );
    }

    if (context.externalWait?.kind === "callback") {
      return applyClassification(
        base,
        "waiting_on_callback",
        "active callback wait owns this session but does not consume execution budget",
      );
    }
    if (context.externalWait?.kind === "ci") {
      return applyClassification(
        base,
        "waiting_on_ci",
        "active CI wait owns this session but does not consume execution budget",
      );
    }

    if (trigger) {
      if (exactExecutionId) {
        if (exactExecutionLookupFailed) {
          return applyClassification(
            base,
            "unknown_unreachable",
            "watched execution lookup failed",
          );
        }
        const execution = base.executionProcess;
        if (execution?.status === "completed") {
          const response = await this.vk
            .getExecutionProcessFinalMessage(exactExecutionId)
            .catch(() => null);
          return applyClassification(
            { ...base, completedResponse: response },
            "completed_since_cursor",
            "watched execution completed",
          );
        }
        if (execution?.status === "failed" || execution?.status === "killed") {
          return applyClassification(
            base,
            "failed_or_killed",
            `watched execution ${execution.status}`,
          );
        }
        if (execution?.status === "running") {
          return applyClassification(
            base,
            "running",
            "watched execution is running",
          );
        }
      }

      if (trigger.mode === "next_completion_after_cursor") {
        try {
          const response = await this.vk.getSessionLatestResponse(
            trigger.sessionId ?? context.sessionId,
            {
              afterExecutionProcessId: trigger.cursorExecutionProcessId,
              afterCompletedAt:
                trigger.cursorCompletedAt == null
                  ? null
                  : new Date(trigger.cursorCompletedAt).toISOString(),
            },
          );
          if (response) {
            return applyClassification(
              { ...base, completedResponse: response },
              "completed_since_cursor",
              "session produced a completed response after trigger cursor",
            );
          }
        } catch (error) {
          return applyClassification(
            {
              ...base,
              warnings: [
                `VK latest-response lookup failed: ${formatError(error)}`,
              ],
            },
            "unknown_unreachable",
            "latest response lookup failed",
          );
        }
      }
    }

    if (activityUnavailable) {
      return applyClassification(
        base,
        "unknown_unreachable",
        "VK activity snapshot unavailable",
      );
    }
    if (
      activity?.status === "callback_waiting" ||
      (activity?.callback.available && activity.callback.waiting_count > 0)
    ) {
      return applyClassification(
        base,
        "waiting_on_callback",
        "VK activity reports callback wait",
      );
    }
    if (activity && activity.running_execution_processes.length > 0) {
      return applyClassification(
        base,
        "running",
        "VK activity reports running execution",
      );
    }
    if (activity && activity.queue.count > 0) {
      return applyClassification(
        base,
        "queued_reserved",
        "VK queue has pending/leased/starting/running work for session",
      );
    }
    if (trigger) {
      return applyClassification(
        base,
        "queued_reserved",
        "active workflow trigger reserves this session until completion is observed",
      );
    }
    return applyClassification(
      base,
      "idle",
      "no active workflow wait or VK activity",
    );
  }

  private async listAllActiveTriggers(): Promise<
    WorkflowScopedTriggerReadModel[]
  > {
    const triggers: WorkflowScopedTriggerReadModel[] = [];
    const limit = 200;
    let offset = 0;
    for (;;) {
      const page = await this.orchestrationStore.listTriggers({
        status: "active",
        limit,
        offset,
      });
      triggers.push(...page.triggers);
      if (!page.hasMore) return triggers;
      offset += page.triggers.length;
    }
  }

  private async listValidBindings(
    db: Kysely<DB>,
  ): Promise<Selectable<WorkflowRoleSessionBinding>[]> {
    return db
      .selectFrom("WorkflowRoleSessionBinding")
      .selectAll()
      .where("valid", "=", 1)
      .orderBy("workspaceId", "asc")
      .orderBy("laneId", "asc")
      .orderBy("roleId", "asc")
      .execute();
  }

  private async listActiveExternalWaits(
    db: Kysely<DB>,
  ): Promise<Selectable<WorkflowExternalWait>[]> {
    return db
      .selectFrom("WorkflowExternalWait")
      .selectAll()
      .where("status", "=", "active")
      .orderBy("updatedAt", "desc")
      .orderBy("waitId", "asc")
      .execute();
  }

  private async getDb(): Promise<Kysely<DB>> {
    return this.getDbHandle();
  }
}

export function computeWorkflowSchedulerBudget(
  sessions: WorkflowSessionScanItem[],
  snapshot: ActivitySnapshot | null,
  policy: WorkflowSchedulerBudgetPolicy,
): WorkflowSchedulerBudgetSnapshot {
  const maxActiveExecutions = Math.max(
    0,
    Math.floor(policy.maxActiveExecutions),
  );
  const maxWorkflowOwnedSessions =
    policy.maxWorkflowOwnedSessions == null
      ? null
      : Math.max(0, Math.floor(policy.maxWorkflowOwnedSessions));
  const activeExecutionCount = countUniqueSessions(
    sessions.filter((session) => session.consumesExecutionBudget),
  );
  const workflowOwnedSessionCount = countUniqueSessions(
    sessions.filter((session) => session.ownsWorkflowSession),
  );
  const eligibleSessions = sessions
    .filter((session) => session.eligibleForUnrelatedWork)
    .map((session) => ({
      workspaceId: session.workspaceId,
      sessionId: session.sessionId,
      roleId: session.roleId,
      laneId: session.laneId,
      bindingId: session.bindingId,
    }));

  return {
    maxActiveExecutions,
    activeExecutionCount,
    availableExecutionSlots: Math.max(
      0,
      maxActiveExecutions - activeExecutionCount,
    ),
    maxWorkflowOwnedSessions,
    workflowOwnedSessionCount,
    availableWorkflowOwnedSessionSlots:
      maxWorkflowOwnedSessions == null
        ? null
        : Math.max(0, maxWorkflowOwnedSessions - workflowOwnedSessionCount),
    vkQueuedCount:
      snapshot?.workspaces.reduce(
        (sum, workspace) => sum + workspace.queued_count,
        0,
      ) ?? 0,
    eligibleSessionCount: eligibleSessions.length,
    blockedSessionCount: sessions.length - eligibleSessions.length,
    eligibleSessions,
  };
}

type ScanContext = {
  workspaceId: string;
  sessionId: string;
  roleId: string | null;
  roleName: string | null;
  laneId: string | null;
  instanceId: string | null;
  stepStateId: string | null;
  trigger: WorkflowScopedTriggerReadModel | null;
  binding: Selectable<WorkflowRoleSessionBinding> | null;
  externalWait: Selectable<WorkflowExternalWait> | null;
};

function buildScanContexts(
  bindings: Selectable<WorkflowRoleSessionBinding>[],
  triggers: WorkflowScopedTriggerReadModel[],
  externalWaits: Selectable<WorkflowExternalWait>[],
  activityBySession: Map<string, ActivitySession>,
): ScanContext[] {
  const contexts = new Map<string, ScanContext>();
  for (const binding of bindings) {
    contexts.set(sessionKey(binding.workspaceId, binding.sessionId), {
      workspaceId: binding.workspaceId,
      sessionId: binding.sessionId,
      roleId: binding.roleId,
      roleName: binding.roleName,
      laneId: binding.laneId,
      instanceId: binding.instanceId,
      stepStateId: null,
      trigger: null,
      binding,
      externalWait: null,
    });
  }
  for (const trigger of triggers.filter((trigger) =>
    hasSessionRef(trigger.status, trigger.workspaceId, trigger.sessionId),
  )) {
    const key = sessionKey(trigger.workspaceId!, trigger.sessionId!);
    const existing = contexts.get(key);
    contexts.set(key, {
      workspaceId: trigger.workspaceId!,
      sessionId: trigger.sessionId!,
      roleId: existing?.roleId ?? trigger.roleId,
      roleName: existing?.roleName ?? null,
      laneId: existing?.laneId ?? trigger.laneId,
      instanceId: trigger.instanceId,
      stepStateId: trigger.stepStateId,
      trigger,
      binding: existing?.binding ?? null,
      externalWait: existing?.externalWait ?? null,
    });
  }
  for (const wait of externalWaits) {
    const key = sessionKey(wait.workspaceId, wait.sessionId);
    const existing = contexts.get(key);
    contexts.set(key, {
      workspaceId: wait.workspaceId,
      sessionId: wait.sessionId,
      roleId: existing?.roleId ?? wait.roleId,
      roleName: existing?.roleName ?? null,
      laneId: existing?.laneId ?? wait.laneId,
      instanceId: existing?.instanceId ?? wait.instanceId,
      stepStateId: existing?.stepStateId ?? wait.stepStateId,
      trigger: existing?.trigger ?? null,
      binding: existing?.binding ?? null,
      externalWait: wait,
    });
  }
  for (const activity of activityBySession.values()) {
    const key = sessionKey(activity.workspace_id, activity.session_id);
    if (contexts.has(key)) continue;
    contexts.set(key, {
      workspaceId: activity.workspace_id,
      sessionId: activity.session_id,
      roleId: null,
      roleName: null,
      laneId: null,
      instanceId: null,
      stepStateId: null,
      trigger: null,
      binding: null,
      externalWait: null,
    });
  }
  return [...contexts.values()].sort(compareContexts);
}

function makeBaseItem(
  context: ScanContext,
  activity: ActivitySession | undefined,
  generatedAt: number,
): WorkflowSessionScanItem {
  return {
    workspaceId: context.workspaceId,
    sessionId: context.sessionId,
    roleId: context.roleId,
    roleName: context.roleName,
    laneId: context.laneId,
    instanceId: context.instanceId,
    stepStateId: context.stepStateId,
    triggerId: context.trigger?.triggerId ?? null,
    bindingId: context.binding?.bindingId ?? null,
    externalWaitId: context.externalWait?.waitId ?? null,
    classification: "idle",
    reason: "",
    ownsWorkflowSession: false,
    consumesExecutionBudget: false,
    eligibleForUnrelatedWork: true,
    queueCount: activity?.queue.count ?? 0,
    runningExecutionProcessIds:
      activity?.running_execution_processes.map(
        (process) => process.execution_process_id,
      ) ?? [],
    completedResponse: null,
    executionProcess: null,
    updatedAt: latestContributingTimestamp(
      [
        parseTimestamp(activity?.updated_at),
        context.trigger?.updatedAt ?? 0,
        context.binding?.updatedAt ?? 0,
        context.externalWait?.updatedAt ?? 0,
      ],
      generatedAt,
    ),
    warnings: [],
  };
}

function applyClassification(
  item: WorkflowSessionScanItem,
  classification: WorkflowSessionClassification,
  reason: string,
): WorkflowSessionScanItem {
  const hasRunningExecutionEvidence =
    item.runningExecutionProcessIds.length > 0 ||
    item.executionProcess?.status === "running";
  const consumesExecutionBudget =
    classification === "running" || hasRunningExecutionEvidence;
  const ownsWorkflowSession =
    classification !== "idle" || consumesExecutionBudget;
  return {
    ...item,
    classification,
    reason,
    consumesExecutionBudget,
    ownsWorkflowSession,
    eligibleForUnrelatedWork: !ownsWorkflowSession,
  };
}

function getExactExecutionId(
  trigger: WorkflowScopedTriggerReadModel | null,
): string | null {
  if (trigger?.mode !== "exact_execution") return null;
  return trigger.sourceExecutionProcessId ?? trigger.cursorExecutionProcessId;
}

function mapActivityBySession(
  snapshot: ActivitySnapshot | null,
): Map<string, ActivitySession> {
  const map = new Map<string, ActivitySession>();
  for (const workspace of snapshot?.workspaces ?? []) {
    for (const session of workspace.sessions) {
      map.set(sessionKey(session.workspace_id, session.session_id), session);
    }
  }
  return map;
}

function hasSessionRef(
  status: WorkflowScopedTriggerStatus,
  workspaceId: string | null,
  sessionId: string | null,
): boolean {
  return status === "active" && !!workspaceId && !!sessionId;
}

function sessionKey(workspaceId: string, sessionId: string): string {
  return `${workspaceId}\0${sessionId}`;
}

function countUniqueSessions(sessions: WorkflowSessionScanItem[]): number {
  return new Set(
    sessions.map((session) =>
      sessionKey(session.workspaceId, session.sessionId),
    ),
  ).size;
}

function latestContributingTimestamp(
  values: number[],
  fallback: number,
): number {
  const latest = Math.max(
    ...values.filter((value) => Number.isFinite(value) && value > 0),
  );
  return Number.isFinite(latest) ? latest : fallback;
}

function parseTimestamp(value: string | undefined): number {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function compareContexts(a: ScanContext, b: ScanContext): number {
  return (
    a.workspaceId.localeCompare(b.workspaceId) ||
    a.sessionId.localeCompare(b.sessionId)
  );
}

function compareScanItems(
  a: WorkflowSessionScanItem,
  b: WorkflowSessionScanItem,
): number {
  return (
    a.workspaceId.localeCompare(b.workspaceId) ||
    a.sessionId.localeCompare(b.sessionId)
  );
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

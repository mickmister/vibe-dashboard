import { afterEach, describe, expect, it, vi } from "vitest";
import { initVdDb, type VdDbHandle } from "./database";
import { DbWorkflowOrchestrationStore } from "./workflow-orchestration-store";
import { WorkflowScopedTriggerSatisfier } from "./workflow-scoped-trigger-satisfier";
import {
  WorkflowActivityScanner,
  type WorkflowScannerVkClient,
} from "./workflow-session-scanner";
import type {
  ActivitySnapshot,
  AgentResponse,
  ExecutionProcess,
} from "./vk-client";

const handles: VdDbHandle[] = [];

afterEach(async () => {
  for (const handle of handles.splice(0)) {
    await handle.db.destroy();
    handle.sqlite.close();
  }
});

describe("WorkflowScopedTriggerSatisfier", () => {
  it("satisfies a next-completed trigger and atomically resumes the waiting instance/step", async () => {
    const response = agentResponse({ execution_process_id: "exec-after" });
    const harness = await createHarness({
      getSessionLatestResponse: vi.fn(async () => response),
    });
    await seedWaitingTrigger(harness.store);

    const result = await harness.satisfier.runOnce();

    expect(result.satisfied).toHaveLength(1);
    expect(result.satisfied[0]).toMatchObject({
      triggerId: "trigger-1",
      executionProcessId: "exec-after",
      resume: { applied: true, reason: "applied" },
    });
    await expect(harness.store.getTrigger("trigger-1")).resolves.toMatchObject({
      status: "satisfied",
      satisfiedByExecutionProcessId: "exec-after",
      satisfiedBy: {
        executionProcessId: "exec-after",
        sessionId: "session-1",
        workspaceId: "ws-1",
        truncated: false,
      },
    });
    await expect(
      harness.store.getInstance("instance-1"),
    ).resolves.toMatchObject({
      status: "running",
      latestRunId: "exec-after",
    });
    await expect(
      getStep(harness.handle, "instance-1_step-1"),
    ).resolves.toMatchObject({
      status: "completed",
      waitingTriggerId: null,
      output: { executionProcessId: "exec-after" },
    });
  });

  it("ignores pre-cursor/no-completion scans without side effects", async () => {
    const harness = await createHarness({
      getSessionLatestResponse: vi.fn(async () => null),
    });
    await seedWaitingTrigger(harness.store, {
      cursorCompletedAt: 1_000,
      cursorExecutionProcessId: "exec-before",
    });

    const result = await harness.satisfier.runOnce();

    expect(result.satisfied).toEqual([]);
    expect(harness.vk.getSessionLatestResponse).toHaveBeenCalledWith(
      "session-1",
      {
        afterExecutionProcessId: "exec-before",
        afterCompletedAt: new Date(1_000).toISOString(),
      },
    );
    await expect(harness.store.getTrigger("trigger-1")).resolves.toMatchObject({
      status: "active",
    });
    await expect(
      harness.store.getInstance("instance-1"),
    ).resolves.toMatchObject({ status: "waiting" });
  });

  it("uses the next completed turn after the cursor even when it is not the originally queued execution", async () => {
    const harness = await createHarness({
      getSessionLatestResponse: vi.fn(async () =>
        agentResponse({
          execution_process_id: "exec-user-interrupted-continuation",
        }),
      ),
    });
    await seedWaitingTrigger(harness.store, {
      expectedQueueItemId: "original-queue-item",
      cursorExecutionProcessId: "exec-original-start",
    });

    const result = await harness.satisfier.runOnce();

    expect(result.satisfied[0]).toMatchObject({
      executionProcessId: "exec-user-interrupted-continuation",
    });
    await expect(harness.store.getTrigger("trigger-1")).resolves.toMatchObject({
      status: "satisfied",
      expectedQueueItemId: "original-queue-item",
      satisfiedByExecutionProcessId: "exec-user-interrupted-continuation",
    });
  });

  it("does not satisfy while the watched session is still running", async () => {
    const harness = await createHarness({
      snapshot: activitySnapshot({
        sessions: [
          activitySession({
            session_id: "session-1",
            status: "running",
            runningIds: ["exec-running"],
          }),
        ],
      }),
      getSessionLatestResponse: vi.fn(async () => null),
    });
    await seedWaitingTrigger(harness.store);

    const result = await harness.satisfier.runOnce();

    expect(result.satisfied).toEqual([]);
    expect(result.attention).toEqual([]);
    await expect(
      harness.store.getInstance("instance-1"),
    ).resolves.toMatchObject({ status: "waiting" });
  });

  it("does not satisfy failed/killed exact executions and reports attention", async () => {
    const harness = await createHarness({
      getExecutionProcess: vi.fn(async () =>
        executionProcess({ id: "exec-killed", status: "killed" }),
      ),
    });
    await seedWaitingTrigger(harness.store, {
      mode: "exact_execution",
      sourceExecutionProcessId: "exec-killed",
    });

    const result = await harness.satisfier.runOnce();

    expect(result.satisfied).toEqual([]);
    expect(result.attention).toEqual([
      expect.objectContaining({
        kind: "failed_or_killed",
        triggerId: "trigger-1",
        executionProcessId: "exec-killed",
      }),
    ]);
    await expect(harness.store.getTrigger("trigger-1")).resolves.toMatchObject({
      status: "active",
    });
  });

  it("does not consume truncated responses silently", async () => {
    const harness = await createHarness({
      getSessionLatestResponse: vi.fn(async () =>
        agentResponse({ execution_process_id: "exec-long", truncated: true }),
      ),
    });
    await seedWaitingTrigger(harness.store);

    const result = await harness.satisfier.runOnce();

    expect(result.satisfied).toEqual([]);
    expect(result.attention).toEqual([
      expect.objectContaining({
        kind: "truncated_response",
        executionProcessId: "exec-long",
      }),
    ]);
    await expect(harness.store.getTrigger("trigger-1")).resolves.toMatchObject({
      status: "active",
    });
  });

  it("keeps callback/CI waits stalled until the external wait resolves and a subsequent completion is observed", async () => {
    const response = agentResponse({ execution_process_id: "exec-after-ci" });
    const harness = await createHarness({
      getSessionLatestResponse: vi.fn(async () => response),
    });
    await seedWaitingTrigger(harness.store);
    await seedExternalWait(harness.handle, {
      waitId: "wait-ci",
      kind: "ci",
      sessionId: "session-1",
    });

    const blocked = await harness.satisfier.runOnce();
    expect(blocked.satisfied).toEqual([]);
    expect(harness.vk.getSessionLatestResponse).not.toHaveBeenCalled();
    await expect(
      harness.store.getInstance("instance-1"),
    ).resolves.toMatchObject({ status: "waiting" });

    await harness.handle.db
      .updateTable("WorkflowExternalWait")
      .set({ status: "resolved", resolvedAt: 20_000, updatedAt: 20_000 })
      .where("waitId", "=", "wait-ci")
      .execute();

    const resumed = await harness.satisfier.runOnce();
    expect(resumed.satisfied).toHaveLength(1);
    expect(resumed.satisfied[0]).toMatchObject({
      executionProcessId: "exec-after-ci",
    });
  });

  it("does not satisfy from a stale scan when an external wait becomes active before resume", async () => {
    const response = agentResponse({ execution_process_id: "exec-after-scan" });
    const harness = await createHarness({
      getSessionLatestResponse: vi.fn(async () => response),
    });
    await seedWaitingTrigger(harness.store);

    const staleScan = await harness.scanner.scanOnce({ maxActiveExecutions: 8 });
    expect(staleScan.sessions[0]).toMatchObject({
      classification: "completed_since_cursor",
      externalWaitId: null,
    });

    await seedExternalWait(harness.handle, {
      waitId: "wait-race",
      kind: "callback",
      sessionId: "session-1",
    });

    const satisfier = new WorkflowScopedTriggerSatisfier({
      scanner: {
        scanOnce: vi.fn(async () => staleScan),
      } as unknown as WorkflowActivityScanner,
      orchestrationStore: harness.store,
      policy: { maxActiveExecutions: 8 },
    });

    const result = await satisfier.runOnce();

    expect(result.satisfied).toEqual([]);
    expect(result.skipped).toEqual([
      expect.objectContaining({
        kind: "resume_skipped",
        triggerId: "trigger-1",
        reason: "external_wait_active",
      }),
    ]);
    await expect(harness.store.getTrigger("trigger-1")).resolves.toMatchObject({
      status: "active",
      satisfiedByExecutionProcessId: null,
    });
    await expect(harness.store.getInstance("instance-1")).resolves.toMatchObject({
      status: "waiting",
    });
    await expect(getStep(harness.handle, "instance-1_step-1")).resolves.toMatchObject({
      status: "waiting",
      waitingTriggerId: "trigger-1",
      output: null,
    });
  });

  it("skips resume when an instance is paused and avoids satisfying cancelled triggers", async () => {
    const harness = await createHarness({
      getSessionLatestResponse: vi.fn(async () =>
        agentResponse({ execution_process_id: "exec-after" }),
      ),
    });
    await seedWaitingTrigger(harness.store);
    await harness.store.pauseInstance("instance-1");

    const paused = await harness.satisfier.runOnce();
    expect(paused.satisfied).toEqual([]);
    expect(paused.skipped).toEqual([
      expect.objectContaining({
        kind: "resume_skipped",
        triggerId: "trigger-1",
        reason: "instance_not_waiting",
      }),
    ]);
    await expect(harness.store.getTrigger("trigger-1")).resolves.toMatchObject({
      status: "active",
    });

    await harness.store.resumeInstance("instance-1");
    await harness.store
      .markInstanceWaiting("instance-1", {
        currentStepId: "step-2",
        waitingTriggerId: "trigger-2",
      })
      .catch(() => undefined);

    await harness.store.cancelInstance("instance-1");
    const cancelled = await harness.satisfier.runOnce();
    expect(cancelled.satisfied).toEqual([]);
    await expect(harness.store.getTrigger("trigger-1")).resolves.toMatchObject({
      status: "cancelled",
    });
  });

  it("is idempotent across repeated passes", async () => {
    const harness = await createHarness({
      getSessionLatestResponse: vi.fn(async () =>
        agentResponse({ execution_process_id: "exec-after" }),
      ),
    });
    await seedWaitingTrigger(harness.store);

    const first = await harness.satisfier.runOnce();
    const second = await harness.satisfier.runOnce();

    expect(first.satisfied).toHaveLength(1);
    expect(second.satisfied).toEqual([]);
    await expect(
      harness.store.getInstance("instance-1"),
    ).resolves.toMatchObject({ status: "running" });
  });
});

async function createHarness(
  options: Partial<WorkflowScannerVkClient> & {
    snapshot?: ActivitySnapshot;
  } = {},
) {
  const handle = await initVdDb({ path: ":memory:" });
  handles.push(handle);
  let now = 10_000;
  const store = new DbWorkflowOrchestrationStore({
    db: handle.db,
    now: () => now++,
  });
  const vk: WorkflowScannerVkClient = {
    getActivitySnapshot: vi.fn(
      async () =>
        options.snapshot ??
        activitySnapshot({
          sessions: [activitySession({ session_id: "session-1" })],
        }),
    ),
    getSessionLatestResponse: vi.fn(async () => null),
    getExecutionProcess: vi.fn(async (processId) =>
      executionProcess({ id: processId, status: "running" }),
    ),
    getExecutionProcessFinalMessage: vi.fn(async (processId) =>
      agentResponse({ execution_process_id: processId }),
    ),
    ...options,
  };
  const scanner = new WorkflowActivityScanner({
    db: handle.db,
    orchestrationStore: store,
    vk,
    now: () => now++,
  });
  const satisfier = new WorkflowScopedTriggerSatisfier({
    scanner,
    orchestrationStore: store,
    policy: { maxActiveExecutions: 8 },
  });
  return { handle, store, vk, scanner, satisfier };
}

async function seedWaitingTrigger(
  store: DbWorkflowOrchestrationStore,
  options: {
    mode?: "exact_execution" | "next_completion_after_cursor";
    cursorCompletedAt?: number | null;
    cursorExecutionProcessId?: string | null;
    sourceExecutionProcessId?: string | null;
    expectedQueueItemId?: string | null;
  } = {},
) {
  await store.createInstance({
    instanceId: "instance-1",
    workflowId: "workflow",
    trigger: "manual",
  });
  await store.createStepState({
    id: "instance-1_step-1",
    instanceId: "instance-1",
    stepKey: "step-1",
  });
  await store.startInstance("instance-1", { currentStepId: "step-1" });
  await store.markStepRunning("instance-1_step-1");
  await store.createScopedTrigger({
    triggerId: "trigger-1",
    instanceId: "instance-1",
    stepStateId: "instance-1_step-1",
    stepKey: "step-1",
    workspaceId: "ws-1",
    sessionId: "session-1",
    mode: options.mode ?? "next_completion_after_cursor",
    cursorCompletedAt: options.cursorCompletedAt,
    cursorExecutionProcessId: options.cursorExecutionProcessId,
    sourceExecutionProcessId: options.sourceExecutionProcessId,
    expectedQueueItemId: options.expectedQueueItemId,
  });
  await store.markInstanceWaiting("instance-1", {
    currentStepId: "step-1",
    waitingTriggerId: "trigger-1",
  });
}

async function seedExternalWait(
  handle: VdDbHandle,
  args: { waitId: string; kind: "callback" | "ci"; sessionId: string },
) {
  await handle.db
    .insertInto("WorkflowExternalWait")
    .values({
      waitId: args.waitId,
      instanceId: "instance-1",
      stepStateId: "instance-1_step-1",
      roleId: null,
      laneId: null,
      workspaceId: "ws-1",
      sessionId: args.sessionId,
      kind: args.kind,
      status: "active",
      externalRef: `${args.kind}-ref`,
      sourceExecutionProcessId: null,
      metadataJson: null,
      createdAt: 1,
      updatedAt: 1,
      resolvedAt: null,
      cancelledAt: null,
    })
    .execute();
}

async function getStep(handle: VdDbHandle, id: string) {
  const row = await handle.db
    .selectFrom("WorkflowStepState")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirstOrThrow();
  return {
    ...row,
    input: row.inputJson == null ? null : JSON.parse(row.inputJson),
    output: row.outputJson == null ? null : JSON.parse(row.outputJson),
    error: row.errorJson == null ? null : JSON.parse(row.errorJson),
  };
}

function activitySnapshot(
  args: { sessions?: ReturnType<typeof activitySession>[] } = {},
): ActivitySnapshot {
  const sessions = args.sessions ?? [];
  return {
    generated_at: "2026-08-04T00:00:00.000Z",
    callback_state_available: false,
    workspaces: [
      {
        workspace_id: "ws-1",
        active_turn_count: sessions.reduce(
          (sum, session) => sum + session.active_turn_count,
          0,
        ),
        running_turn_count: sessions.filter(
          (session) => session.status === "running",
        ).length,
        running_dev_server_count: 0,
        queued_count: sessions.reduce(
          (sum, session) => sum + session.queue.count,
          0,
        ),
        sessions,
        updated_at: "2026-08-04T00:00:00.000Z",
      },
    ],
  };
}

function activitySession(args: {
  session_id: string;
  status?: "idle" | "queued" | "running" | "callback_waiting";
  runningIds?: string[];
}) {
  const runningIds = args.runningIds ?? [];
  return {
    workspace_id: "ws-1",
    session_id: args.session_id,
    status: args.status ?? "idle",
    active_turn_count: runningIds.length,
    running_execution_processes: runningIds.map((id) => ({
      execution_process_id: id,
      run_reason: "codingagent",
      status: "running" as const,
      started_at: "2026-08-04T00:00:00.000Z",
      updated_at: "2026-08-04T00:00:01.000Z",
    })),
    queue: {
      count: 0,
      queued_count: 0,
      leased_count: 0,
      starting_count: 0,
      running_count: 0,
      first_item_id: null,
      updated_at: null,
    },
    callback: { available: false, waiting_count: 0 },
    updated_at: "2026-08-04T00:00:01.000Z",
  };
}

function executionProcess(
  args: Partial<ExecutionProcess> & {
    id: string;
    status: ExecutionProcess["status"];
  },
): ExecutionProcess {
  return {
    id: args.id,
    session_id: args.session_id ?? "session-1",
    status: args.status,
    created_at: "2026-08-04T00:00:00.000Z",
    started_at: "2026-08-04T00:00:00.000Z",
    completed_at: args.status === "running" ? null : "2026-08-04T00:00:02.000Z",
    updated_at: "2026-08-04T00:00:02.000Z",
  };
}

function agentResponse(args: Partial<AgentResponse> = {}): AgentResponse {
  return {
    execution_process_id: args.execution_process_id ?? "exec-after",
    session_id: args.session_id ?? "session-1",
    workspace_id: args.workspace_id ?? "ws-1",
    status: args.status ?? "completed",
    completed_at: args.completed_at ?? "2026-08-04T00:00:02.000Z",
    coding_agent_turn_id: args.coding_agent_turn_id ?? "turn-1",
    agent_session_id: args.agent_session_id ?? "agent-session-1",
    agent_message_id: args.agent_message_id ?? "agent-message-1",
    content: args.content ?? "done",
    truncated: args.truncated ?? false,
    max_chars: args.max_chars ?? 4096,
    source_kind: "coding_agent_turn_summary",
  };
}

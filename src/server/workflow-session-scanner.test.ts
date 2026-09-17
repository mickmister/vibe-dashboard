import { afterEach, describe, expect, it, vi } from "vitest";
import { initVdDb, type VdDbHandle } from "./database";
import { DbWorkflowOrchestrationStore } from "./workflow-orchestration-store";
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

async function createHarness(
  options: Partial<WorkflowScannerVkClient> & {
    snapshot?: ActivitySnapshot;
  } = {},
) {
  const handle = await initVdDb({ path: ":memory:" });
  handles.push(handle);
  let now = 10_000;
  const orchestrationStore = new DbWorkflowOrchestrationStore({
    db: handle.db,
    now: () => now++,
  });
  const vk: WorkflowScannerVkClient = {
    getActivitySnapshot: vi.fn(
      async () => options.snapshot ?? activitySnapshot(),
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
    orchestrationStore,
    vk,
    now: () => now++,
  });
  return { handle, orchestrationStore, scanner, vk };
}

describe("WorkflowActivityScanner", () => {
  it("classifies running, queued/reserved, idle, and computes execution/session budgets", async () => {
    const { handle, scanner } = await createHarness({
      snapshot: activitySnapshot({
        sessions: [
          activitySession({
            session_id: "s-running",
            status: "running",
            runningIds: ["exec-running"],
          }),
          activitySession({
            session_id: "s-queued",
            status: "queued",
            queueCount: 2,
          }),
          activitySession({ session_id: "s-idle", status: "idle" }),
        ],
      }),
    });
    await seedBinding(handle, {
      bindingId: "b-running",
      roleId: "runner",
      sessionId: "s-running",
    });
    await seedBinding(handle, {
      bindingId: "b-queued",
      roleId: "queued",
      sessionId: "s-queued",
    });
    await seedBinding(handle, {
      bindingId: "b-idle",
      roleId: "idle",
      sessionId: "s-idle",
    });

    const scan = await scanner.scanOnce({
      maxActiveExecutions: 2,
      maxWorkflowOwnedSessions: 4,
    });

    expect(
      scan.sessions.map((session) => [
        session.sessionId,
        session.classification,
      ]),
    ).toEqual([
      ["s-idle", "idle"],
      ["s-queued", "queued_reserved"],
      ["s-running", "running"],
    ]);
    expect(scan.budget).toMatchObject({
      activeExecutionCount: 1,
      availableExecutionSlots: 1,
      workflowOwnedSessionCount: 2,
      availableWorkflowOwnedSessionSlots: 2,
      eligibleSessionCount: 1,
      blockedSessionCount: 2,
    });
    expect(scan.budget.eligibleSessions).toEqual([
      {
        workspaceId: "ws-1",
        sessionId: "s-idle",
        roleId: "idle",
        laneId: null,
        bindingId: "b-idle",
      },
    ]);
  });

  it("classifies active callback and CI waits as workflow-owned but not execution-active", async () => {
    const { handle, scanner } = await createHarness({
      snapshot: activitySnapshot({
        sessions: [
          activitySession({ session_id: "s-callback" }),
          activitySession({ session_id: "s-ci" }),
        ],
      }),
    });
    await seedBinding(handle, {
      bindingId: "b-callback",
      roleId: "callback-role",
      sessionId: "s-callback",
    });
    await seedBinding(handle, {
      bindingId: "b-ci",
      roleId: "ci-role",
      sessionId: "s-ci",
    });
    await seedExternalWait(handle, {
      waitId: "wait-callback",
      kind: "callback",
      sessionId: "s-callback",
    });
    await seedExternalWait(handle, {
      waitId: "wait-ci",
      kind: "ci",
      sessionId: "s-ci",
    });

    const scan = await scanner.scanOnce({ maxActiveExecutions: 3 });

    expect(
      scan.sessions.map((session) => [
        session.sessionId,
        session.classification,
        session.ownsWorkflowSession,
        session.consumesExecutionBudget,
        session.eligibleForUnrelatedWork,
      ]),
    ).toEqual([
      ["s-callback", "waiting_on_callback", true, false, false],
      ["s-ci", "waiting_on_ci", true, false, false],
    ]);
    expect(scan.budget).toMatchObject({
      activeExecutionCount: 0,
      workflowOwnedSessionCount: 2,
      availableExecutionSlots: 3,
    });
  });

  it("counts running VK activity against execution budget even when an external wait owns classification", async () => {
    const { handle, scanner } = await createHarness({
      snapshot: activitySnapshot({
        sessions: [
          activitySession({
            session_id: "s-callback",
            status: "running",
            runningIds: ["exec-running"],
          }),
        ],
      }),
    });
    await seedBinding(handle, {
      bindingId: "b-callback",
      roleId: "callback-role",
      sessionId: "s-callback",
    });
    await seedExternalWait(handle, {
      waitId: "wait-callback",
      kind: "callback",
      sessionId: "s-callback",
    });

    const scan = await scanner.scanOnce({ maxActiveExecutions: 1 });

    expect(scan.sessions[0]).toMatchObject({
      sessionId: "s-callback",
      classification: "waiting_on_callback",
      consumesExecutionBudget: true,
      ownsWorkflowSession: true,
      eligibleForUnrelatedWork: false,
    });
    expect(scan.budget).toMatchObject({
      activeExecutionCount: 1,
      availableExecutionSlots: 0,
    });
  });

  it("counts exact watched running execution against budget even when wait classification wins", async () => {
    const { handle, orchestrationStore, scanner } = await createHarness({
      getExecutionProcess: vi.fn(async () =>
        executionProcess({
          id: "exec-running",
          session_id: "s-watch",
          status: "running",
        }),
      ),
    });
    await seedExternalWait(handle, {
      waitId: "wait-ci",
      kind: "ci",
      sessionId: "s-watch",
    });
    await seedWaitingInstance(orchestrationStore, "instance-1", "step-1");
    await orchestrationStore.createScopedTrigger({
      triggerId: "trigger-exact",
      instanceId: "instance-1",
      stepStateId: "instance-1_step-1",
      stepKey: "step-1",
      workspaceId: "ws-1",
      sessionId: "s-watch",
      mode: "exact_execution",
      sourceExecutionProcessId: "exec-running",
    });

    const scan = await scanner.scanOnce({ maxActiveExecutions: 1 });

    expect(scan.sessions[0]).toMatchObject({
      sessionId: "s-watch",
      classification: "waiting_on_ci",
      executionProcess: { id: "exec-running", status: "running" },
      consumesExecutionBudget: true,
    });
    expect(scan.budget.activeExecutionCount).toBe(1);
  });

  it("classifies next-completion triggers from latest-response without direct delivery side effects", async () => {
    const { handle, orchestrationStore, scanner, vk } = await createHarness({
      snapshot: activitySnapshot({
        sessions: [activitySession({ session_id: "s-watch" })],
      }),
      getSessionLatestResponse: vi.fn(async () =>
        agentResponse({
          execution_process_id: "exec-after",
          session_id: "s-watch",
        }),
      ),
    });
    await seedWaitingInstance(orchestrationStore, "instance-1", "step-1");
    await orchestrationStore.createScopedTrigger({
      triggerId: "trigger-response",
      instanceId: "instance-1",
      stepStateId: "instance-1_step-1",
      stepKey: "step-1",
      workspaceId: "ws-1",
      sessionId: "s-watch",
      mode: "next_completion_after_cursor",
      cursorCompletedAt: 9_000,
      cursorExecutionProcessId: "exec-before",
    });

    const scan = await scanner.scanOnce({ maxActiveExecutions: 1 });

    expect(vk.getSessionLatestResponse).toHaveBeenCalledWith("s-watch", {
      afterExecutionProcessId: "exec-before",
      afterCompletedAt: new Date(9_000).toISOString(),
    });
    expect(scan.sessions[0]).toMatchObject({
      sessionId: "s-watch",
      triggerId: "trigger-response",
      classification: "completed_since_cursor",
      completedResponse: { execution_process_id: "exec-after" },
      ownsWorkflowSession: true,
      consumesExecutionBudget: false,
    });
  });

  it("keeps active waiting trigger reserved when no completed response exists yet", async () => {
    const { orchestrationStore, scanner } = await createHarness({
      snapshot: activitySnapshot({
        sessions: [activitySession({ session_id: "s-watch" })],
      }),
      getSessionLatestResponse: vi.fn(async () => null),
    });
    await seedWaitingInstance(orchestrationStore, "instance-1", "step-1");
    await orchestrationStore.createScopedTrigger({
      triggerId: "trigger-response",
      instanceId: "instance-1",
      stepStateId: "instance-1_step-1",
      stepKey: "step-1",
      workspaceId: "ws-1",
      sessionId: "s-watch",
      mode: "next_completion_after_cursor",
    });

    const scan = await scanner.scanOnce({ maxActiveExecutions: 1 });

    expect(scan.sessions[0]).toMatchObject({
      classification: "queued_reserved",
      ownsWorkflowSession: true,
      eligibleForUnrelatedWork: false,
    });
  });

  it("classifies exact watched execution failed/killed distinctly from normal waits", async () => {
    const { orchestrationStore, scanner } = await createHarness({
      getExecutionProcess: vi.fn(async () =>
        executionProcess({
          id: "exec-failed",
          session_id: "s-watch",
          status: "killed",
        }),
      ),
    });
    await seedWaitingInstance(orchestrationStore, "instance-1", "step-1");
    await orchestrationStore.createScopedTrigger({
      triggerId: "trigger-exact",
      instanceId: "instance-1",
      stepStateId: "instance-1_step-1",
      stepKey: "step-1",
      workspaceId: "ws-1",
      sessionId: "s-watch",
      mode: "exact_execution",
      sourceExecutionProcessId: "exec-failed",
    });

    const scan = await scanner.scanOnce({ maxActiveExecutions: 1 });

    expect(scan.sessions[0]).toMatchObject({
      classification: "failed_or_killed",
      executionProcess: { id: "exec-failed", status: "killed" },
      ownsWorkflowSession: true,
      consumesExecutionBudget: false,
      eligibleForUnrelatedWork: false,
    });
  });

  it("marks timed-out active triggers as stalled_needs_attention without heuristic spam", async () => {
    const { orchestrationStore, scanner } = await createHarness({
      snapshot: activitySnapshot({
        sessions: [activitySession({ session_id: "s-stalled" })],
      }),
    });
    await seedWaitingInstance(orchestrationStore, "instance-1", "step-1");
    await orchestrationStore.createScopedTrigger({
      triggerId: "trigger-timeout",
      instanceId: "instance-1",
      stepStateId: "instance-1_step-1",
      stepKey: "step-1",
      workspaceId: "ws-1",
      sessionId: "s-stalled",
      mode: "next_completion_after_cursor",
      timeoutAt: 1,
    });

    const scan = await scanner.scanOnce({ maxActiveExecutions: 1 });

    expect(scan.sessions[0]).toMatchObject({
      classification: "stalled_needs_attention",
      reason: "active workflow trigger timed out",
    });
  });

  it("counts running VK activity against execution budget even when timed-out trigger classification wins", async () => {
    const { orchestrationStore, scanner } = await createHarness({
      snapshot: activitySnapshot({
        sessions: [
          activitySession({
            session_id: "s-stalled",
            status: "running",
            runningIds: ["exec-running"],
          }),
        ],
      }),
    });
    await seedWaitingInstance(orchestrationStore, "instance-1", "step-1");
    await orchestrationStore.createScopedTrigger({
      triggerId: "trigger-timeout",
      instanceId: "instance-1",
      stepStateId: "instance-1_step-1",
      stepKey: "step-1",
      workspaceId: "ws-1",
      sessionId: "s-stalled",
      mode: "next_completion_after_cursor",
      timeoutAt: 1,
    });

    const scan = await scanner.scanOnce({ maxActiveExecutions: 1 });

    expect(scan.sessions[0]).toMatchObject({
      sessionId: "s-stalled",
      classification: "stalled_needs_attention",
      consumesExecutionBudget: true,
      ownsWorkflowSession: true,
    });
    expect(scan.budget).toMatchObject({
      activeExecutionCount: 1,
      availableExecutionSlots: 0,
    });
  });

  it("pages all active triggers so reserved sessions beyond the first page are not treated as idle", async () => {
    const { orchestrationStore, scanner } = await createHarness();
    await orchestrationStore.createInstance({
      instanceId: "instance-many",
      workflowId: "workflow",
      trigger: "manual",
    });
    await orchestrationStore.startInstance("instance-many");
    for (let index = 0; index < 201; index += 1) {
      await orchestrationStore.createScopedTrigger({
        triggerId: `trigger-${String(index).padStart(3, "0")}`,
        instanceId: "instance-many",
        workspaceId: "ws-1",
        sessionId: `s-${String(index).padStart(3, "0")}`,
        mode: "next_completion_after_cursor",
      });
    }

    const scan = await scanner.scanOnce({ maxActiveExecutions: 10 });

    expect(scan.sessions).toHaveLength(201);
    expect(
      scan.sessions.every(
        (session) => session.classification === "queued_reserved",
      ),
    ).toBe(true);
    expect(scan.budget).toMatchObject({
      workflowOwnedSessionCount: 201,
      eligibleSessionCount: 0,
      blockedSessionCount: 201,
    });
    expect(scan.sessions.map((session) => session.sessionId)).toContain(
      "s-200",
    );
  });

  it("reports unknown_unreachable conservatively when VK activity is unavailable", async () => {
    const { handle, scanner } = await createHarness({
      getActivitySnapshot: vi.fn(async () => {
        throw new Error("VK down");
      }),
    });
    await seedBinding(handle, {
      bindingId: "b1",
      roleId: "role",
      sessionId: "s1",
    });

    const scan = await scanner.scanOnce({ maxActiveExecutions: 1 });

    expect(scan.warnings[0]).toContain("VK activity snapshot unavailable");
    expect(scan.sessions[0]).toMatchObject({
      classification: "unknown_unreachable",
      ownsWorkflowSession: true,
      eligibleForUnrelatedWork: false,
    });
  });
});

async function seedWaitingInstance(
  store: DbWorkflowOrchestrationStore,
  instanceId: string,
  stepKey: string,
) {
  await store.createInstance({
    instanceId,
    workflowId: "workflow",
    trigger: "manual",
  });
  await store.createStepState({
    id: `${instanceId}_${stepKey}`,
    instanceId,
    stepKey,
  });
  await store.startInstance(instanceId, { currentStepId: stepKey });
  await store.markStepRunning(`${instanceId}_${stepKey}`);
}

async function seedBinding(
  handle: VdDbHandle,
  args: {
    bindingId: string;
    roleId: string;
    sessionId: string;
    laneId?: string | null;
  },
) {
  await handle.db
    .insertInto("WorkflowRoleSessionBinding")
    .values({
      bindingId: args.bindingId,
      teamId: "team-1",
      workflowId: "workflow",
      instanceId: null,
      laneId: args.laneId ?? null,
      roleId: args.roleId,
      roleName: args.roleId,
      workspaceId: "ws-1",
      sessionId: args.sessionId,
      executor: "CODEX",
      source: "auto_reused",
      valid: 1,
      version: 1,
      createdAt: 1,
      updatedAt: 1,
    })
    .execute();
}

async function seedExternalWait(
  handle: VdDbHandle,
  args: { waitId: string; kind: "callback" | "ci"; sessionId: string },
) {
  await handle.db
    .insertInto("WorkflowExternalWait")
    .values({
      waitId: args.waitId,
      instanceId: null,
      stepStateId: null,
      roleId: null,
      laneId: null,
      workspaceId: "ws-1",
      sessionId: args.sessionId,
      kind: args.kind,
      status: "active",
      externalRef: `${args.kind}-ref`,
      sourceExecutionProcessId: null,
      metadataJson: null,
      createdAt: 2,
      updatedAt: 2,
      resolvedAt: null,
      cancelledAt: null,
    })
    .execute();
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
  queueCount?: number;
  runningIds?: string[];
}): ActivitySnapshot["workspaces"][number]["sessions"][number] {
  const runningIds = args.runningIds ?? [];
  const queueCount = args.queueCount ?? 0;
  return {
    workspace_id: "ws-1",
    session_id: args.session_id,
    status: args.status ?? "idle",
    active_turn_count: runningIds.length + queueCount,
    running_execution_processes: runningIds.map((id) => ({
      execution_process_id: id,
      run_reason: "codingagent",
      status: "running",
      started_at: "2026-08-04T00:00:00.000Z",
      updated_at: "2026-08-04T00:00:01.000Z",
    })),
    queue: {
      count: queueCount,
      queued_count: queueCount,
      leased_count: 0,
      starting_count: 0,
      running_count: 0,
      first_item_id: queueCount > 0 ? `queue-${args.session_id}` : null,
      updated_at: queueCount > 0 ? "2026-08-04T00:00:01.000Z" : null,
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
    session_id: args.session_id ?? "s-watch",
    status: args.status,
    created_at: "2026-08-04T00:00:00.000Z",
    started_at: "2026-08-04T00:00:00.000Z",
    completed_at: args.status === "running" ? null : "2026-08-04T00:00:02.000Z",
    updated_at: "2026-08-04T00:00:02.000Z",
  };
}

function agentResponse(args: Partial<AgentResponse> = {}): AgentResponse {
  return {
    execution_process_id: args.execution_process_id ?? "exec-1",
    session_id: args.session_id ?? "s-watch",
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
    prompt_preview: args.prompt_preview ?? "prompt preview",
    prompt_truncated: args.prompt_truncated ?? false,
    prompt_max_chars: args.prompt_max_chars ?? 4096,
    prompt_source_kind: "coding_agent_turn_prompt",
  };
}

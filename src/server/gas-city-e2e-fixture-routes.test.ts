import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { GasCityE2eFixtureStore } from "../modules/plugins/workflows/server/gasCityE2eFixture";
import { registerGasCityE2eFixtureRoutes } from "./gas-city-e2e-fixture-routes";
import type { QueueFollowUpProvenance } from "./vk-client";

const forbidden = /\b(?:gc|bd|git)\s+[\w:./=-]+|\/Users\/|\/tmp\/|\/private\/var\/|stdout|stderr|provider diagnostics|queue[_ -]?item|webhook|trigger|delivery ID|execution process ID|raw XML|raw JSON|generated-packs/i;

describe("registerGasCityE2eFixtureRoutes", () => {
  it("does not expose fixture endpoints unless explicitly enabled", async () => {
    const app = new Hono();
    registerGasCityE2eFixtureRoutes(app, { enabled: false });

    const response = await app.request("/dashboard/api/workflows/gas-city-e2e-fixture");
    expect(response.status).toBe(404);
  });

  it("exposes deterministic snapshot and event routes when enabled", async () => {
    const app = new Hono();
    const fixture = new GasCityE2eFixtureStore({ workspaceId: "workspace-a" }, { now: () => 123 });
    registerGasCityE2eFixtureRoutes(app, { enabled: true, fixture });

    const initial = await app.request("/dashboard/api/workflows/gas-city-e2e-fixture");
    expect(initial.status).toBe(200);
    await expect(initial.json()).resolves.toMatchObject({
      ok: true,
      state: { fixture: { schemaVersion: "gas-city-e2e-fixture.v1", workspaceId: "workspace-a" } },
    });

    const event = { eventId: "ready-1", type: "mark_bead_ready", workspaceId: "workspace-a", beadId: "bead-a", title: "Ready task" };
    const applied = await app.request("/dashboard/api/workflows/gas-city-e2e-fixture/events", {
      method: "POST",
      body: JSON.stringify(event),
      headers: { "content-type": "application/json" },
    });
    expect(applied.status).toBe(200);
    await expect(applied.json()).resolves.toMatchObject({
      ok: true,
      result: { status: "applied", state: { beads: [expect.objectContaining({ id: "bead-a", readiness: "ready" })] } },
    });

    const replay = await app.request("/dashboard/api/workflows/gas-city-e2e-fixture/events", {
      method: "POST",
      body: JSON.stringify(event),
      headers: { "content-type": "application/json" },
    });
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({ ok: true, result: { status: "already_applied" } });

    const conflict = await app.request("/dashboard/api/workflows/gas-city-e2e-fixture/events", {
      method: "POST",
      body: JSON.stringify({ ...event, type: "mark_tester_found_bug" }),
      headers: { "content-type": "application/json" },
    });
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({ ok: false, result: { status: "conflict" } });
  });


  it("launches a ready source bead through the Gas City provider seam", async () => {
    const app = new Hono();
    const fixture = new GasCityE2eFixtureStore({
      workspaceId: "workspace-a",
      beads: [{ id: "bead-gcw14d", title: "Ready task", status: "ready", readiness: "ready", workspaceId: "workspace-a", dependencyBeadIds: [], convoyIds: [] }],
    }, { now: () => 123 });
    registerGasCityE2eFixtureRoutes(app, { enabled: true, fixture });

    const response = await app.request("/dashboard/api/workflows/gas-city-e2e-fixture/launch", {
      method: "POST",
      body: JSON.stringify({ workspaceId: "workspace-a", sourceBeadId: "bead-gcw14d", target: "worker", formula: "dev-review-test", idempotencyKey: "launch-1" }),
      headers: { "content-type": "application/json" },
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toMatchObject({
      ok: true,
      launch: { status: "accepted", workflowRef: { workspaceId: "workspace-a", sourceBeadId: "bead-gcw14d", formula: "dev-review-test" } },
      workflow: { status: "running" },
    });
    expect(JSON.stringify(body)).not.toMatch(forbidden);

    const snapshot = fixture.snapshot();
    expect(snapshot.beads[0]?.workflow).toMatchObject({ workflowId: expect.any(String), status: "running" });
  });


  it("routes a deterministic first agent message through VK once per idempotency key", async () => {
    const app = new Hono();
    const fixture = new GasCityE2eFixtureStore({
      workspaceId: "workspace-a",
      beads: [{ id: "bead-gcw14d-route", title: "Ready task", status: "ready", readiness: "ready", workspaceId: "workspace-a", dependencyBeadIds: [], convoyIds: [] }],
    }, { now: () => 123 });
    const sessions: Array<{ id: string; workspace_id: string; executor: "CODEX"; name: string; created_at: string; updated_at: string }> = [];
    const queued: Array<{ sessionId: string; prompt: string; source?: string; provenance?: QueueFollowUpProvenance }> = [];
    const vkClient = {
      getSessions: async () => sessions,
      createSession: async (body: { workspace_id: string; executor: "CODEX"; name?: string | null }) => {
        const session = { id: "session-gcw14d-route", workspace_id: body.workspace_id, executor: body.executor, name: body.name ?? "Task workflow", created_at: "now", updated_at: "now" };
        sessions.push(session);
        return session;
      },
      queueFollowUp: async (sessionId: string, prompt: string, options?: { source?: "workflow"; provenance?: QueueFollowUpProvenance }) => {
        queued.push({ sessionId, prompt, source: options?.source, provenance: options?.provenance });
        return {
          queued_item: {
            id: "queue-1",
            session_id: sessionId,
            workspace_id: "workspace-a",
            status: "queued" as const,
            source: "workflow" as const,
            priority: 0,
            data: { message: prompt, provenance: options?.provenance },
          },
          status: { count: 1, message: null, messages: [], status: "queued" as const },
        };
      },
    };
    registerGasCityE2eFixtureRoutes(app, { enabled: true, fixture, vkClient });

    for (let index = 0; index < 2; index += 1) {
      const response = await app.request("/dashboard/api/workflows/gas-city-e2e-fixture/launch", {
        method: "POST",
        body: JSON.stringify({ workspaceId: "workspace-a", sourceBeadId: "bead-gcw14d-route", target: "worker", formula: "dev-review-test", idempotencyKey: "launch-1" }),
        headers: { "content-type": "application/json" },
      });
      expect(response.status).toBe(index === 0 ? 201 : 200);
      const body = await response.json();
      expect(body).toMatchObject({ ok: true, firstAgentMessage: { status: "sent", sessionId: "session-gcw14d-route" } });
      expect(JSON.stringify(body)).not.toMatch(forbidden);
    }

    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ sessionId: "session-gcw14d-route", source: "workflow" });
    expect(queued[0]?.prompt).toContain("GCW14D_STEP:first_agent_message");
    expect(queued[0]?.prompt).toContain("bead-gcw14d-route");
    expect(queued[0]?.prompt).toContain("Ready task");
    expect(queued[0]?.prompt).toContain("Workflow recipe: Dev Review Test");
    expect(queued[0]?.prompt).not.toMatch(forbidden);
    expect(queued[0]?.prompt).not.toMatch(/prompt:|skill:|@version|Built-in|contentHash|generated pack/i);
  });


  it("advances a typed fixture event to the next VK agent message idempotently", async () => {
    const app = new Hono();
    const fixture = new GasCityE2eFixtureStore({
      workspaceId: "workspace-a",
      beads: [{ id: "bead-gcw14e-route", title: "Review task", status: "ready", readiness: "ready", workspaceId: "workspace-a", dependencyBeadIds: [], convoyIds: [] }],
    }, { now: () => 123 });
    const sessions: Array<{ id: string; workspace_id: string; executor: "CODEX"; name: string; created_at: string; updated_at: string }> = [];
    const queued: Array<{ sessionId: string; prompt: string; source?: string; provenance?: QueueFollowUpProvenance }> = [];
    const vkClient = {
      getSessions: async () => sessions,
      createSession: async (body: { workspace_id: string; executor: "CODEX"; name?: string | null }) => {
        const session = { id: `session-${sessions.length + 1}`, workspace_id: body.workspace_id, executor: body.executor, name: body.name ?? "Task workflow", created_at: "now", updated_at: "now" };
        sessions.push(session);
        return session;
      },
      queueFollowUp: async (sessionId: string, prompt: string, options?: { source?: "workflow"; provenance?: QueueFollowUpProvenance }) => {
        queued.push({ sessionId, prompt, source: options?.source, provenance: options?.provenance });
        return {
          queued_item: {
            id: `queue-${queued.length}`,
            session_id: sessionId,
            workspace_id: "workspace-a",
            status: "queued" as const,
            source: "workflow" as const,
            priority: 0,
            data: { message: prompt, provenance: options?.provenance },
          },
          status: { count: queued.length, message: null, messages: [], status: "queued" as const },
        };
      },
    };
    registerGasCityE2eFixtureRoutes(app, { enabled: true, fixture, vkClient });

    const launch = await app.request("/dashboard/api/workflows/gas-city-e2e-fixture/launch", {
      method: "POST",
      body: JSON.stringify({ workspaceId: "workspace-a", sourceBeadId: "bead-gcw14e-route", target: "worker", formula: "dev-review-test", idempotencyKey: "launch-gcw14e" }),
      headers: { "content-type": "application/json" },
    });
    expect(launch.status).toBe(201);

    for (let index = 0; index < 2; index += 1) {
      const event = await app.request("/dashboard/api/workflows/gas-city-e2e-fixture/events", {
        method: "POST",
        body: JSON.stringify({
          eventId: "agent-note-1",
          type: "record_agent_result_note",
          workspaceId: "workspace-a",
          beadId: "bead-gcw14e-route",
          title: "Review task",
          summary: "First agent completed implementation note.",
        }),
        headers: { "content-type": "application/json" },
      });
      expect(event.status).toBe(200);
      const body = await event.json();
      expect(body).toMatchObject({ ok: true, advancement: { status: "sent" } });
      expect(JSON.stringify(body)).not.toMatch(forbidden);
    }

    expect(queued).toHaveLength(2);
    expect(queued[0]?.prompt).toContain("GCW14D_STEP:first_agent_message");
    expect(queued[1]).toMatchObject({ source: "workflow" });
    expect(queued[1]?.prompt).toContain("GCW14E_STEP:review_agent_message");
    expect(queued[1]?.prompt).toContain("bead-gcw14e-route");
    expect(queued[1]?.prompt).toContain("Review task");
    expect(queued[1]?.prompt).toContain("Task-backed workflow advanced to review.");
    expect(queued[1]?.prompt).toContain("Assigned role: reviewer");
    expect(queued[1]?.prompt).not.toMatch(forbidden);
    expect(queued[1]?.prompt).not.toMatch(/prompt:|skill:|@version|Built-in|contentHash|generated pack/i);
  });

  it("delivers a caller completion response once when a fixture workflow reaches terminal success", async () => {
    const app = new Hono();
    const fixture = new GasCityE2eFixtureStore({
      workspaceId: "workspace-a",
      beads: [{ id: "bead-gcw14g-route", title: "Callback task", status: "ready", readiness: "ready", workspaceId: "workspace-a", dependencyBeadIds: [], convoyIds: [] }],
    }, { now: () => 123 });
    const queued: Array<{ sessionId: string; prompt: string; source?: string; provenance?: QueueFollowUpProvenance }> = [];
    const callbacks: Array<{ kind: "upsert" | "status"; key: string; body: Record<string, unknown> }> = [];
    const vkClient = {
      getSessions: async () => [],
      createSession: async (body: { workspace_id: string; executor: "CODEX"; name?: string | null }) => ({
        id: "session-worker",
        workspace_id: body.workspace_id,
        executor: body.executor,
        name: body.name ?? "Task workflow",
        created_at: "now",
        updated_at: "now",
      }),
      queueFollowUp: async (sessionId: string, prompt: string, options?: { source?: "workflow"; provenance?: QueueFollowUpProvenance }) => {
        queued.push({ sessionId, prompt, source: options?.source, provenance: options?.provenance });
        return {
          queued_item: {
            id: `queue-${queued.length}`,
            session_id: sessionId,
            workspace_id: "workspace-a",
            status: "queued" as const,
            source: "workflow" as const,
            priority: 0,
            data: { message: prompt, provenance: options?.provenance },
          },
          status: { count: queued.length, message: null, messages: [], status: "queued" as const },
        };
      },
      upsertWorkflowCallback: async (body: unknown) => {
        const record = body as Record<string, unknown>;
        callbacks.push({ kind: "upsert", key: String(record.callback_key), body: record });
        return {};
      },
      updateWorkflowCallbackStatus: async (callbackKey: string, body: unknown) => {
        callbacks.push({ kind: "status", key: callbackKey, body: body as Record<string, unknown> });
        return {};
      },
    };
    registerGasCityE2eFixtureRoutes(app, { enabled: true, fixture, vkClient });

    const launch = await app.request("/dashboard/api/workflows/gas-city-e2e-fixture/launch", {
      method: "POST",
      body: JSON.stringify({
        workspaceId: "workspace-a",
        sourceBeadId: "bead-gcw14g-route",
        target: "worker",
        formula: "dev-review-test",
        idempotencyKey: "launch-gcw14g",
        completionResponse: { sessionId: "caller-session", source: "vibe-agent-cli" },
      }),
      headers: { "content-type": "application/json" },
    });
    expect(launch.status).toBe(201);
    const launchBody = await launch.json();
    expect(launchBody).toMatchObject({ ok: true, completionResponse: { status: "pending", sessionId: "caller-session" } });

    for (let index = 0; index < 2; index += 1) {
      const event = await app.request("/dashboard/api/workflows/gas-city-e2e-fixture/events", {
        method: "POST",
        body: JSON.stringify({
          eventId: "tester-approved-1",
          type: "mark_tester_approved",
          workspaceId: "workspace-a",
          beadId: "bead-gcw14g-route",
          title: "Callback task",
          summary: "Tester approved the deterministic workflow.",
        }),
        headers: { "content-type": "application/json" },
      });
      expect(event.status).toBe(200);
      const body = await event.json();
      expect(body).toMatchObject({ ok: true, completionResponse: { status: "delivered", sessionId: "caller-session" } });
      expect(JSON.stringify(body)).not.toMatch(forbidden);
    }

    expect(queued).toHaveLength(2);
    expect(queued[0]?.prompt).toContain("GCW14D_STEP:first_agent_message");
    expect(queued[1]).toMatchObject({ sessionId: "caller-session", source: "workflow" });
    expect(queued[1]?.prompt).toContain("GCW14G_STEP:completion_response");
    expect(queued[1]?.prompt).toContain("Task-backed workflow completed");
    expect(queued[1]?.prompt).toContain("Callback task");
    expect(queued[1]?.prompt).not.toMatch(forbidden);
    const statusUpdates = callbacks.filter((entry) => entry.kind === "status");
    expect(callbacks.filter((entry) => entry.kind === "upsert")).toHaveLength(1);
    expect(statusUpdates).toHaveLength(1);
    expect(statusUpdates[0]?.body).toMatchObject({ status: "delivered", delivered_ref: "vk:queue-2" });
  });

  it("blocks launching a source bead that is not ready", async () => {
    const app = new Hono();
    const fixture = new GasCityE2eFixtureStore({
      workspaceId: "workspace-a",
      beads: [{ id: "bead-a", title: "Draft task", status: "open", readiness: "not_ready", workspaceId: "workspace-a", dependencyBeadIds: [], convoyIds: [] }],
    }, { now: () => 123 });
    registerGasCityE2eFixtureRoutes(app, { enabled: true, fixture });

    const response = await app.request("/dashboard/api/workflows/gas-city-e2e-fixture/launch", {
      method: "POST",
      body: JSON.stringify({ workspaceId: "workspace-a", sourceBeadId: "bead-a", target: "worker", formula: "dev-review-test", idempotencyKey: "launch-not-ready" }),
      headers: { "content-type": "application/json" },
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: "source_bead_not_ready" });
  });

  it("scrubs hostile fixture text from route payloads", async () => {
    const app = new Hono();
    const fixture = new GasCityE2eFixtureStore({ workspaceId: "workspace-a" }, { now: () => 123 });
    registerGasCityE2eFixtureRoutes(app, { enabled: true, fixture });

    const response = await app.request("/dashboard/api/workflows/gas-city-e2e-fixture/events", {
      method: "POST",
      body: JSON.stringify({
        eventId: "unsafe-1",
        type: "record_agent_result_note",
        workspaceId: "workspace-a",
        beadId: "bead-a",
        title: "Run gc sling from /Users/me/project",
        summary: "stdout raw XML webhook queue_item provider diagnostics /tmp/private bd show",
        metadata: { detail: "stderr raw JSON /private/var/folders git status" },
      }),
      headers: { "content-type": "application/json" },
    });
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).not.toMatch(forbidden);
  });
});

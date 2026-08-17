import { createHmac } from "node:crypto";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createWorkflowRegistry,
  type WorkflowDefinition,
} from "@vibe-dashboard/workflow-core";
import { registerWorkflowRoutes } from "./workflow-routes";
import { initVdDb, type VdDbHandle } from "./database";
import { DbWorkflowRunRecorder } from "./workflow-run-recorder";
import { DbWorkflowRunReader } from "./workflow-run-store";
import { DbWorkflowOrchestrationStore } from "./workflow-orchestration-store";
import { DbWorkspaceLaneStore } from "./workspace-lane-store";
import { DbDeclarativeWorkflowDefinitionStore } from "./declarative-workflow-definition-store";
import {
  DbWorkflowWebhookInboxStore,
  WorkflowWebhookWakeup,
  signVkWebhookPayload,
} from "./workflow-webhook-inbox";
import { DbWorkflowWebhookProvisioningStore } from "./workflow-webhook-provisioning-store";
import { DbWorkflowDesignStore } from "../modules/plugins/workflows/server/workflowDesignStore";
import { BUILT_IN_WORKFLOW_TEMPLATES } from "../modules/plugins/workflows/templates/builtInWorkflowTemplates";
import { PersistedWorkflowRuntimeService } from "../modules/plugins/workflows/server/persistedWorkflowRuntime";
import { validateWorkflowGraph } from "../modules/plugins/workflows/components/graph/workflowGraphModel";
import type { Session } from "./vk-client";

describe("registerWorkflowRoutes", () => {
  const dbHandles: VdDbHandle[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const handle of dbHandles.splice(0)) {
      await handle.db.destroy();
      handle.sqlite.close();
    }
  });

  it("returns health and registered workflows", async () => {
    const registry = createWorkflowRegistry();
    registry.register({
      id: "example",
      trigger: "manual",
      run: async () => ({ ok: true }),
    });
    const app = new Hono();
    registerWorkflowRoutes(app, { registry });

    await expectJson(app, "/dashboard/api/workflows/health", 200, { ok: true });
    await expectJson(app, "/dashboard/api/workflows", 200, {
      workflows: [{ id: "example", trigger: "manual" }],
    });
  });



  it("TEST_CASE_M120A_1A exposes lane overview and creation without raw host paths", async () => {
    const handle = await initVdDb({ path: ":memory:" });
    dbHandles.push(handle);
    const laneStore = new DbWorkspaceLaneStore({
      db: handle.db,
      now: () => 1_000,
      parentWorkspaceExists: (workspaceId) => workspaceId === "workspace-a",
    });
    await laneStore.createLane({
      laneId: "lane-hidden-path",
      parentWorkspaceId: "workspace-a",
      name: "Hidden path lane",
      purpose: "Product safe lane display",
      sourceBranch: "main",
      worktreePath: "/Users/secret/worktree",
      worktreeStatus: "clean",
      status: "ready",
    });
    const app = new Hono();
    registerWorkflowRoutes(app, { registry: createWorkflowRegistry(), workspaceLaneStore: laneStore });

    const overviewResponse = await app.request("/dashboard/api/workspace-lanes?workspaceId=workspace-a");
    expect(overviewResponse.status).toBe(200);
    const overviewPayload = await overviewResponse.json();
    expect(overviewPayload.overview.parentWorkspaceId).toBe("workspace-a");
    expect(overviewPayload.overview.lanes).toEqual(expect.arrayContaining([expect.objectContaining({ laneId: "lane-hidden-path", purpose: "Product safe lane display", capacity: { write: expect.objectContaining({ status: "available" }) } })]));
    expect(JSON.stringify(overviewPayload)).not.toContain("/Users/secret/worktree");

    const createResponse = await app.request("/dashboard/api/workspace-lanes", {
      method: "POST",
      body: JSON.stringify({ workspaceId: "workspace-a", name: "New isolated lane", purpose: "Workflow work", sourceBranch: "main" }),
    });
    expect(createResponse.status).toBe(201);
    await expect(createResponse.json()).resolves.toMatchObject({ lane: { parentWorkspaceId: "workspace-a", name: "New isolated lane", worktree: { display: expect.any(String) } } });
  });

  it("TEST_CASE_M120A_1B/1C exposes write token gating, idempotent release, and recovery through typed lane APIs", async () => {
    const clock = { now: 1_000 };
    const handle = await initVdDb({ path: ":memory:" });
    dbHandles.push(handle);
    const laneStore = new DbWorkspaceLaneStore({
      db: handle.db,
      now: () => clock.now,
      parentWorkspaceExists: (workspaceId) => workspaceId === "workspace-a",
    });
    await laneStore.createLane({ laneId: "lane-api", parentWorkspaceId: "workspace-a", name: "API lane", purpose: "Write capacity", sourceBranch: "main", worktreeStatus: "clean", status: "ready" });
    const app = new Hono();
    registerWorkflowRoutes(app, { registry: createWorkflowRegistry(), workspaceLaneStore: laneStore });

    const acquire = await app.request("/dashboard/api/workspace-lanes/lane-api/write-token", {
      method: "POST",
      body: JSON.stringify({ workspaceId: "workspace-a", ownerId: "writer-1", leaseId: "lease-1", leaseDurationMs: 5 }),
    });
    expect(acquire.status).toBe(200);
    await expect(acquire.json()).resolves.toMatchObject({ write: { status: "held", activeLeaseId: "lease-1" } });

    const conflict = await app.request("/dashboard/api/workspace-lanes/lane-api/write-token", {
      method: "POST",
      body: JSON.stringify({ workspaceId: "workspace-a", ownerId: "writer-2", leaseId: "lease-2" }),
    });
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({ error: "lane_capacity_conflict" });

    const release = await app.request("/dashboard/api/workspace-lanes/lane-api/write-token/release", {
      method: "POST",
      body: JSON.stringify({ workspaceId: "workspace-a", leaseId: "lease-1", reason: "done" }),
    });
    expect(release.status).toBe(200);
    const releaseAgain = await app.request("/dashboard/api/workspace-lanes/lane-api/write-token/release", {
      method: "POST",
      body: JSON.stringify({ workspaceId: "workspace-a", leaseId: "lease-1", reason: "duplicate" }),
    });
    expect(releaseAgain.status).toBe(200);
    await expect(releaseAgain.json()).resolves.toMatchObject({ write: { status: "available" } });

    await app.request("/dashboard/api/workspace-lanes/lane-api/write-token", {
      method: "POST",
      body: JSON.stringify({ workspaceId: "workspace-a", ownerId: "writer-3", leaseId: "lease-expired", leaseDurationMs: 5 }),
    });
    clock.now = 2_000;
    const stale = await app.request("/dashboard/api/workspace-lanes/lane-api/write-token", {
      method: "POST",
      body: JSON.stringify({ workspaceId: "workspace-a", ownerId: "writer-4", leaseId: "lease-new" }),
    });
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({ error: "lane_capacity_stale_or_orphan" });
    const recover = await app.request("/dashboard/api/workspace-lanes/lane-api/write-token/recover", {
      method: "POST",
      body: JSON.stringify({ workspaceId: "workspace-a", leaseId: "lease-expired", actorId: "operator", reason: "worker crashed" }),
    });
    expect(recover.status).toBe(200);
    await expect(recover.json()).resolves.toMatchObject({ write: { status: "available" } });
  });

  it("TEST_CASE_M120A_1D refuses cleanup for active lanes and audits explicit cleanup", async () => {
    const handle = await initVdDb({ path: ":memory:" });
    dbHandles.push(handle);
    const laneStore = new DbWorkspaceLaneStore({
      db: handle.db,
      now: () => 1_000,
      parentWorkspaceExists: (workspaceId) => workspaceId === "workspace-a",
    });
    await laneStore.createLane({ laneId: "lane-active-cleanup", parentWorkspaceId: "workspace-a", name: "Active cleanup", purpose: "No cleanup", sourceBranch: "main", worktreeStatus: "clean", status: "active" });
    await laneStore.createLane({ laneId: "lane-complete-cleanup", parentWorkspaceId: "workspace-a", name: "Complete cleanup", purpose: "Audit cleanup", sourceBranch: "main", worktreeStatus: "clean", status: "completed" });
    const app = new Hono();
    registerWorkflowRoutes(app, { registry: createWorkflowRegistry(), workspaceLaneStore: laneStore });

    const activeCleanup = await app.request("/dashboard/api/workspace-lanes/lane-active-cleanup/cleanup", {
      method: "POST",
      body: JSON.stringify({ workspaceId: "workspace-a", reason: "too soon", actorId: "operator" }),
    });
    expect(activeCleanup.status).toBe(409);
    await expect(activeCleanup.json()).resolves.toMatchObject({ error: "lane_invalid_status" });

    const cleanup = await app.request("/dashboard/api/workspace-lanes/lane-complete-cleanup/cleanup", {
      method: "POST",
      body: JSON.stringify({ workspaceId: "workspace-a", reason: "done", actorId: "operator" }),
    });
    expect(cleanup.status).toBe(200);
    const payload = await cleanup.json();
    expect(payload.lane).toMatchObject({ laneId: "lane-complete-cleanup", status: "completed" });
    expect(payload.audit).toEqual(expect.arrayContaining([expect.objectContaining({ eventType: "lane_cleanup_requested", actorId: "operator" })]));
  });

  it("TEST_CASE_CKOV_1C returns product-safe workflow roadmap read model", async () => {
    const app = new Hono();
    registerWorkflowRoutes(app, { registry: createWorkflowRegistry() });

    const response = await app.request("/dashboard/api/workflows/roadmap");

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { roadmap: unknown };
    expect(payload).toMatchObject({
      roadmap: {
        spikeId: "vk/8b79-vd-workflows",
        title: "Workflow builder and automation spike",
        source: expect.objectContaining({ freshness: "error" }),
        milestones: [],
      },
    });
    expect(JSON.stringify(payload)).not.toContain("/beads/project");
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("bd update");
    expect(serialized).not.toContain("shell command");
    expect(serialized).not.toContain("raw JSON");
  });

  it("TEST_CASE_M119B_1A returns live workflow roadmap data when provider is configured", async () => {
    const app = new Hono();
    registerWorkflowRoutes(app, {
      registry: createWorkflowRegistry(),
      workflowRoadmapLiveProvider: {
        providerId: "route-live-provider",
        label: "Route live beads",
        async readBeads(beadIds, context) {
          expect(context.workspaceId).toBe("workspace-a");
          return {
            updatedAt: 12_345,
            partial: true,
            beads: beadIds.includes("vibe-kanban-vscode-web-ckov")
              ? [{ beadId: "vibe-kanban-vscode-web-ckov", status: "closed", summary: "Live route data closed CKOV.", url: "/beads/project?bead=vibe-kanban-vscode-web-ckov" }]
              : [],
          };
        },
        async listMetaRuns() {
          return [{ metaRunId: "meta-route-live", status: "running", items: [{ beadId: "vibe-kanban-vscode-web-ckov", status: "running", childRunId: "child-route-live" }] }];
        },
      },
    });

    const response = await app.request("/dashboard/api/workflows/roadmap?workspaceId=workspace-a");

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { roadmap: any };
    expect(payload.roadmap.source).toMatchObject({ providerId: "route-live-provider", freshness: "partial", updatedAt: 12_345 });
    expect(payload.roadmap.milestones).toEqual(expect.arrayContaining([expect.objectContaining({
      beadId: "vibe-kanban-vscode-web-ckov",
      status: "complete",
      links: expect.arrayContaining([expect.objectContaining({ href: "/dashboard/workflows/child-route-live" })]),
    })]));
    expect(JSON.stringify(payload)).not.toContain("queue item");
    expect(JSON.stringify(payload)).not.toContain("webhook");
  });

  it("TEST_CASE_M119C_1A searches meta-workflow beads through typed provider", async () => {
    const app = new Hono();
    const scopes: string[] = [];
    registerWorkflowRoutes(app, {
      registry: createWorkflowRegistry(),
      metaWorkflowBeadProvider: {
        async readBeads() { return []; },
        async searchBeads(input) {
          scopes.push(input.scope);
          return [
            { beadId: "A", title: "A title", status: "open", workspaceId: input.scope === "no_workspace" ? null : input.workspaceId, accessible: true, url: "/beads/project?bead=A" },
            { beadId: "unsafe", title: "bd show /Users/example/private webhook queue item", status: "open", workspaceId: input.workspaceId, accessible: true, url: "file:///Users/example/private" },
          ];
        },
      },
    });

    const response = await app.request("/dashboard/api/workflows/meta-beads?workspaceId=workspace-a&scope=no_workspace&q=roadmap");

    expect(response.status).toBe(200);
    const payload = await response.json() as { beads: any[]; unavailableReason: string | null };
    expect(scopes).toEqual(["no_workspace"]);
    expect(payload.unavailableReason).toBeNull();
    expect(payload.beads).toEqual(expect.arrayContaining([expect.objectContaining({ beadId: "A", workspaceId: null })]));
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("bd show");
    expect(serialized).not.toContain("/Users/");
    expect(serialized).not.toContain("webhook");
    expect(serialized).not.toContain("queue item");
    expect(serialized).not.toContain("file://");
  });

  it("TEST_CASE_ZJCB_5 loads selected roadmap beads for meta-workflow queueing", async () => {
    const app = new Hono();
    const readIds: string[][] = [];
    registerWorkflowRoutes(app, {
      registry: createWorkflowRegistry(),
      metaWorkflowBeadProvider: {
        async readBeads(beadIds) {
          readIds.push(beadIds);
          return beadIds.map((beadId) => ({
            beadId,
            title: `Roadmap ${beadId} bd show /Users/example/private webhook queue item`,
            status: beadId === "done" ? "closed" : "open",
            workspaceId: "workspace-a",
            accessible: beadId !== "hidden",
            url: "/beads/project?bead=dead",
          }));
        },
      },
    });

    const response = await app.request("/dashboard/api/workflows/meta-beads/selected?workspaceId=workspace-a&beadIds=A,done,A");

    expect(response.status).toBe(200);
    const payload = await response.json() as { beads: any[]; unavailableReason: string | null };
    expect(readIds).toEqual([["A", "done"]]);
    expect(payload.beads.map((bead) => bead.beadId)).toEqual(["A", "done", "A"]);
    expect(payload.beads[1]).toMatchObject({ status: "closed", accessible: true });
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("bd show");
    expect(serialized).not.toContain("/Users/");
    expect(serialized).not.toContain("webhook");
    expect(serialized).not.toContain("queue item");
    expect(serialized).not.toContain("/beads/project");
  });

  it("returns workspace workflows home read model scoped to workspace", async () => {
    const handle = await initVdDb({ path: ":memory:" });
    dbHandles.push(handle);
    const app = new Hono();
    const designStore = new DbWorkflowDesignStore({ db: handle.db });
    await designStore.createDesign({
      designId: "design-home",
      draftId: "draft-home",
      name: "Home Workflow",
      definition: routeValidDefinition(),
    });
    await designStore.publishDraft("draft-home");
    await designStore.createRunSnapshot({
      runSnapshotId: "snapshot-home-a",
      designId: "design-home",
      workspaceId: "workspace-a",
      runInput: {},
      roleBindings: {},
    });
    await handle.db
      .insertInto("WorkflowPersistedRun")
      .values({
        runId: "run-home-a",
        runSnapshotId: "snapshot-home-a",
        designId: "design-home",
        designVersion: 1,
        workspaceId: "workspace-a",
        status: "completed",
        coreModelJson: JSON.stringify({ name: "Home Workflow" }),
        coreSnapshotJson: "{}",
        roleBindingsJson: "{}",
        pendingEffectJson: null,
        queuedTurnsJson: "{}",
        eventsJson: "[]",
        errorJson: null,
        createdAt: 1,
        updatedAt: 2,
      })
      .execute();
    await designStore.createRunSnapshot({
      runSnapshotId: "snapshot-home-b",
      designId: "design-home",
      workspaceId: "workspace-b",
      runInput: {},
      roleBindings: {},
    });
    await handle.db
      .insertInto("WorkflowPersistedRun")
      .values({
        runId: "run-home-b",
        runSnapshotId: "snapshot-home-b",
        designId: "design-home",
        designVersion: 1,
        workspaceId: "workspace-b",
        status: "running",
        coreModelJson: JSON.stringify({ name: "Other Workspace Workflow" }),
        coreSnapshotJson: "{}",
        roleBindingsJson: "{}",
        pendingEffectJson: null,
        queuedTurnsJson: "{}",
        eventsJson: "[]",
        errorJson: null,
        createdAt: 3,
        updatedAt: 4,
      })
      .execute();
    registerWorkflowRoutes(app, {
      registry: createWorkflowRegistry(),
      workflowHomeDb: handle.db,
      workflowDesignStore: designStore,
    });

    const response = await app.request(
      "/dashboard/api/workflows/home?workspaceId=workspace-a",
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      home: {
        workspaceId: "workspace-a",
        userWorkflows: [
          { id: "design-home", title: "Home Workflow", status: "ready" },
        ],
        recentRuns: [
          {
            runId: "run-home-a",
            workflowName: "Home Workflow",
            detailUrl: "/dashboard/workflows/run-home-a",
          },
        ],
        needsInput: [],
      },
    });

    const globalResponse = await app.request("/dashboard/api/workflows/home");
    expect(globalResponse.status).toBe(200);
    await expect(globalResponse.json()).resolves.toMatchObject({
      home: {
        workspaceId: null,
        userWorkflows: [{ id: "design-home", title: "Home Workflow", status: "ready" }],
        recentRuns: [
          { runId: "run-home-b", workflowName: "Other Workspace Workflow", workspaceId: "workspace-b" },
          { runId: "run-home-a", workflowName: "Home Workflow", workspaceId: "workspace-a" },
        ],
        needsInput: [],
      },
    });
  });

  it("TEST_CASE_M97_1B loads and saves workflow graph editor draft definitions", async () => {
    const handle = await initVdDb({ path: ":memory:" });
    dbHandles.push(handle);
    const designStore = new DbWorkflowDesignStore({ db: handle.db });
    await designStore.createDesign({
      designId: "design-graph",
      draftId: "draft-graph",
      name: "Graph Workflow",
      definition: routeValidDefinition(),
    });
    await designStore.publishDraft("draft-graph");
    const app = new Hono();
    registerWorkflowRoutes(app, {
      registry: createWorkflowRegistry(),
      workflowHomeDb: handle.db,
      workflowDesignStore: designStore,
    });

    const loaded = await app.request(
      "/dashboard/api/workflow-designs/design-graph/editor",
    );
    expect(loaded.status).toBe(200);
    const loadedJson = (await loaded.json()) as {
      editor: { draftId: string; readonly: boolean; definition: any };
    };
    expect(loadedJson.editor).toMatchObject({
      draftId: "draft-graph",
      readonly: false,
      definition: { name: "Home Workflow", initialState: "dev" },
    });

    const definition = loadedJson.editor.definition;
    definition.states.dev.actions.done.label = "Ship it";
    const saved = await app.request(
      "/dashboard/api/workflow-design-drafts/draft-graph",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ definition }),
      },
    );

    expect(saved.status).toBe(200);
    await expect(saved.json()).resolves.toMatchObject({
      editor: {
        draftId: "draft-graph",
        definition: {
          states: {
            dev: {
              actions: { done: { label: "Ship it", targetState: "done" } },
            },
          },
        },
      },
    });
    const draft = await designStore.getDraft("draft-graph");
    expect((draft?.definition as any).states.dev.actions.done.label).toBe(
      "Ship it",
    );
  });

  it("TEST_CASE_M98_1A uses built-in templates as DB-backed published workflow designs", async () => {
    const handle = await initVdDb({ path: ":memory:" });
    dbHandles.push(handle);
    const app = new Hono();
    const designStore = new DbWorkflowDesignStore({
      db: handle.db,
      templates: BUILT_IN_WORKFLOW_TEMPLATES,
    });
    registerWorkflowRoutes(app, {
      registry: createWorkflowRegistry(),
      workflowHomeDb: handle.db,
      workflowDesignStore: designStore,
    });

    const home = await app.request(
      "/dashboard/api/workflows/home?workspaceId=workspace-a",
    );
    expect(home.status).toBe(200);
    await expect(home.json()).resolves.toMatchObject({
      home: {
        starterTemplates: expect.arrayContaining([
          expect.objectContaining({
            id: "built-in/dev-review-tester",
            title: "Dev / Review / Tester",
            source: "template",
            status: "ready",
          }),
          expect.objectContaining({
            id: "built-in/create-form-from-agent",
            title: "Create form from agent",
            source: "template",
            status: "ready",
          }),
        ]),
      },
    });

    const used = await app.request(
      "/dashboard/api/workflow-templates/built-in%2Fdev-review-tester/use",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: "workspace-a",
          designId: "design.drt.route",
          draftId: "draft.drt.route",
          publish: true,
        }),
      },
    );

    expect(used.status).toBe(201);
    await expect(used.json()).resolves.toMatchObject({
      design: { designId: "design.drt.route", latestPublishedVersion: 1 },
      draft: { draftId: "draft.drt.route", validationStatus: "valid" },
      version: { designId: "design.drt.route", version: 1 },
      home: {
        userWorkflows: expect.arrayContaining([
          expect.objectContaining({
            id: "design.drt.route",
            source: "published_design",
            status: "ready",
            canRun: true,
          }),
        ]),
      },
    });
    expect(await designStore.getVersion("design.drt.route", 1)).toMatchObject({
      resolvedDefinition: {
        states: {
          dev: { steps: [{ id: "implement" }, { id: "self_review" }] },
        },
      },
    });

    const editor = await app.request(
      "/dashboard/api/workflow-designs/design.drt.route/editor",
    );
    expect(editor.status).toBe(200);
    const editorJson = (await editor.json()) as { editor: { definition: any } };
    expect(
      editorJson.editor.definition.states.dev.steps[0].prompt,
    ).toMatchObject({ refs: [{ id: "prompt.drt.dev.implement" }] });
    expect(
      editorJson.editor.definition.states.dev.steps[0].prompt.template,
    ).toBeUndefined();
    expect(
      validateWorkflowGraph(editorJson.editor.definition).map(
        (issue) => issue.message,
      ),
    ).not.toContain("template is required");
    expect(validateWorkflowGraph(editorJson.editor.definition)).toEqual([]);
  });

  it("TEST_CASE_M95_1A launches a persisted workflow with required inputs and existing sessions", async () => {
    const handle = await initVdDb({ path: ":memory:" });
    dbHandles.push(handle);
    const app = new Hono();
    const designStore = new DbWorkflowDesignStore({ db: handle.db });
    const laneStore = new DbWorkspaceLaneStore({ db: handle.db });
    await designStore.createDesign({
      designId: "design-launch",
      draftId: "draft-launch",
      name: "Launch Workflow",
      definition: routeLaunchDefinition(),
    });
    await designStore.publishDraft("draft-launch");
    await laneStore.createLane({
      laneId: "lane-launch",
      parentWorkspaceId: "workspace-a",
      name: "Launch lane",
      purpose: "Selected during workflow launch",
      sourceBranch: "main",
      worktreeStatus: "clean",
      status: "ready",
    });
    const sessions = [
      vkSession("session-dev", "workspace-a", "Dev"),
      vkSession("session-review", "workspace-a", "Review"),
    ];
    const queued: Array<{ sessionId: string; prompt: string }> = [];
    registerWorkflowRoutes(app, {
      registry: createWorkflowRegistry(),
      workflowHomeDb: handle.db,
      workflowDesignStore: designStore,
      workspaceLaneStore: laneStore,
      vkClient: {
        getSessions: async () => sessions,
        getSession: async (sessionId) => {
          const session = sessions.find(
            (candidate) => candidate.id === sessionId,
          );
          if (!session) throw new Error("session not found");
          return session;
        },
        createSession: async () => {
          throw new Error("should not create session");
        },
        queueFollowUp: async (sessionId, prompt) => {
          queued.push({ sessionId, prompt });
          return {
            queued_item: {
              id: `queue-${queued.length}`,
              session_id: sessionId,
              workspace_id: "workspace-a",
              status: "queued",
              source: "workflow",
              priority: 0,
              data: { message: prompt },
            },
            status: { count: 1, message: null, messages: [], status: "queued" },
          };
        },
      },
    });

    const optionsResponse = await app.request(
      "/dashboard/api/workflows/launch-options?workspaceId=workspace-a&designId=design-launch",
    );
    expect(optionsResponse.status).toBe(200);
    await expect(optionsResponse.json()).resolves.toMatchObject({
      options: {
        workflow: {
          title: "Launch Workflow",
          version: 1,
          inputs: [
            expect.objectContaining({ id: "featureRequest", required: true }),
          ],
          roles: [
            expect.objectContaining({ id: "dev", label: "Dev" }),
            expect.objectContaining({ id: "review", label: "Review" }),
          ],
          launchSummary: expect.objectContaining({
            firstStateId: "dev",
            firstActorRoleId: "dev",
            firstActorLabel: "Dev",
            mayNeedHumanInput: false,
            mayCallWorkflows: false,
          }),
        },
        sessions: expect.arrayContaining([
          expect.objectContaining({
            sessionId: "session-dev",
            workspaceId: "workspace-a",
          }),
        ]),
      },
    });

    const missing = await app.request("/dashboard/api/workflows/launch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace-a",
        designId: "design-launch",
        inputs: {},
        roleBindings: {},
      }),
    });
    expect(missing.status).toBe(400);
    await expect(missing.json()).resolves.toMatchObject({
      fieldErrors: { featureRequest: "This field is required." },
    });

    const launched = await app.request("/dashboard/api/workflows/launch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace-a",
        designId: "design-launch",
        inputs: { featureRequest: "Build launch flow" },
        additionalInstructions: "Keep it clean.",
        laneId: "lane-launch",
        roleBindings: {
          dev: { mode: "existing", sessionId: "session-dev" },
          review: { mode: "existing", sessionId: "session-review" },
        },
      }),
    });

    expect(launched.status).toBe(201);
    const payload = await launched.json();
    expect(payload.run).toMatchObject({
      workspaceId: "workspace-a",
      status: "running",
    });
    expect(payload.run.detailUrl).toMatch(
      /^\/dashboard\/workflows\/workflow-run-/,
    );
    expect(payload.home.recentRuns[0]).toMatchObject({
      workflowName: "Launch Workflow",
    });
    expect(payload.home.recentRuns[0].detailUrl).toBe(payload.run.detailUrl);
    expect(queued).toMatchObject([{ sessionId: "session-dev" }]);
    expect(
      JSON.stringify(await designStore.getDesign("design-launch")),
    ).not.toContain("session-dev");
    const runRow = await handle.db
      .selectFrom("WorkflowPersistedRun")
      .selectAll()
      .executeTakeFirstOrThrow();
    expect(JSON.parse(runRow.roleBindingsJson)).toMatchObject({
      dev: { sessionId: "session-dev" },
      review: { sessionId: "session-review" },
    });
    await expect(
      laneStore.getBinding("workflow_run", payload.run.runId),
    ).resolves.toMatchObject({
      laneId: "lane-launch",
      accessMode: "write",
      reason: "Workflow launch selected this lane.",
    });
  });

  it("TEST_CASE_SEBL_1B/1C resolves executor/model preferences into session creation, run snapshot, and queued provenance", async () => {
    const handle = await initVdDb({ path: ":memory:" });
    dbHandles.push(handle);
    const app = new Hono();
    const designStore = new DbWorkflowDesignStore({ db: handle.db });
    const definition = routeLaunchDefinition();
    (
      definition.roles.dev as { executorPreference?: unknown }
    ).executorPreference = {
      executorType: "CLAUDE_CODE",
      model: "recommended",
      mode: "preferred",
    };
    await designStore.createDesign({
      designId: "design-executor-model",
      draftId: "draft-executor-model",
      name: "Executor Model Workflow",
      definition,
    });
    await designStore.publishDraft("draft-executor-model");
    const sessions = [vkSession("session-review", "workspace-a", "Review")];
    const createdSessions: unknown[] = [];
    const queued: Array<{
      sessionId: string;
      prompt: string;
      provenance: unknown;
    }> = [];
    registerWorkflowRoutes(app, {
      registry: createWorkflowRegistry(),
      workflowHomeDb: handle.db,
      workflowDesignStore: designStore,
      vkClient: {
        getSessions: async () => sessions,
        getSession: async (sessionId) => {
          const session = sessions.find(
            (candidate) => candidate.id === sessionId,
          );
          if (!session) throw new Error("session not found");
          return session;
        },
        createSession: async (body) => {
          createdSessions.push(body);
          const session = {
            ...vkSession(
              "session-dev-created",
              body.workspace_id,
              body.name ?? null,
            ),
            executor: body.executor,
          };
          sessions.push(session);
          return session;
        },
        queueFollowUp: async (sessionId, prompt, options) => {
          queued.push({ sessionId, prompt, provenance: options?.provenance });
          return {
            queued_item: {
              id: `queue-${queued.length}`,
              session_id: sessionId,
              workspace_id: "workspace-a",
              status: "queued",
              source: "workflow",
              priority: 0,
              data: { message: prompt },
            },
            status: { count: 1, message: null, messages: [], status: "queued" },
          };
        },
      },
    });

    const optionsResponse = await app.request(
      "/dashboard/api/workflows/launch-options?workspaceId=workspace-a&designId=design-executor-model",
    );
    expect(optionsResponse.status).toBe(200);
    await expect(optionsResponse.json()).resolves.toMatchObject({
      options: {
        workflow: {
          roles: expect.arrayContaining([
            expect.objectContaining({
              id: "dev",
              executorPreference: {
                executorType: "CLAUDE_CODE",
                model: "recommended",
                mode: "preferred",
              },
            }),
          ]),
        },
      },
    });

    const launched = await app.request("/dashboard/api/workflows/launch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace-a",
        designId: "design-executor-model",
        inputs: { featureRequest: "Use preferred executor" },
        roleBindings: {
          dev: { mode: "create_or_reuse", name: "Dev" },
          review: { mode: "existing", sessionId: "session-review" },
        },
      }),
    });

    expect(launched.status).toBe(201);
    expect(createdSessions).toContainEqual({
      workspace_id: "workspace-a",
      executor: "CLAUDE_CODE",
      name: "Dev",
      model: "recommended",
    });
    expect(queued[0]).toMatchObject({
      sessionId: "session-dev-created",
      provenance: {
        workflow_role_id: "dev",
        workflow_role_executor: "CLAUDE_CODE",
        workflow_role_model: "recommended",
      },
    });
    const runRow = await handle.db
      .selectFrom("WorkflowPersistedRun")
      .selectAll()
      .executeTakeFirstOrThrow();
    expect(JSON.parse(runRow.roleBindingsJson)).toMatchObject({
      dev: {
        sessionId: "session-dev-created",
        executorType: "CLAUDE_CODE",
        model: "recommended",
        preferenceSource: "role_default",
      },
    });
  });

  it("TEST_CASE_SEBL_1C rejects existing sessions whose executor conflicts with the role preference", async () => {
    const handle = await initVdDb({ path: ":memory:" });
    dbHandles.push(handle);
    const app = new Hono();
    const designStore = new DbWorkflowDesignStore({ db: handle.db });
    const definition = routeLaunchDefinition();
    (
      definition.roles.dev as { executorPreference?: unknown }
    ).executorPreference = {
      executorType: "CLAUDE_CODE",
      mode: "preferred",
    };
    await designStore.createDesign({
      designId: "design-executor-mismatch",
      draftId: "draft-executor-mismatch",
      name: "Executor Mismatch Workflow",
      definition,
    });
    await designStore.publishDraft("draft-executor-mismatch");
    const sessions = [
      vkSession("session-dev-codex", "workspace-a", "Dev"),
      vkSession("session-review", "workspace-a", "Review"),
    ];
    registerWorkflowRoutes(app, {
      registry: createWorkflowRegistry(),
      workflowHomeDb: handle.db,
      workflowDesignStore: designStore,
      vkClient: {
        getSessions: async () => sessions,
        getSession: async (sessionId) =>
          sessions.find((session) => session.id === sessionId)!,
      },
    });

    const response = await app.request("/dashboard/api/workflows/launch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace-a",
        designId: "design-executor-mismatch",
        inputs: { featureRequest: "Mismatch" },
        roleBindings: {
          dev: { mode: "existing", sessionId: "session-dev-codex" },
          review: { mode: "existing", sessionId: "session-review" },
        },
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      fieldErrors: {
        "role.dev.executorType": expect.stringContaining("session uses CODEX"),
      },
    });
  });

  it("TEST_CASE_SEBL_1C keeps no-preference existing sessions backward-compatible", async () => {
    const handle = await initVdDb({ path: ":memory:" });
    dbHandles.push(handle);
    const app = new Hono();
    const designStore = new DbWorkflowDesignStore({ db: handle.db });
    await designStore.createDesign({
      designId: "design-no-executor-preference",
      draftId: "draft-no-executor-preference",
      name: "No Preference Workflow",
      definition: routeLaunchDefinition(),
    });
    await designStore.publishDraft("draft-no-executor-preference");
    const sessions = [
      {
        ...vkSession("session-dev-gemini", "workspace-a", "Dev"),
        executor: "GEMINI" as const,
        model: "gemini-2.5-pro",
      },
      {
        ...vkSession("session-review-claude", "workspace-a", "Review"),
        executor: "CLAUDE_CODE" as const,
        model: "claude-sonnet-4",
      },
    ];
    const queued: Array<{ sessionId: string; provenance: unknown }> = [];
    registerWorkflowRoutes(app, {
      registry: createWorkflowRegistry(),
      workflowHomeDb: handle.db,
      workflowDesignStore: designStore,
      vkClient: {
        getSessions: async () => sessions,
        getSession: async (sessionId) => {
          const session = sessions.find(
            (candidate) => candidate.id === sessionId,
          );
          if (!session) throw new Error("session not found");
          return session;
        },
        createSession: async () => {
          throw new Error("should not create session");
        },
        queueFollowUp: async (sessionId, prompt, options) => {
          queued.push({ sessionId, provenance: options?.provenance });
          return {
            queued_item: {
              id: `queue-${queued.length}`,
              session_id: sessionId,
              workspace_id: "workspace-a",
              status: "queued",
              source: "workflow",
              priority: 0,
              data: { message: prompt },
            },
            status: { count: 1, message: null, messages: [], status: "queued" },
          };
        },
      },
    });

    const response = await app.request("/dashboard/api/workflows/launch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace-a",
        designId: "design-no-executor-preference",
        inputs: { featureRequest: "Use existing non-Codex sessions" },
        roleBindings: {
          dev: { mode: "existing", sessionId: "session-dev-gemini" },
          review: { mode: "existing", sessionId: "session-review-claude" },
        },
      }),
    });

    expect(response.status).toBe(201);
    expect(queued[0]).toMatchObject({ sessionId: "session-dev-gemini" });
    expect(queued[0]?.provenance).toMatchObject({
      workflow_role_id: "dev",
      workflow_role_executor: null,
      workflow_role_model: null,
    });
    const runRow = await handle.db
      .selectFrom("WorkflowPersistedRun")
      .selectAll()
      .executeTakeFirstOrThrow();
    expect(JSON.parse(runRow.roleBindingsJson)).toMatchObject({
      dev: {
        sessionId: "session-dev-gemini",
        executorType: null,
        model: null,
        preferenceSource: "workspace_default",
      },
      review: {
        sessionId: "session-review-claude",
        executorType: null,
        model: null,
        preferenceSource: "workspace_default",
      },
    });
  });

  it("TEST_CASE_SEBL_1C rejects existing sessions whose concrete model conflicts with the role preference", async () => {
    const handle = await initVdDb({ path: ":memory:" });
    dbHandles.push(handle);
    const app = new Hono();
    const designStore = new DbWorkflowDesignStore({ db: handle.db });
    const definition = routeLaunchDefinition();
    (
      definition.roles.dev as { executorPreference?: unknown }
    ).executorPreference = {
      executorType: "CODEX",
      model: "gpt-5-codex",
      mode: "preferred",
    };
    await designStore.createDesign({
      designId: "design-model-mismatch",
      draftId: "draft-model-mismatch",
      name: "Model Mismatch Workflow",
      definition,
    });
    await designStore.publishDraft("draft-model-mismatch");
    const sessions = [
      {
        ...vkSession("session-dev-gpt5", "workspace-a", "Dev"),
        model: "gpt-5",
      },
      vkSession("session-review", "workspace-a", "Review"),
    ];
    registerWorkflowRoutes(app, {
      registry: createWorkflowRegistry(),
      workflowHomeDb: handle.db,
      workflowDesignStore: designStore,
      vkClient: {
        getSessions: async () => sessions,
        getSession: async (sessionId) =>
          sessions.find((session) => session.id === sessionId)!,
      },
    });

    const response = await app.request("/dashboard/api/workflows/launch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace-a",
        designId: "design-model-mismatch",
        inputs: { featureRequest: "Mismatch" },
        roleBindings: {
          dev: { mode: "existing", sessionId: "session-dev-gpt5" },
          review: { mode: "existing", sessionId: "session-review" },
        },
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      fieldErrors: {
        "role.dev.model": expect.stringContaining("session uses model gpt-5"),
      },
    });
  });

  it("TEST_CASE_M108_1C exposes prompt and skill picker assets with source/version metadata", async () => {
    const handle = await initVdDb({ path: ":memory:" });
    dbHandles.push(handle);
    const app = new Hono();
    const designStore = new DbWorkflowDesignStore({ db: handle.db });
    await designStore.createPromptAsset({
      promptAssetId: "prompt.dev.instructions",
      version: 1,
      name: "Dev instructions",
      description: "Implementation prompt",
      bodyMarkdown: "Implement carefully.",
      source: "built_in",
    });
    await designStore.createSkillAsset({
      skillAssetId: "skill.testing.notes",
      version: 2,
      name: "Testing notes",
      description: "Markdown testing guidance",
      bodyMarkdown: "Write focused tests.",
      source: "user",
    });
    registerWorkflowRoutes(app, {
      registry: createWorkflowRegistry(),
      workflowHomeDb: handle.db,
      workflowDesignStore: designStore,
    });

    const response = await app.request("/dashboard/api/workflow-assets");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      prompts: [
        expect.objectContaining({
          kind: "prompt",
          id: "prompt.dev.instructions",
          version: 1,
          source: "built_in",
          preview: "Implement carefully.",
        }),
      ],
      skills: [
        expect.objectContaining({
          kind: "skill",
          id: "skill.testing.notes",
          version: 2,
          source: "user",
          preview: "Write focused tests.",
        }),
      ],
    });
  });

  it("TEST_CASE_M107_1B/C/E creates, duplicates, and publishes wizard workflow designs", async () => {
    const handle = await initVdDb({ path: ":memory:" });
    dbHandles.push(handle);
    const app = new Hono();
    const designStore = new DbWorkflowDesignStore({ db: handle.db });
    await designStore.createDesign({
      designId: "design-source-wizard",
      draftId: "draft-source-wizard",
      name: "Source Wizard",
      definition: routeLaunchDefinition(),
    });
    await designStore.publishDraft("draft-source-wizard");
    registerWorkflowRoutes(app, {
      registry: createWorkflowRegistry(),
      workflowHomeDb: handle.db,
      workflowDesignStore: designStore,
    });

    const blank = await app.request("/dashboard/api/workflow-designs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Wizard Blank",
        description: "Created in wizard",
        publish: false,
        definition: routeLaunchDefinition(),
      }),
    });
    expect(blank.status).toBe(201);
    const blankPayload = (await blank.json()) as {
      design: any;
      draft: any;
      version: any;
      editor: any;
    };
    expect(blankPayload).toMatchObject({
      design: { name: "Wizard Blank", latestPublishedVersion: null },
      draft: { designId: blankPayload.design.designId },
      version: null,
      editor: { validationStatus: "valid" },
    });

    const duplicate = await app.request("/dashboard/api/workflow-designs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Wizard Duplicate",
        sourceDesignId: "design-source-wizard",
        publish: true,
      }),
    });
    expect(duplicate.status).toBe(201);
    const duplicatePayload = (await duplicate.json()) as {
      design: any;
      version: any;
      editor: any;
    };
    expect(duplicatePayload).toMatchObject({
      design: { name: "Wizard Duplicate", latestPublishedVersion: 1 },
      version: { version: 1 },
      editor: { validationStatus: "valid" },
    });
    expect(
      await designStore.getVersion(duplicatePayload.design.designId, 1),
    ).toMatchObject({ version: 1 });
  });

  it("TEST_CASE_M119A_1A-F creates, resumes, observes, and reads sequential bead meta-runs", async () => {
    const handle = await initVdDb({ path: ":memory:" });
    dbHandles.push(handle);
    const app = new Hono();
    const designStore = new DbWorkflowDesignStore({ db: handle.db });
    await designStore.createDesign({
      designId: "design-meta-child",
      draftId: "draft-meta-child",
      name: "Meta child",
      definition: routeValidDefinition(),
    });
    await designStore.publishDraft("draft-meta-child");
    const queued: Array<{ runId: string; turnId: string; prompt: string }> = [];
    const persistedWorkflowRuntime = new PersistedWorkflowRuntimeService({
      db: handle.db,
      designStore,
      queue: {
        async queueAgentTurn(request) {
          queued.push({ runId: request.runId, turnId: request.turnId, prompt: request.prompt });
          return { queueItemRef: `queue://${request.turnId}` };
        },
      },
      createId: (() => { let value = 1; return () => `id-${value++}`; })(),
      now: (() => { let value = 10_000; return () => value++; })(),
    });
    const noteWrites: Array<{ beadId: string; idempotencyKey: string }> = [];
    registerWorkflowRoutes(app, {
      registry: createWorkflowRegistry(),
      workflowHomeDb: handle.db,
      workflowDesignStore: designStore,
      persistedWorkflowRuntime,
      metaWorkflowBeadProvider: {
        async readBeads(beadIds) {
          return beadIds
            .filter((beadId) => beadId !== "missing")
            .map((beadId) => ({
              beadId,
              title: `${beadId} title`,
              status: beadId === "archived" ? "archived" as const : "open" as const,
              workspaceId: beadId === "other" ? "workspace-b" : "workspace-a",
              accessible: beadId !== "hidden",
              url: `/beads/project?bead=${encodeURIComponent(beadId)}`,
            }));
        },
      },
      metaWorkflowNoteWriter: {
        async appendResultNote(input) {
          noteWrites.push({ beadId: input.beadId, idempotencyKey: input.idempotencyKey });
          if (input.beadId === "note-fails") throw new Error("note writer unavailable");
          return { noteRef: `note://${input.beadId}/${encodeURIComponent(input.idempotencyKey)}` };
        },
      },
    });

    const invalid = await app.request("/dashboard/api/workflows/meta-runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace-a",
        beadIds: ["A", "A", "hidden", "archived", "missing", "other"],
        childWorkflow: { designId: "design-meta-child", version: 1 },
        roleBindings: { dev: { sessionId: "session-dev" } },
      }),
    });
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toMatchObject({
      error: "META_WORKFLOW_INVALID_SELECTION",
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "META_WORKFLOW_DUPLICATE_BEAD" }),
        expect.objectContaining({ message: "Bead hidden is not accessible." }),
        expect.objectContaining({ message: "Bead archived is archived." }),
        expect.objectContaining({ message: "Bead missing was not found." }),
        expect.objectContaining({ message: "Bead other is not in this workspace." }),
      ]),
    });
    expect(queued).toEqual([]);

    const created = await app.request("/dashboard/api/workflows/meta-runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        metaRunId: "meta-route",
        workspaceId: "workspace-a",
        beadIds: ["A", "B"],
        childWorkflow: { designId: "design-meta-child", version: 1 },
        roleBindings: { dev: { sessionId: "session-dev" } },
      }),
    });
    expect(created.status).toBe(201);
    const createdBody = await created.json() as { metaRun: any };
    expect(createdBody.metaRun).toMatchObject({
      metaRunId: "meta-route",
      status: "running",
      childWorkflowDesignId: "design-meta-child",
      childWorkflowDesignVersion: 1,
      currentItem: { beadId: "A", childRunId: "child-meta-route-0" },
      progress: { running: 1, pending: 1 },
    });
    expect(queued).toHaveLength(1);
    const firstQueued = queued[0]!;
    expect(firstQueued).toMatchObject({ runId: "child-meta-route-0" });
    expect(firstQueued.prompt).not.toContain("coordinator");
    expect(firstQueued.prompt).not.toContain("bd ");

    const duplicateResume = await app.request("/dashboard/api/workflows/meta-runs/meta-route/resume", { method: "POST" });
    expect(duplicateResume.status).toBe(200);
    expect(queued).toHaveLength(1);

    const child = await persistedWorkflowRuntime.completeAgentTurn({
      runId: "child-meta-route-0",
      turnId: firstQueued.turnId,
      responseRef: "response-a",
      finalResponseText: '<decision action="done"><summary>A completed bd show /Users/example/private webhook queue item shell git status WorkflowStepState runReady</summary></decision>',
    });
    expect(child.run.status).toBe("completed");

    const stale = await app.request("/dashboard/api/workflows/meta-runs/meta-route/observe-child", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId: createdBody.metaRun.currentItem.itemId, childRunId: "wrong-child" }),
    });
    expect(stale.status).toBe(200);
    await expect(stale.json()).resolves.toMatchObject({ observed: { applied: false, reason: "stale" } });

    const observed = await app.request("/dashboard/api/workflows/meta-runs/meta-route/observe-child", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId: createdBody.metaRun.currentItem.itemId, childRunId: "child-meta-route-0" }),
    });
    expect(observed.status).toBe(200);
    const observedBody = await observed.json() as { observed: { run: any } };
    expect(observedBody.observed.run).toMatchObject({
      status: "running",
      currentItem: { beadId: "B", childRunId: "child-meta-route-1" },
      progress: { completed: 1, running: 1, pending: 0 },
    });
    const observedSerialized = JSON.stringify(observedBody);
    expect(observedSerialized).toContain("A completed workflow action");
    expect(observedSerialized).not.toContain("bd show");
    expect(observedSerialized).not.toContain("/Users/");
    expect(observedSerialized).not.toContain("webhook");
    expect(observedSerialized).not.toContain("queue item");
    expect(observedSerialized).not.toContain("WorkflowStepState");
    expect(observedSerialized).not.toContain("runReady");
    expect(noteWrites).toEqual([{ beadId: "A", idempotencyKey: "meta-run:meta-route:item:meta-route:item:0:result-note" }]);
    expect(queued.map((item) => item.runId)).toEqual(["child-meta-route-0", "child-meta-route-1"]);

    const noteFailure = await app.request("/dashboard/api/workflows/meta-runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        metaRunId: "meta-note-failure",
        workspaceId: "workspace-a",
        beadIds: ["note-fails"],
        childWorkflow: { designId: "design-meta-child", version: 1 },
        roleBindings: { dev: { sessionId: "session-dev" } },
      }),
    });
    expect(noteFailure.status).toBe(201);
    const noteFailureBody = await noteFailure.json() as { metaRun: any };
    const noteFailureQueue = queued.find((item) => item.runId === "child-meta-note-failure-0")!;
    await persistedWorkflowRuntime.completeAgentTurn({
      runId: "child-meta-note-failure-0",
      turnId: noteFailureQueue.turnId,
      responseRef: "response-note-failure",
      finalResponseText: '<decision action="done"><summary>Note writer should block</summary></decision>',
    });
    const noteFailureObserved = await app.request("/dashboard/api/workflows/meta-runs/meta-note-failure/observe-child", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId: noteFailureBody.metaRun.currentItem.itemId, childRunId: "child-meta-note-failure-0" }),
    });
    expect(noteFailureObserved.status).toBe(200);
    await expect(noteFailureObserved.json()).resolves.toMatchObject({
      observed: {
        applied: true,
        run: {
          status: "blocked",
          blockedReason: { code: "result_note_write_failed", message: "note writer unavailable" },
          currentItem: { beadId: "note-fails", status: "blocked" },
        },
      },
    });

    const list = await app.request("/dashboard/api/workflows/meta-runs?workspaceId=workspace-a");
    expect(list.status).toBe(200);
    const listPayload = await list.json();
    expect(listPayload).toMatchObject({
      metaRuns: expect.arrayContaining([expect.objectContaining({ metaRunId: "meta-route", progress: expect.objectContaining({ completed: 1 }) })]),
    });
    const listSerialized = JSON.stringify(listPayload);
    expect(listSerialized).not.toContain("bd show");
    expect(listSerialized).not.toContain("/Users/");
    expect(listSerialized).not.toContain("webhook");
    expect(listSerialized).not.toContain("queue item");
  });

  it("TEST_CASE_M117_1B rejects unknown command providers and commands through publish routes", async () => {
    const handle = await initVdDb({ path: ":memory:" });
    dbHandles.push(handle);
    const app = new Hono();
    const designStore = new DbWorkflowDesignStore({ db: handle.db });
    registerWorkflowRoutes(app, {
      registry: createWorkflowRegistry(),
      workflowHomeDb: handle.db,
      workflowDesignStore: designStore,
    });

    const unknownProvider = await app.request("/dashboard/api/workflow-designs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        designId: "design-route-unknown-provider",
        draftId: "draft-route-unknown-provider",
        name: "Unknown provider",
        publish: true,
        definition: routeCommandDefinition({ provider: "unknown.command", command: "workspace_status" }),
      }),
    });
    expect(unknownProvider.status).toBe(400);
    await expect(unknownProvider.json()).resolves.toMatchObject({
      error: "workflow_design_create_failed",
      issues: [expect.objectContaining({ path: "states.inspect.steps.0.provider" })],
    });
    await expect(designStore.getDraft("draft-route-unknown-provider")).resolves.toMatchObject({
      validationStatus: "invalid",
      validationIssues: [
        expect.objectContaining({
          path: "states.inspect.steps.0.provider",
          message: "unknown command provider unknown.command",
        }),
      ],
    });

    const unknownCommand = await app.request("/dashboard/api/workflow-designs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        designId: "design-route-unknown-command",
        draftId: "draft-route-unknown-command",
        name: "Unknown command",
        publish: true,
        definition: routeCommandDefinition({ provider: "first_party.command", command: "shell" }),
      }),
    });
    expect(unknownCommand.status).toBe(400);
    await expect(unknownCommand.json()).resolves.toMatchObject({
      error: "workflow_design_create_failed",
      issues: [expect.objectContaining({ path: "states.inspect.steps.0.command" })],
    });
    await expect(designStore.getDraft("draft-route-unknown-command")).resolves.toMatchObject({
      validationStatus: "invalid",
      validationIssues: [
        expect.objectContaining({
          path: "states.inspect.steps.0.command",
          message: "unsupported first-party command shell",
        }),
      ],
    });
  });

  it("TEST_CASE_M100_1A batch launch creates pending items, per-item errors, and respects route capacity", async () => {
    const handle = await initVdDb({ path: ":memory:" });
    dbHandles.push(handle);
    const app = new Hono();
    const designStore = new DbWorkflowDesignStore({ db: handle.db });
    await designStore.createDesign({
      designId: "design-batch-route",
      draftId: "draft-batch-route",
      name: "Batch Route Workflow",
      definition: routeLaunchDefinition(),
    });
    await designStore.publishDraft("draft-batch-route");
    const sessions = [
      vkSession("session-dev", "workspace-a", "Dev"),
      vkSession("session-review", "workspace-a", "Review"),
    ];
    const queued: Array<{ id: string; sessionId: string; prompt: string }> = [];
    const inboxStore = new DbWorkflowWebhookInboxStore({
      db: handle.db,
      createId: (() => {
        let value = 1;
        return () => `inbox-batch-route-${value++}`;
      })(),
      now: (() => {
        let value = 50_000;
        return () => value++;
      })(),
    });
    const finalResponses: Record<string, string> = {
      "exec-batch-first": '<decision action="done"></decision>',
    };
    registerWorkflowRoutes(app, {
      registry: createWorkflowRegistry(),
      workflowHomeDb: handle.db,
      workflowDesignStore: designStore,
      workflowWebhookInboxStore: inboxStore,
      vkWorkflowWebhookSecret: "secret",
      workflowBatchCapacity: {
        globalActiveRunLimit: 1,
        workspaceActiveRunLimit: 1,
      },
      vkClient: {
        getSessions: async () => sessions,
        getSession: async (sessionId) =>
          sessions.find((session) => session.id === sessionId)!,
        getExecutionProcessFinalMessage: async (executionProcessId) => ({
          execution_process_id: executionProcessId,
          session_id: "session-dev",
          workspace_id: "workspace-a",
          status: "completed",
          completed_at: "2026-08-11T00:00:00.000Z",
          coding_agent_turn_id: null,
          agent_session_id: null,
          agent_message_id: null,
          content:
            finalResponses[executionProcessId] ??
            '<decision action="done"></decision>',
          truncated: false,
          max_chars: 20_000,
          source_kind: "coding_agent_turn_summary",
          prompt_preview: null,
          prompt_truncated: false,
          prompt_max_chars: 0,
          prompt_source_kind: "coding_agent_turn_prompt",
        }),
        queueFollowUp: async (sessionId, prompt) => {
          const id = `queue-batch-${queued.length + 1}`;
          queued.push({ id, sessionId, prompt });
          return {
            queued_item: {
              id,
              session_id: sessionId,
              workspace_id: "workspace-a",
              status: "queued",
              source: "workflow",
              priority: 0,
              data: { message: prompt },
            },
            status: { count: 1, message: null, messages: [], status: "queued" },
          };
        },
      },
    });

    const response = await app.request("/dashboard/api/workflows/batches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace-a",
        designId: "design-batch-route",
        items: [
          { inputs: { featureRequest: "First" } },
          { inputs: {} },
          { inputs: { featureRequest: "Second" } },
        ],
        roleBindings: {
          dev: { mode: "existing", sessionId: "session-dev" },
          review: { mode: "existing", sessionId: "session-review" },
        },
      }),
    });

    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.batch).toMatchObject({
      workflowName: "Batch Route Workflow",
      status: "running",
      counts: { total: 3, running: 1, pending: 1, failed: 1 },
    });
    expect(payload.batch.detailUrl).toMatch(
      /^\/dashboard\/workflow-batches\/workflow-batch-/,
    );
    expect(payload.batch.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          itemIndex: 1,
          status: "failed",
          error: expect.objectContaining({
            fieldErrors: { featureRequest: "This field is required." },
          }),
        }),
      ]),
    );
    expect(payload.home.recentBatches[0]).toMatchObject({
      workflowName: "Batch Route Workflow",
      counts: { total: 3, running: 1, pending: 1, failed: 1 },
    });
    expect(payload.home.recentBatches[0].detailUrl).toBe(
      payload.batch.detailUrl,
    );
    expect(queued).toHaveLength(1);
    await expect(
      handle.db.selectFrom("WorkflowPersistedRun").selectAll().execute(),
    ).resolves.toHaveLength(1);

    const detailResponse = await app.request(
      `/dashboard/api/workflows/batches/${payload.batch.batchId}`,
    );
    expect(detailResponse.status).toBe(200);
    const detailPayload = (await detailResponse.json()) as { batch: any };
    expect(detailPayload.batch).toMatchObject({
      workflowName: "Batch Route Workflow",
      capacity: {
        workspaceActiveRunLimit: 1,
        globalActiveRunLimit: 1,
        workspaceActiveRuns: 1,
        globalActiveRuns: 1,
      },
    });
    expect(detailPayload.batch.capacity.explanation).toContain(
      "workspace already has 1 active run",
    );
    expect(detailPayload.batch.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          lineNumber: 1,
          inputSummary: expect.stringContaining("featureRequest: First"),
          runUrl: expect.stringMatching(/^\/dashboard\/workflows\//),
        }),
        expect.objectContaining({
          lineNumber: 2,
          status: "failed",
          error: expect.objectContaining({
            message: "Batch item 2 is missing required workflow fields.",
          }),
        }),
        expect.objectContaining({
          lineNumber: 3,
          status: "pending",
          pendingReason: expect.stringContaining(
            "workspace already has 1 active run",
          ),
        }),
      ]),
    );

    const webhookBody = JSON.stringify(
      vkWebhookPayload({
        delivery_id: "delivery-batch-first",
        workspace_id: "workspace-a",
        session_id: "session-dev",
        execution_id: "exec-batch-first",
        queue_item_id: queued[0]!.id,
      }),
    );
    const webhook = await app.request("/dashboard/api/workflow-webhooks/vk", {
      method: "POST",
      headers: signedVkWebhookHeaders("secret", webhookBody),
      body: webhookBody,
    });
    expect(webhook.status).toBe(202);
    expect(queued).toHaveLength(2);
    const afterWebhook = await handle.db
      .selectFrom("WorkflowBatchItem")
      .select(["itemIndex", "status", "runId"])
      .orderBy("itemIndex")
      .execute();
    expect(afterWebhook[0]).toMatchObject({
      itemIndex: 0,
      status: "completed",
    });
    expect(afterWebhook[1]).toMatchObject({ itemIndex: 1, status: "failed" });
    expect(afterWebhook[2]).toMatchObject({ itemIndex: 2, status: "running" });
    expect(afterWebhook[2]?.runId).toContain("-item-2-run");
  });

  it("TEST_CASE_M95_1B creates or reuses launch sessions by role name and rejects workspace mismatches", async () => {
    const handle = await initVdDb({ path: ":memory:" });
    dbHandles.push(handle);
    const app = new Hono();
    const designStore = new DbWorkflowDesignStore({ db: handle.db });
    await designStore.createDesign({
      designId: "design-create-session",
      draftId: "draft-create-session",
      name: "Session Workflow",
      definition: routeLaunchDefinition(),
    });
    await designStore.publishDraft("draft-create-session");
    const sessions = [
      vkSession("session-review-reuse", "workspace-a", "Review"),
      vkSession("session-other-workspace", "workspace-b", "Dev"),
    ];
    const created: string[] = [];
    registerWorkflowRoutes(app, {
      registry: createWorkflowRegistry(),
      workflowHomeDb: handle.db,
      workflowDesignStore: designStore,
      vkClient: {
        getSessions: async (workspaceId) =>
          sessions.filter((session) => session.workspace_id === workspaceId),
        getSession: async (sessionId) => {
          const session = sessions.find(
            (candidate) => candidate.id === sessionId,
          );
          if (!session) throw new Error("session not found");
          return session;
        },
        createSession: async (body) => {
          created.push(body.name ?? "");
          const session = vkSession(
            `session-created-${created.length}`,
            body.workspace_id,
            body.name ?? null,
          );
          sessions.push(session);
          return session;
        },
        queueFollowUp: async (sessionId, prompt) => ({
          queued_item: {
            id: `queue-${sessionId}`,
            session_id: sessionId,
            workspace_id: "workspace-a",
            status: "queued",
            source: "workflow",
            priority: 0,
            data: { message: prompt },
          },
          status: { count: 1, message: null, messages: [], status: "queued" },
        }),
      },
    });

    const mismatch = await app.request("/dashboard/api/workflows/launch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace-a",
        designId: "design-create-session",
        inputs: { featureRequest: "Build launch flow" },
        roleBindings: {
          dev: { mode: "existing", sessionId: "session-other-workspace" },
          review: { mode: "create_or_reuse", name: "Review" },
        },
      }),
    });
    expect(mismatch.status).toBe(400);
    await expect(mismatch.json()).resolves.toMatchObject({
      message: "Dev session belongs to another workspace.",
      fieldErrors: { "role.dev": "Dev session belongs to another workspace." },
    });

    const launched = await app.request("/dashboard/api/workflows/launch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace-a",
        designId: "design-create-session",
        inputs: { featureRequest: "Build launch flow" },
        roleBindings: {
          dev: { mode: "create_or_reuse", name: "Dev" },
          review: { mode: "create_or_reuse", name: "Review" },
        },
      }),
    });
    expect(launched.status).toBe(201);
    expect(created).toEqual(["Dev"]);
    const runRow = await handle.db
      .selectFrom("WorkflowPersistedRun")
      .selectAll()
      .executeTakeFirstOrThrow();
    expect(JSON.parse(runRow.roleBindingsJson)).toMatchObject({
      dev: { sessionId: "session-created-1" },
      review: { sessionId: "session-review-reuse" },
    });
  });

  it("TEST_CASE_M96_1B completes beads-form human attention and resumes persisted workflow once", async () => {
    const handle = await initVdDb({ path: ":memory:" });
    dbHandles.push(handle);
    const app = new Hono();
    const designStore = new DbWorkflowDesignStore({ db: handle.db });
    const orchestrationStore = new DbWorkflowOrchestrationStore({
      db: handle.db,
      now: (() => {
        let value = 9000;
        return () => value++;
      })(),
    });
    await designStore.createDesign({
      designId: "design-human-route",
      draftId: "draft-human-route",
      name: "Human Route Workflow",
      definition: routeHumanFormDefinition(),
    });
    await designStore.publishDraft("draft-human-route");
    const sessions = [vkSession("session-dev", "workspace-a", "Dev")];
    const queued: Array<{ sessionId: string; prompt: string }> = [];
    registerWorkflowRoutes(app, {
      registry: createWorkflowRegistry(),
      workflowHomeDb: handle.db,
      workflowDesignStore: designStore,
      workflowOrchestrationStore: orchestrationStore,
      vkClient: {
        getSessions: async () => sessions,
        getSession: async () => sessions[0]!,
        queueFollowUp: async (sessionId, prompt) => {
          queued.push({ sessionId, prompt });
          return {
            queued_item: {
              id: `queue-${queued.length}`,
              session_id: sessionId,
              workspace_id: "workspace-a",
              status: "queued",
              source: "workflow",
              priority: 0,
              data: { message: prompt },
            },
            status: { count: 1, message: null, messages: [], status: "queued" },
          };
        },
      },
    });

    const launch = await app.request("/dashboard/api/workflows/launch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace-a",
        designId: "design-human-route",
        inputs: {},
        roleBindings: { dev: { mode: "existing", sessionId: "session-dev" } },
      }),
    });
    expect(launch.status).toBe(201);
    const attention = (
      await orchestrationStore.listAttentionItems({ status: "active" })
    ).items[0]!;

    const invalid = await app.request(
      `/dashboard/api/workflow-attention-items/${attention.attentionItemId}/complete`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stateVisitId: attention.stateVisitId,
          submission: {},
        }),
      },
    );
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toMatchObject({
      result: { reason: "invalid_submission" },
    });

    const complete = await app.request(
      `/dashboard/api/workflow-attention-items/${attention.attentionItemId}/complete`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stateVisitId: attention.stateVisitId,
          submission: { approved: true },
        }),
      },
    );
    expect(complete.status).toBe(200);
    await expect(complete.json()).resolves.toMatchObject({
      result: {
        applied: true,
        reason: "applied",
        attention: { status: "resolved" },
      },
    });
    expect(queued).toMatchObject([
      {
        sessionId: "session-dev",
        prompt: expect.stringContaining("Approved: true"),
      },
    ]);

    const duplicate = await app.request(
      `/dashboard/api/workflow-attention-items/${attention.attentionItemId}/complete`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stateVisitId: attention.stateVisitId,
          submission: { approved: false },
        }),
      },
    );
    expect(duplicate.status).toBe(200);
    await expect(duplicate.json()).resolves.toMatchObject({
      result: { applied: false, reason: "attention_not_active" },
    });
    expect(queued).toHaveLength(1);
  });

  it("TEST_CASE_M96_1B does not report success when persisted workflow resume is unavailable or fails", async () => {
    const handle = await initVdDb({ path: ":memory:" });
    dbHandles.push(handle);
    const designStore = new DbWorkflowDesignStore({ db: handle.db });
    const orchestrationStore = new DbWorkflowOrchestrationStore({
      db: handle.db,
      now: (() => {
        let value = 9500;
        return () => value++;
      })(),
    });
    await designStore.createDesign({
      designId: "design-human-failure",
      draftId: "draft-human-failure",
      name: "Human Failure Workflow",
      definition: routeHumanFormDefinition(),
    });
    await designStore.publishDraft("draft-human-failure");
    const sessions = [vkSession("session-dev", "workspace-a", "Dev")];
    const launchApp = new Hono();
    registerWorkflowRoutes(launchApp, {
      registry: createWorkflowRegistry(),
      workflowHomeDb: handle.db,
      workflowDesignStore: designStore,
      workflowOrchestrationStore: orchestrationStore,
      vkClient: {
        getSessions: async () => sessions,
        getSession: async () => sessions[0]!,
        queueFollowUp: async (sessionId, prompt) => ({
          queued_item: {
            id: `queue-${sessionId}`,
            session_id: sessionId,
            workspace_id: "workspace-a",
            status: "queued",
            source: "workflow",
            priority: 0,
            data: { message: prompt },
          },
          status: { count: 1, message: null, messages: [], status: "queued" },
        }),
      },
    });
    const launch = await launchApp.request("/dashboard/api/workflows/launch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace-a",
        designId: "design-human-failure",
        inputs: {},
        roleBindings: { dev: { mode: "existing", sessionId: "session-dev" } },
      }),
    });
    expect(launch.status).toBe(201);
    const attention = (
      await orchestrationStore.listAttentionItems({ status: "active" })
    ).items[0]!;

    const unavailableApp = new Hono();
    registerWorkflowRoutes(unavailableApp, {
      registry: createWorkflowRegistry(),
      workflowHomeDb: handle.db,
      workflowDesignStore: designStore,
      workflowOrchestrationStore: orchestrationStore,
    });
    const unavailable = await unavailableApp.request(
      `/dashboard/api/workflow-attention-items/${attention.attentionItemId}/complete`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stateVisitId: attention.stateVisitId,
          submission: { approved: true },
        }),
      },
    );
    expect(unavailable.status).toBe(503);
    await expect(unavailable.json()).resolves.toMatchObject({
      error: "workflow_persisted_runtime_not_configured",
    });
    await expect(
      orchestrationStore.getAttentionItem(attention.attentionItemId),
    ).resolves.toMatchObject({ status: "active" });

    const failingApp = new Hono();
    registerWorkflowRoutes(failingApp, {
      registry: createWorkflowRegistry(),
      workflowHomeDb: handle.db,
      workflowDesignStore: designStore,
      workflowOrchestrationStore: orchestrationStore,
      persistedWorkflowRuntime: {
        launch: async () => {
          throw new Error("not used");
        },
        completeHumanForm: async () => {
          throw new Error("persisted resume failed");
        },
        completeAgentTurn: async () => {
          throw new Error("not used");
        },
        getRun: async () => null,
      },
    });
    const failed = await failingApp.request(
      `/dashboard/api/workflow-attention-items/${attention.attentionItemId}/complete`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stateVisitId: attention.stateVisitId,
          submission: { approved: true },
        }),
      },
    );
    expect(failed.status).toBe(500);
    await expect(failed.json()).resolves.toMatchObject({
      error: "workflow_persisted_resume_failed",
      message: "persisted resume failed",
    });
    await expect(
      orchestrationStore.getAttentionItem(attention.attentionItemId),
    ).resolves.toMatchObject({ status: "resolved" });
    await expect(
      handle.db
        .selectFrom("WorkflowPersistedRun")
        .select(["status", "coreSnapshotJson"])
        .executeTakeFirstOrThrow(),
    ).resolves.toMatchObject({ status: "running" });
    const persisted = await handle.db
      .selectFrom("WorkflowPersistedRun")
      .select(["coreSnapshotJson"])
      .executeTakeFirstOrThrow();
    expect(JSON.parse(persisted.coreSnapshotJson)).toMatchObject({
      waitingFor: { kind: "human_form" },
    });

    const recoveredQueued: Array<{ sessionId: string; prompt: string }> = [];
    const recoveryApp = new Hono();
    registerWorkflowRoutes(recoveryApp, {
      registry: createWorkflowRegistry(),
      workflowHomeDb: handle.db,
      workflowDesignStore: designStore,
      workflowOrchestrationStore: orchestrationStore,
      vkClient: {
        queueFollowUp: async (sessionId, prompt) => {
          recoveredQueued.push({ sessionId, prompt });
          return {
            queued_item: {
              id: `queue-recovered-${recoveredQueued.length}`,
              session_id: sessionId,
              workspace_id: "workspace-a",
              status: "queued",
              source: "workflow",
              priority: 0,
              data: { message: prompt },
            },
            status: { count: 1, message: null, messages: [], status: "queued" },
          };
        },
      },
    });
    const recovered = await recoveryApp.request(
      `/dashboard/api/workflow-attention-items/${attention.attentionItemId}/complete`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stateVisitId: attention.stateVisitId,
          submission: { approved: true },
        }),
      },
    );
    expect(recovered.status).toBe(200);
    await expect(recovered.json()).resolves.toMatchObject({
      recovered: true,
      result: { applied: true, reason: "applied" },
    });
    expect(recoveredQueued).toEqual([
      {
        sessionId: "session-dev",
        prompt: expect.stringContaining("Approved: true"),
      },
    ]);
    const resumed = await handle.db
      .selectFrom("WorkflowPersistedRun")
      .select(["coreSnapshotJson"])
      .executeTakeFirstOrThrow();
    expect(JSON.parse(resumed.coreSnapshotJson)).toMatchObject({
      waitingFor: { kind: "agent_turn" },
    });
  });

  it("TEST_CASE_M96_1B does not catch up persisted resume from an old resolved attention item", async () => {
    const handle = await initVdDb({ path: ":memory:" });
    dbHandles.push(handle);
    const designStore = new DbWorkflowDesignStore({ db: handle.db });
    const orchestrationStore = new DbWorkflowOrchestrationStore({
      db: handle.db,
      now: (() => {
        let value = 9800;
        return () => value++;
      })(),
    });
    await designStore.createDesign({
      designId: "design-human-stale",
      draftId: "draft-human-stale",
      name: "Human Stale Workflow",
      definition: routeHumanFormDefinition(),
    });
    await designStore.publishDraft("draft-human-stale");
    const sessions = [vkSession("session-dev", "workspace-a", "Dev")];
    const launchApp = new Hono();
    registerWorkflowRoutes(launchApp, {
      registry: createWorkflowRegistry(),
      workflowHomeDb: handle.db,
      workflowDesignStore: designStore,
      workflowOrchestrationStore: orchestrationStore,
      vkClient: {
        getSessions: async () => sessions,
        getSession: async () => sessions[0]!,
        queueFollowUp: async (sessionId, prompt) => ({
          queued_item: {
            id: `queue-${sessionId}`,
            session_id: sessionId,
            workspace_id: "workspace-a",
            status: "queued",
            source: "workflow",
            priority: 0,
            data: { message: prompt },
          },
          status: { count: 1, message: null, messages: [], status: "queued" },
        }),
      },
    });
    const launch = await launchApp.request("/dashboard/api/workflows/launch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace-a",
        designId: "design-human-stale",
        inputs: {},
        roleBindings: { dev: { mode: "existing", sessionId: "session-dev" } },
      }),
    });
    expect(launch.status).toBe(201);
    const currentAttention = (
      await orchestrationStore.listAttentionItems({ status: "active" })
    ).items[0]!;

    await orchestrationStore.createInstance({
      instanceId: "old-resolved-run",
      workflowId: "old-workflow",
      trigger: "manual",
      input: { workspaceId: "workspace-a" },
    });
    await orchestrationStore.createStepState({
      id: "old-step",
      instanceId: "old-resolved-run",
      stepKey: currentAttention.stepId,
    });
    await orchestrationStore.startInstance("old-resolved-run", {
      currentStepId: currentAttention.stepId,
    });
    await orchestrationStore.markStepRunning("old-step");
    await orchestrationStore.createHumanAttention({
      attentionItemId: "attention-old-turn",
      instanceId: "old-resolved-run",
      stepStateId: "old-step",
      stepKey: currentAttention.stepId,
      stateId: currentAttention.stateId,
      stateVisitId: "old-visit",
      idempotencyKey: "old-resolved-run:old-visit:approval",
      title: "Old approval",
      formSchema: { fields: { approved: { required: true } } },
    });
    await orchestrationStore.completeHumanAttention({
      attentionItemId: "attention-old-turn",
      stateVisitId: "old-visit",
      submission: { approved: false },
    });
    await handle.db
      .updateTable("WorkflowAttentionItem")
      .set({ instanceId: currentAttention.instanceId })
      .where("attentionItemId", "=", "attention-old-turn")
      .execute();

    const queued: Array<{ sessionId: string; prompt: string }> = [];
    const app = new Hono();
    registerWorkflowRoutes(app, {
      registry: createWorkflowRegistry(),
      workflowHomeDb: handle.db,
      workflowDesignStore: designStore,
      workflowOrchestrationStore: orchestrationStore,
      vkClient: {
        queueFollowUp: async (sessionId, prompt) => {
          queued.push({ sessionId, prompt });
          return {
            queued_item: {
              id: `queue-stale-${queued.length}`,
              session_id: sessionId,
              workspace_id: "workspace-a",
              status: "queued",
              source: "workflow",
              priority: 0,
              data: { message: prompt },
            },
            status: { count: 1, message: null, messages: [], status: "queued" },
          };
        },
      },
    });
    const stale = await app.request(
      "/dashboard/api/workflow-attention-items/attention-old-turn/complete",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stateVisitId: "old-visit",
          submission: { approved: false },
        }),
      },
    );

    expect(stale.status).toBe(200);
    await expect(stale.json()).resolves.toMatchObject({
      result: { applied: false, reason: "attention_not_active" },
    });
    expect(queued).toEqual([]);
    const persisted = await handle.db
      .selectFrom("WorkflowPersistedRun")
      .select(["coreSnapshotJson"])
      .executeTakeFirstOrThrow();
    expect(JSON.parse(persisted.coreSnapshotJson)).toMatchObject({
      waitingFor: { kind: "human_form" },
    });
  });

  it("runs workflows by id and returns the workflow run record", async () => {
    const registry = createWorkflowRegistry();
    const workflow = {
      id: "echo",
      trigger: "manual",
      run: async (ctx, input) => {
        ctx.log("echo", "echoing input");
        return input;
      },
    } satisfies WorkflowDefinition<{ value: string }, { value: string }>;
    registry.register(workflow);
    const app = new Hono();
    registerWorkflowRoutes(app, {
      registry,
      githubWebhookSecret: "secret",
      runOptions: {
        createRunId: () => "run_route",
        now: (() => {
          let value = 10;
          return () => value++;
        })(),
      },
    });

    const response = await app.request("/dashboard/api/workflows/echo/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "hello" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      run: {
        runId: "run_route",
        workflowId: "echo",
        status: "completed",
        input: { value: "hello" },
        output: { value: "hello" },
      },
    });
  });

  it("persists manual workflow route runs through the configured recorder", async () => {
    const registry = createWorkflowRegistry();
    registry.register({
      id: "persisted",
      trigger: "manual",
      run: async (ctx, input) => {
        ctx.log("persist", "persisting output");
        return { ok: true, input };
      },
    });
    const handle = await initVdDb({ path: ":memory:" });
    dbHandles.push(handle);
    const app = new Hono();
    registerWorkflowRoutes(app, {
      registry,
      workflowRunRecorder: new DbWorkflowRunRecorder({ db: handle.db }),
      runOptions: {
        createRunId: () => "run_route_persisted",
        now: (() => {
          let value = 20;
          return () => value++;
        })(),
      },
    });

    const response = await app.request(
      "/dashboard/api/workflows/persisted/run",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: "stored" }),
      },
    );

    expect(response.status).toBe(200);
    const persisted = await handle.db
      .selectFrom("WorkflowRun")
      .selectAll()
      .where("runId", "=", "run_route_persisted")
      .executeTakeFirstOrThrow();
    expect(persisted).toMatchObject({
      workflowId: "persisted",
      status: "completed",
    });
    expect(JSON.parse(persisted.inputJson)).toEqual({ value: "stored" });
  });

  it("exposes read-only workflow run list/get/events APIs", async () => {
    const registry = createWorkflowRegistry();
    registry.register({
      id: "inspectable",
      trigger: "manual",
      run: async (ctx, input) => {
        ctx.log("inspect", "inspectable event", "info", {
          authorization: "Bearer secret",
        });
        return {
          outcome: "message_queued",
          workspaceId: "ws-read",
          sessionId: "session-read",
          queueItemId: "queue-read",
          input,
        };
      },
    });
    const handle = await initVdDb({ path: ":memory:" });
    dbHandles.push(handle);
    const app = new Hono();
    registerWorkflowRoutes(app, {
      registry,
      workflowRunRecorder: new DbWorkflowRunRecorder({ db: handle.db }),
      workflowRunReader: new DbWorkflowRunReader({ db: handle.db }),
      runOptions: {
        createRunId: () => "run_read",
        now: (() => {
          let value = 30;
          return () => value++;
        })(),
      },
    });

    await app.request("/dashboard/api/workflows/inspectable/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "ghp_secret" }),
    });

    const listResponse = await app.request(
      "/dashboard/api/workflow-runs?workflowId=inspectable&status=completed&vkQueueItemId=queue-read&limit=1",
    );
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toMatchObject({
      runs: [
        {
          runId: "run_read",
          workflowId: "inspectable",
          status: "completed",
          input: { token: "[REDACTED]" },
          vkWorkspaceId: "ws-read",
          vkSessionId: "session-read",
          vkQueueItemId: "queue-read",
        },
      ],
      limit: 1,
      offset: 0,
      hasMore: false,
    });

    const getResponse = await app.request(
      "/dashboard/api/workflow-runs/run_read",
    );
    expect(getResponse.status).toBe(200);
    await expect(getResponse.json()).resolves.toMatchObject({
      run: { runId: "run_read", output: { queueItemId: "queue-read" } },
    });

    const eventsResponse = await app.request(
      "/dashboard/api/workflow-runs/run_read/events?limit=2",
    );
    expect(eventsResponse.status).toBe(200);
    await expect(eventsResponse.json()).resolves.toMatchObject({
      events: [
        { eventType: "run_started" },
        { eventType: "step_log", data: { authorization: "[REDACTED]" } },
      ],
      limit: 2,
      offset: 0,
      hasMore: true,
    });
  });

  it("returns 404 for missing workflow run inspection endpoints", async () => {
    const handle = await initVdDb({ path: ":memory:" });
    dbHandles.push(handle);
    const app = new Hono();
    registerWorkflowRoutes(app, {
      registry: createWorkflowRegistry(),
      workflowRunReader: new DbWorkflowRunReader({ db: handle.db }),
    });

    const runResponse = await app.request(
      "/dashboard/api/workflow-runs/missing",
    );
    expect(runResponse.status).toBe(404);
    await expect(runResponse.json()).resolves.toEqual({
      error: "workflow_run_not_found",
    });

    const eventsResponse = await app.request(
      "/dashboard/api/workflow-runs/missing/events",
    );
    expect(eventsResponse.status).toBe(404);
    await expect(eventsResponse.json()).resolves.toEqual({
      error: "workflow_run_not_found",
    });
  });

  it("resolves team role sessions through configured resolver", async () => {
    const app = new Hono();
    const resolver = {
      resolve: vi.fn(async () => ({
        ok: true,
        results: [
          {
            roleId: "agent-a",
            roleName: "orchestrator",
            status: "resolved",
            sessionId: "session-a",
            workspaceId: "ws-1",
            laneId: null,
            executor: "CODEX",
            source: "auto_created",
            bindingId: "binding-a",
            warnings: [],
            error: null,
          },
        ],
        errors: [],
        warnings: [],
      })),
    };
    registerWorkflowRoutes(app, {
      registry: createWorkflowRegistry(),
      roleSessionResolver: resolver as never,
    });

    const response = await app.request(
      "/dashboard/api/agent-team-session-mappings/resolve",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          team: { id: "team-1", agents: [] },
          workspaceId: "ws-1",
          roleIds: ["agent-a"],
          allowAutoCreate: true,
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(resolver.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws-1",
        roleIds: ["agent-a"],
        allowAutoCreate: true,
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      results: [{ sessionId: "session-a" }],
    });
  });

  it("returns 503 when role session resolver is not configured", async () => {
    const app = new Hono();
    registerWorkflowRoutes(app, { registry: createWorkflowRegistry() });

    const response = await app.request(
      "/dashboard/api/agent-team-session-mappings/resolve",
      { method: "POST" },
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "role_session_resolver_not_configured",
    });
  });

  it("exposes workflow activity scanner read API with explicit policy", async () => {
    const app = new Hono();
    const scanner = {
      scanOnce: vi.fn(async () => ({
        generatedAt: 1000,
        vkGeneratedAt: "2026-08-04T00:00:00.000Z",
        callbackStateAvailable: false,
        sessions: [
          {
            workspaceId: "ws-activity",
            sessionId: "session-activity",
            roleId: "role-a",
            roleName: "agent",
            laneId: null,
            instanceId: null,
            stepStateId: null,
            triggerId: null,
            bindingId: "binding-a",
            externalWaitId: null,
            classification: "running",
            reason: "VK activity reports running execution",
            ownsWorkflowSession: true,
            consumesExecutionBudget: true,
            eligibleForUnrelatedWork: false,
            queueCount: 0,
            runningExecutionProcessIds: ["exec-a"],
            completedResponse: null,
            executionProcess: null,
            updatedAt: 999,
            warnings: [],
          },
        ],
        budget: {
          maxActiveExecutions: 4,
          activeExecutionCount: 1,
          availableExecutionSlots: 3,
          maxWorkflowOwnedSessions: 7,
          workflowOwnedSessionCount: 1,
          availableWorkflowOwnedSessionSlots: 6,
          vkQueuedCount: 0,
          eligibleSessionCount: 0,
          blockedSessionCount: 1,
          eligibleSessions: [],
        },
        warnings: [],
      })),
    };
    registerWorkflowRoutes(app, {
      registry: createWorkflowRegistry(),
      workflowActivityScanner: scanner as never,
    });

    const response = await app.request(
      "/dashboard/api/workflow-activity?maxActiveExecutions=4&maxWorkflowOwnedSessions=7",
    );

    expect(response.status).toBe(200);
    expect(scanner.scanOnce).toHaveBeenCalledWith({
      maxActiveExecutions: 4,
      maxWorkflowOwnedSessions: 7,
    });
    await expect(response.json()).resolves.toMatchObject({
      sessions: [{ sessionId: "session-activity", classification: "running" }],
      callbackStateAvailable: false,
    });
  });

  it("returns 503 when workflow activity scanner is not configured", async () => {
    const app = new Hono();
    registerWorkflowRoutes(app, { registry: createWorkflowRegistry() });

    const response = await app.request("/dashboard/api/workflow-activity");

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "workflow_activity_scanner_not_configured",
    });
  });

  it("exposes read-only workflow orchestration instance and trigger APIs", async () => {
    const handle = await initVdDb({ path: ":memory:" });
    dbHandles.push(handle);
    const store = new DbWorkflowOrchestrationStore({
      db: handle.db,
      now: (() => {
        let value = 1000;
        return () => value++;
      })(),
    });
    await store.createInstance({
      instanceId: "instance_route",
      workflowId: "durable-workflow",
      teamId: "team-route",
      laneId: "lane-route",
      trigger: "manual",
      input: { task: "inspect" },
    });
    await store.startInstance("instance_route");
    await store.createScopedTrigger({
      triggerId: "trigger_route",
      instanceId: "instance_route",
      workspaceId: "ws-route",
      sessionId: "session-route",
      mode: "next_completion_after_cursor",
      cursorExecutionProcessId: "exec-before",
    });

    const app = new Hono();
    registerWorkflowRoutes(app, {
      registry: createWorkflowRegistry(),
      workflowOrchestrationStore: store,
    });

    const listResponse = await app.request(
      "/dashboard/api/workflow-instances?workflowId=durable-workflow&status=running&teamId=team-route&limit=1",
    );
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toMatchObject({
      instances: [
        {
          instanceId: "instance_route",
          status: "running",
          input: { task: "inspect" },
        },
      ],
      limit: 1,
      offset: 0,
      hasMore: false,
    });

    const getResponse = await app.request(
      "/dashboard/api/workflow-instances/instance_route",
    );
    expect(getResponse.status).toBe(200);
    await expect(getResponse.json()).resolves.toMatchObject({
      instance: {
        instanceId: "instance_route",
        workflowId: "durable-workflow",
      },
    });

    const triggerListResponse = await app.request(
      "/dashboard/api/workflow-scoped-triggers?instanceId=instance_route&status=active&workspaceId=ws-route",
    );
    expect(triggerListResponse.status).toBe(200);
    await expect(triggerListResponse.json()).resolves.toMatchObject({
      triggers: [
        {
          triggerId: "trigger_route",
          sessionId: "session-route",
          mode: "next_completion_after_cursor",
        },
      ],
    });

    const triggerGetResponse = await app.request(
      "/dashboard/api/workflow-scoped-triggers/trigger_route",
    );
    expect(triggerGetResponse.status).toBe(200);
    await expect(triggerGetResponse.json()).resolves.toMatchObject({
      trigger: {
        triggerId: "trigger_route",
        cursorExecutionProcessId: "exec-before",
      },
    });
  });

  it("exposes workflow attention feed and completion APIs for human-turn form submissions", async () => {
    const handle = await initVdDb({ path: ":memory:" });
    dbHandles.push(handle);
    const store = new DbWorkflowOrchestrationStore({
      db: handle.db,
      now: (() => {
        let value = 5000;
        return () => value++;
      })(),
    });
    await store.createInstance({
      instanceId: "instance_attention",
      workflowId: "human-workflow",
      teamId: "team-route",
      laneId: "lane-route",
      trigger: "manual",
      input: { task: "needs approval" },
    });
    await store.createStepState({
      id: "step_human",
      instanceId: "instance_attention",
      stepKey: "human_approval",
    });
    await store.startInstance("instance_attention", {
      currentStepId: "human_approval",
    });
    await store.markStepRunning("step_human");
    await store.createHumanAttention({
      attentionItemId: "attention_route",
      instanceId: "instance_attention",
      stepStateId: "step_human",
      stepKey: "human_approval",
      stateId: "waiting_for_user",
      stateVisitId: "visit_route",
      idempotencyKey: "instance_attention:visit_route:human_approval",
      title: "Answer planning questions",
      presentationUrl: "/dashboard/workflows/instance_attention",
      formRef: "beads-form://vibe-kanban-vscode-web/attention_route",
      formSchema: { fields: { approved: { required: true } } },
    });

    const app = new Hono();
    registerWorkflowRoutes(app, {
      registry: createWorkflowRegistry(),
      workflowOrchestrationStore: store,
    });

    const listResponse = await app.request(
      "/dashboard/api/workflow-attention-items?status=active&teamId=team-route&limit=1",
    );
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toMatchObject({
      items: [
        {
          attentionItemId: "attention_route",
          status: "active",
          kind: "human_turn",
          title: "Answer planning questions",
          presentationUrl: "/dashboard/workflows/instance_attention",
          formRef: "beads-form://vibe-kanban-vscode-web/attention_route",
        },
      ],
      hasMore: false,
    });

    const invalidResponse = await app.request(
      "/dashboard/api/workflow-attention-items/attention_route/complete",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stateVisitId: "visit_route", submission: {} }),
      },
    );
    expect(invalidResponse.status).toBe(400);
    await expect(invalidResponse.json()).resolves.toMatchObject({
      result: {
        applied: false,
        reason: "invalid_submission",
        validationErrors: [{ path: "submission.approved" }],
      },
    });

    const completeResponse = await app.request(
      "/dashboard/api/workflow-attention-items/attention_route/complete",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stateVisitId: "visit_route",
          submission: { approved: true, remarks: "Ship it." },
        }),
      },
    );
    expect(completeResponse.status).toBe(200);
    await expect(completeResponse.json()).resolves.toMatchObject({
      result: {
        applied: true,
        reason: "applied",
        attention: { status: "resolved" },
        instance: { status: "running" },
      },
    });

    const getResponse = await app.request(
      "/dashboard/api/workflow-attention-items/attention_route",
    );
    expect(getResponse.status).toBe(200);
    await expect(getResponse.json()).resolves.toMatchObject({
      item: {
        status: "resolved",
        resolution: { submission: { approved: true, remarks: "Ship it." } },
      },
    });
  });

  it("TEST_CASE_M98_1B exposes a clean persisted workflow run presentation read model", async () => {
    const handle = await initVdDb({ path: ":memory:" });
    dbHandles.push(handle);
    const designStore = new DbWorkflowDesignStore({
      db: handle.db,
      templates: BUILT_IN_WORKFLOW_TEMPLATES,
    });
    await designStore.useTemplate({
      templateId: "built-in/dev-review-tester",
      designId: "design.presentation.drt",
      draftId: "draft.presentation.drt",
    });
    await designStore.publishDraft("draft.presentation.drt");
    const queued: any[] = [];
    const runtime = new PersistedWorkflowRuntimeService({
      db: handle.db,
      designStore,
      queue: {
        async queueAgentTurn(request) {
          queued.push(request);
          return { queueItemRef: `queue://${request.turnId}` };
        },
      },
      now: (() => {
        let value = 10_000;
        return () => value++;
      })(),
      createId: (() => {
        let value = 1;
        return () => `id-${value++}`;
      })(),
    });
    await runtime.launch({
      runId: "run-presentation-drt",
      runSnapshotId: "snapshot-presentation-drt",
      designId: "design.presentation.drt",
      workspaceId: "workspace-a",
      inputs: { featureRequest: "Build presentation for persisted runs" },
      roleBindings: {
        dev: { sessionId: "session-dev" },
        review: { sessionId: "session-review" },
        tester: { sessionId: "session-tester" },
      },
    });
    await runtime.completeAgentTurn({
      runId: "run-presentation-drt",
      turnId: queued[0].turnId,
      responseRef: "dev-impl",
    });
    await runtime.completeAgentTurn({
      runId: "run-presentation-drt",
      turnId: queued[1].turnId,
      responseRef: "dev-self",
      finalResponseText:
        '<decision action="ready_for_review"><summary>Done</summary></decision>',
    });
    await runtime.completeAgentTurn({
      runId: "run-presentation-drt",
      turnId: queued[2].turnId,
      responseRef: "review-ok",
      finalResponseText:
        '<decision action="approved"><remarks>Looks good</remarks></decision>',
    });
    await runtime.completeAgentTurn({
      runId: "run-presentation-drt",
      turnId: queued[3].turnId,
      responseRef: "tester-ok",
      finalResponseText:
        '<decision action="approved"><testSummary>Passed</testSummary></decision>',
    });
    const mirrorStore = new DbWorkflowOrchestrationStore({ db: handle.db });
    await mirrorStore.createInstance({
      instanceId: "run-presentation-drt",
      workflowId: "legacy-mirror",
      trigger: "manual",
      input: { task: "legacy mirror should not win" },
      state: { definition: { name: "Legacy mirror presentation" } },
    });
    const app = new Hono();
    registerWorkflowRoutes(app, {
      registry: createWorkflowRegistry(),
      workflowHomeDb: handle.db,
      workflowDesignStore: designStore,
      workflowOrchestrationStore: mirrorStore,
    });

    const response = await app.request(
      "/dashboard/api/workflow-instances/run-presentation-drt/presentation",
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { presentation: any };
    expect(body.presentation).toMatchObject({
      workflowName: "Dev / Review / Tester",
      workflowId: "design.presentation.drt",
      status: "completed",
      originalTask: "Build presentation for persisted runs",
      provenance: {
        workflowDesignId: "design.presentation.drt",
        workflowVersion: 1,
      },
    });
    expect(
      body.presentation.timeline
        .filter((item: any) => item.kind === "agent_turn")
        .map((item: any) => item.role),
    ).toEqual(["Dev", "Dev", "Review", "Tester"]);
    expect(body.presentation.timeline.map((item: any) => item.kind)).toEqual(
      expect.arrayContaining(["decision"]),
    );
    expect(body.presentation.timeline[0]).toMatchObject({
      title: "Implement turn",
      status: "Complete",
    });
    expect(body.presentation.timeline[0].initialMessage.text).toContain(
      "Implement the requested feature",
    );
    expect(body.presentation.timeline[1].finalResponse.text).toContain(
      "Ready for review",
    );
    expect(
      body.presentation.timeline.find(
        (item: any) => item.id === queued[2].turnId,
      ).finalResponse.text,
    ).toContain("Approved");
    expect(
      body.presentation.timeline.find(
        (item: any) => item.id === queued[3].turnId,
      ).finalResponse.text,
    ).toContain("Passed");
    const rendered = JSON.stringify(
      body.presentation.timeline.map((item: any) => item.finalResponse),
    );
    expect(rendered).not.toContain("<decision");
    expect(rendered).not.toContain("rawXml");
    expect(rendered).not.toContain("dev-self");
    expect(rendered).not.toContain("review-ok");
    expect(rendered).not.toContain("tester-ok");
    expect(rendered).not.toContain("responseRef");
  });

  it("exposes a clean workflow presentation read model", async () => {
    const handle = await initVdDb({ path: ":memory:" });
    dbHandles.push(handle);
    const store = new DbWorkflowOrchestrationStore({
      db: handle.db,
      now: (() => {
        let value = 6000;
        return () => value++;
      })(),
    });
    await store.createInstance({
      instanceId: "instance_presentation",
      workflowId: "two-agent-review-round",
      trigger: "manual",
      input: { task: "show clean story" },
      state: { definition: { name: "Two agent review round" } },
    });
    await store.startInstance("instance_presentation");
    await store.createStepState({
      id: "ask_source_presentation",
      instanceId: "instance_presentation",
      stepKey: "ask_source",
      status: "completed",
      input: { template: "Implement {{inputs.task}}" },
      output: { workspaceId: "ws-source", sessionId: "session-source" },
    });
    await store.createStepState({
      id: "wait_source_presentation",
      instanceId: "instance_presentation",
      stepKey: "wait_source",
      status: "completed",
      output: {
        executionProcessId: "exec-source",
        workspaceId: "ws-source",
        sessionId: "session-source",
      },
    });
    await store.createStepState({
      id: "ask_review_presentation",
      instanceId: "instance_presentation",
      stepKey: "ask_review",
      status: "completed",
      input: { template: "Review {{source.response}}" },
      output: { workspaceId: "ws-review", sessionId: "session-review" },
    });
    await store.createStepState({
      id: "wait_review_presentation",
      instanceId: "instance_presentation",
      stepKey: "wait_review",
      status: "completed",
      output: {
        executionProcessId: "exec-review",
        workspaceId: "ws-review",
        sessionId: "session-review",
      },
    });
    await store.completeInstance("instance_presentation");

    const app = new Hono();
    registerWorkflowRoutes(app, {
      registry: createWorkflowRegistry(),
      workflowOrchestrationStore: store,
      vkClient: {
        getExecutionProcessFinalMessage: async (processId) => ({
          execution_process_id: processId,
          session_id:
            processId === "exec-source" ? "session-source" : "session-review",
          workspace_id: processId === "exec-source" ? "ws-source" : "ws-review",
          status: "completed",
          completed_at: "2026-08-11T00:00:00Z",
          coding_agent_turn_id: null,
          agent_session_id: null,
          agent_message_id: null,
          content: processId === "exec-source" ? "Implemented." : "Approved.",
          truncated: false,
          max_chars: 20_000,
          source_kind: "coding_agent_turn_summary",
          prompt_preview: null,
          prompt_truncated: false,
          prompt_max_chars: 4096,
          prompt_source_kind: "coding_agent_turn_prompt",
        }),
        getExecutionProcessRepoStates: async () => [],
      },
    });

    const response = await app.request(
      "/dashboard/api/workflow-instances/instance_presentation/presentation",
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      presentation: {
        workflowName: "Two agent review round",
        originalTask: "show clean story",
        status: "completed",
        timeline: [
          {
            role: "Implementer",
            initialMessage: { text: "Implement show clean story" },
            finalResponse: { text: "Implemented." },
          },
          {
            role: "Reviewer",
            initialMessage: {
              text: "Review Implementer response included above.",
            },
            finalResponse: { text: "Approved." },
          },
        ],
      },
    });
  });

  it("returns 404 for missing workflow orchestration inspection endpoints", async () => {
    const handle = await initVdDb({ path: ":memory:" });
    dbHandles.push(handle);
    const app = new Hono();
    registerWorkflowRoutes(app, {
      registry: createWorkflowRegistry(),
      workflowOrchestrationStore: new DbWorkflowOrchestrationStore({
        db: handle.db,
      }),
    });

    const instanceResponse = await app.request(
      "/dashboard/api/workflow-instances/missing",
    );
    expect(instanceResponse.status).toBe(404);
    await expect(instanceResponse.json()).resolves.toEqual({
      error: "workflow_instance_not_found",
    });

    const triggerResponse = await app.request(
      "/dashboard/api/workflow-scoped-triggers/missing",
    );
    expect(triggerResponse.status).toBe(404);
    await expect(triggerResponse.json()).resolves.toEqual({
      error: "workflow_scoped_trigger_not_found",
    });

    const attentionResponse = await app.request(
      "/dashboard/api/workflow-attention-items/missing",
    );
    expect(attentionResponse.status).toBe(404);
    await expect(attentionResponse.json()).resolves.toEqual({
      error: "workflow_attention_item_not_found",
    });

    const presentationResponse = await app.request(
      "/dashboard/api/workflow-instances/missing/presentation",
    );
    expect(presentationResponse.status).toBe(404);
    await expect(presentationResponse.json()).resolves.toEqual({
      error: "workflow_presentation_not_found",
      message: "Workflow not found",
    });
  });

  it("runs the GitHub CI failure workflow from the GitHub webhook route", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const registry = createWorkflowRegistry();
    registry.register({
      id: "github-ci-failure",
      trigger: "github.workflow_run",
      run: async (_ctx, input) => ({ outcome: "message_sent", input }),
    });
    const app = new Hono();
    registerWorkflowRoutes(app, {
      registry,
      githubWebhookSecret: "secret",
      repoAliasCache: {
        get: () => [{ name: "local-repo", aliases: ["owner/repo"] }],
        set: () => {},
      },
      runOptions: {
        createRunId: () => "run_webhook",
        now: () => 50,
      },
    });

    const body = JSON.stringify({ workflow_run: { conclusion: "failure" } });
    const response = await app.request("/dashboard/api/webhooks/github", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitHub-Event": "workflow_run",
        "X-GitHub-Delivery": "delivery-123",
        "X-Hub-Signature-256": signBody(body, "secret"),
      },
      body,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      outcome: "message_sent",
      run: {
        runId: "run_webhook",
        workflowId: "github-ci-failure",
        status: "completed",
        output: {
          outcome: "message_sent",
          input: {
            event: "workflow_run",
            payload: { workflow_run: { conclusion: "failure" } },
            repoAliases: [{ name: "local-repo", aliases: ["owner/repo"] }],
          },
        },
      },
    });
    expect(infoSpy).toHaveBeenCalledWith("GitHub webhook received", {
      delivery: "delivery-123",
      event: "workflow_run",
      action: undefined,
      workflowRunStatus: undefined,
      workflowRunConclusion: "failure",
      workflowRunHtmlUrl: undefined,
    });
    expect(infoSpy).toHaveBeenCalledWith("GitHub webhook workflow completed", {
      delivery: "delivery-123",
      event: "workflow_run",
      outcome: "message_sent",
      status: "completed",
      runId: "run_webhook",
    });
  });

  it("refreshes repo aliases and retries once when no workspace matches", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const registry = createWorkflowRegistry();
    registry.register({
      id: "github-ci-failure",
      trigger: "github.workflow_run",
      run: async (_ctx, input) => {
        const repoAliases =
          (input as { repoAliases?: Array<{ aliases: string[] }> })
            .repoAliases ?? [];
        const matched = repoAliases.some((repo) =>
          repo.aliases.includes("owner/repo"),
        );
        return matched
          ? { outcome: "message_sent", input }
          : { outcome: "no_matching_workspace", input };
      },
    });
    const app = new Hono();
    const refresh = vi.fn(async () => [
      { name: "local-repo", aliases: ["owner/repo"] },
    ]);
    registerWorkflowRoutes(app, {
      registry,
      githubWebhookSecret: "secret",
      repoAliasCache: {
        get: () => [{ name: "local-repo", aliases: [] }],
        set: () => {},
        refresh,
      },
      runOptions: {
        createRunId: (() => {
          let index = 0;
          return () => ["run_initial", "run_retry"][index++] ?? "run_extra";
        })(),
        now: (() => {
          let value = 50;
          return () => value++;
        })(),
      },
    });

    const body = JSON.stringify({ workflow_run: { conclusion: "failure" } });
    const response = await app.request("/dashboard/api/webhooks/github", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitHub-Event": "workflow_run",
        "X-GitHub-Delivery": "delivery-123",
        "X-Hub-Signature-256": signBody(body, "secret"),
      },
      body,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      outcome: "message_sent",
      run: {
        runId: "run_retry",
        output: {
          outcome: "message_sent",
          input: {
            repoAliases: [{ name: "local-repo", aliases: ["owner/repo"] }],
          },
        },
      },
    });
    expect(refresh).toHaveBeenCalledOnce();
    expect(infoSpy).toHaveBeenCalledWith(
      "Retrying GitHub webhook workflow after refreshing repo aliases",
      {
        delivery: "delivery-123",
        event: "workflow_run",
      },
    );
  });

  it("enforces GitHub webhook signatures before running workflows", async () => {
    const registry = createWorkflowRegistry();
    registry.register({
      id: "github-ci-failure",
      trigger: "github.workflow_run",
      run: async () => ({ outcome: "should_not_run" }),
    });
    const app = new Hono();
    registerWorkflowRoutes(app, { registry, githubWebhookSecret: "secret" });

    const missing = await app.request("/dashboard/api/webhooks/github", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitHub-Event": "workflow_run",
      },
      body: "{}",
    });
    expect(missing.status).toBe(401);
    await expect(missing.json()).resolves.toEqual({
      error: "github_signature_missing",
    });

    const invalid = await app.request("/dashboard/api/webhooks/github", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitHub-Event": "workflow_run",
        "X-Hub-Signature-256": "sha256=deadbeef",
      },
      body: "{}",
    });
    expect(invalid.status).toBe(401);
    await expect(invalid.json()).resolves.toEqual({
      error: "github_signature_invalid",
    });
  });

  it("fails closed when GitHub webhook secret is not configured", async () => {
    const registry = createWorkflowRegistry();
    registry.register({
      id: "github-ci-failure",
      trigger: "github.workflow_run",
      run: async () => ({ outcome: "should_not_run" }),
    });
    const app = new Hono();
    registerWorkflowRoutes(app, { registry, githubWebhookSecret: "" });
    const body = "{}";

    const response = await app.request("/dashboard/api/webhooks/github", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitHub-Event": "workflow_run",
        "X-Hub-Signature-256": signBody(body, "secret"),
      },
      body,
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "github_webhook_secret_not_configured",
    });
  });

  it("returns 404 for unknown workflows and 500 for failed workflows", async () => {
    const registry = createWorkflowRegistry();
    registry.register({
      id: "fail",
      trigger: "manual",
      run: async () => {
        throw new Error("workflow exploded");
      },
    });
    const app = new Hono();
    registerWorkflowRoutes(app, { registry });

    const missing = await app.request("/dashboard/api/workflows/missing/run", {
      method: "POST",
    });
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toMatchObject({
      error: "Workflow not found: missing",
    });

    const failed = await app.request("/dashboard/api/workflows/fail/run", {
      method: "POST",
    });
    expect(failed.status).toBe(500);
    await expect(failed.json()).resolves.toMatchObject({
      run: {
        workflowId: "fail",
        status: "failed",
        error: { message: "workflow exploded" },
      },
    });
  });

  it("starts declarative workflows through submit-and-return route", async () => {
    const runtime = {
      start: vi.fn(async () => ({
        instance: { instanceId: "instance-api", status: "waiting" },
        queuedSource: { queueItemId: "queue-api" },
      })),
      runOnce: vi.fn(),
    };
    const app = new Hono();
    registerWorkflowRoutes(app, {
      registry: createWorkflowRegistry(),
      declarativeWorkflowRuntime: runtime as never,
    });

    const response = await app.request(
      "/dashboard/api/declarative-workflows/two-agent-review-round/run",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: { task: "Plan", workspaceId: "ws-1" },
          team: { id: "team-1", agents: [] },
          instanceId: "instance-api",
        }),
      },
    );

    expect(response.status).toBe(202);
    expect(runtime.start).toHaveBeenCalledWith(
      expect.objectContaining({
        input: { task: "Plan", workspaceId: "ws-1" },
        team: { id: "team-1", agents: [] },
        instanceId: "instance-api",
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      result: { instance: { instanceId: "instance-api" } },
    });
  });

  it("starts declarative workflows from a custom definition body when ids match", async () => {
    const runtime = {
      start: vi.fn(async () => ({
        instance: { instanceId: "instance-custom", status: "waiting" },
        queuedSource: { queueItemId: "queue-custom" },
      })),
      runOnce: vi.fn(),
    };
    const app = new Hono();
    registerWorkflowRoutes(app, {
      registry: createWorkflowRegistry(),
      declarativeWorkflowRuntime: runtime as never,
    });
    const definition = customDefinition("custom-review-round");

    const response = await app.request(
      "/dashboard/api/declarative-workflows/custom-review-round/run",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          definition,
          input: { task: "Plan", workspaceId: "ws-1" },
          team: { id: "team-1", agents: [] },
        }),
      },
    );

    expect(response.status).toBe(202);
    expect(runtime.start).toHaveBeenCalledWith(
      expect.objectContaining({
        definition: expect.objectContaining({
          id: "custom-review-round",
          name: "Custom review round",
        }),
      }),
    );
  });

  it("rejects custom declarative definition bodies with a mismatched workflow id", async () => {
    const runtime = { start: vi.fn(), runOnce: vi.fn() };
    const app = new Hono();
    registerWorkflowRoutes(app, {
      registry: createWorkflowRegistry(),
      declarativeWorkflowRuntime: runtime as never,
    });

    const response = await app.request(
      "/dashboard/api/declarative-workflows/requested-id/run",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          definition: customDefinition("other-id"),
          input: { task: "Plan", workspaceId: "ws-1" },
          team: { id: "team-1", agents: [] },
        }),
      },
    );

    expect(response.status).toBe(400);
    expect(runtime.start).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("does not match requested workflow id"),
    });
  });

  it("runs declarative workflows from the DB definition registry when no body definition is supplied", async () => {
    const handle = await initVdDb({ path: ":memory:" });
    dbHandles.push(handle);
    const definitionStore = new DbDeclarativeWorkflowDefinitionStore({
      db: handle.db,
    });
    await definitionStore.saveDefinition({
      definition: customDefinition("db-review-round"),
    });
    const runtime = {
      start: vi.fn(async () => ({
        instance: { instanceId: "instance-db", status: "waiting" },
        queuedSource: { queueItemId: "queue-db" },
      })),
      runOnce: vi.fn(async () => ({
        resumed: [],
        completed: [],
        skipped: [],
        errors: [],
      })),
    };
    const app = new Hono();
    registerWorkflowRoutes(app, {
      registry: createWorkflowRegistry(),
      declarativeWorkflowRuntime: runtime as never,
      declarativeWorkflowDefinitionStore: definitionStore,
    });

    const response = await app.request(
      "/dashboard/api/declarative-workflows/db-review-round/run",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: { task: "Plan", workspaceId: "ws-1" },
          team: { id: "team-1", agents: [] },
        }),
      },
    );

    expect(response.status).toBe(202);
    expect(runtime.start).toHaveBeenCalledWith(
      expect.objectContaining({
        definition: expect.objectContaining({ id: "db-review-round" }),
      }),
    );
  });

  it("exposes declarative workflow definition catalog APIs with built-in fallback and disabled DB definitions", async () => {
    const handle = await initVdDb({ path: ":memory:" });
    dbHandles.push(handle);
    const definitionStore = new DbDeclarativeWorkflowDefinitionStore({
      db: handle.db,
    });
    await definitionStore.saveDefinition({
      definition: customDefinition("catalog-round"),
    });
    const app = new Hono();
    registerWorkflowRoutes(app, {
      registry: createWorkflowRegistry(),
      declarativeWorkflowDefinitionStore: definitionStore,
    });

    const list = await app.request(
      "/dashboard/api/declarative-workflow-definitions",
    );
    expect(list.status).toBe(200);
    await expect(list.json()).resolves.toMatchObject({
      definitions: expect.arrayContaining([
        expect.objectContaining({
          definitionId: "catalog-round",
          source: "db",
          status: "active",
        }),
        expect.objectContaining({
          definitionId: "two-agent-review-round",
          source: "built_in",
          status: "active",
        }),
      ]),
    });

    const get = await app.request(
      "/dashboard/api/declarative-workflow-definitions/catalog-round",
    );
    expect(get.status).toBe(200);
    await expect(get.json()).resolves.toMatchObject({
      definition: {
        definitionId: "catalog-round",
        definition: { id: "catalog-round" },
      },
    });

    const disabled = await app.request(
      "/dashboard/api/declarative-workflow-definitions/catalog-round",
      { method: "DELETE" },
    );
    expect(disabled.status).toBe(200);
    await expect(disabled.json()).resolves.toMatchObject({
      definition: { definitionId: "catalog-round", status: "disabled" },
    });

    const missingDisabled = await app.request(
      "/dashboard/api/declarative-workflow-definitions/catalog-round",
    );
    expect(missingDisabled.status).toBe(404);
    const includeDisabled = await app.request(
      "/dashboard/api/declarative-workflow-definitions/catalog-round?includeDisabled=true",
    );
    expect(includeDisabled.status).toBe(200);
    await expect(includeDisabled.json()).resolves.toMatchObject({
      definition: { status: "disabled" },
    });
  });

  it("runs declarative workflow run-once and exposes instance status details", async () => {
    const handle = await initVdDb({ path: ":memory:" });
    dbHandles.push(handle);
    const store = new DbWorkflowOrchestrationStore({ db: handle.db });
    await store.createInstance({
      instanceId: "instance-status",
      workflowId: "two-agent-review-round",
      trigger: "manual",
    });
    await store.createStepState({
      id: "instance-status_step",
      instanceId: "instance-status",
      stepKey: "resolve_sessions",
    });
    const runtime = {
      start: vi.fn(),
      runOnce: vi.fn(async () => ({
        resumed: [],
        completed: [{ instanceId: "instance-status" }],
        skipped: [],
        errors: [],
      })),
    };
    const app = new Hono();
    registerWorkflowRoutes(app, {
      registry: createWorkflowRegistry(),
      workflowOrchestrationStore: store,
      declarativeWorkflowRuntime: runtime as never,
    });

    const runOnce = await app.request(
      "/dashboard/api/declarative-workflows/two-agent-review-round/run-once",
      { method: "POST" },
    );
    expect(runOnce.status).toBe(200);
    await expect(runOnce.json()).resolves.toMatchObject({
      result: { completed: [{ instanceId: "instance-status" }] },
    });

    const status = await app.request(
      "/dashboard/api/workflow-instances/instance-status/status",
    );
    expect(status.status).toBe(200);
    await expect(status.json()).resolves.toMatchObject({
      instance: { instanceId: "instance-status" },
      steps: [{ stepKey: "resolve_sessions" }],
      triggers: [],
    });
  });

  it("accepts valid VK workflow webhooks, stores inbox refs, and wakes runReady once", async () => {
    const handle = await initVdDb({ path: ":memory:" });
    dbHandles.push(handle);
    const inboxStore = new DbWorkflowWebhookInboxStore({
      db: handle.db,
      createId: () => "inbox-route-1",
      now: () => 10,
    });
    const wakeup = {
      trigger: vi.fn(async () => ({ started: true, queued: false })),
    };
    const app = new Hono();
    registerWorkflowRoutes(app, {
      registry: createWorkflowRegistry(),
      workflowWebhookInboxStore: inboxStore,
      workflowWebhookWakeup: wakeup,
      vkWorkflowWebhookSecret: "secret",
    });
    const body = JSON.stringify(vkWebhookPayload());
    const response = await app.request("/dashboard/api/workflow-webhooks/vk", {
      method: "POST",
      headers: signedVkWebhookHeaders("secret", body),
      body,
    });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      accepted: true,
      duplicate: false,
      wakeup: { started: true },
    });
    expect(wakeup.trigger).toHaveBeenCalledTimes(1);
    const rows = await inboxStore.listEvents();
    expect(rows.events).toHaveLength(1);
    expect(rows.events[0]).toMatchObject({
      inboxId: "inbox-route-1",
      status: "processed",
      executionProcessId: "exec-1",
    });
    expect(JSON.stringify(rows.events[0]?.payload)).not.toContain(
      "full notification message",
    );
  });

  it("TEST_CASE_M98_1B completes generic persisted Dev / Review / Tester runs from VK qa-mode webhook refs", async () => {
    const handle = await initVdDb({ path: ":memory:" });
    dbHandles.push(handle);
    const designStore = new DbWorkflowDesignStore({
      db: handle.db,
      templates: BUILT_IN_WORKFLOW_TEMPLATES,
    });
    await designStore.useTemplate({
      templateId: "built-in/dev-review-tester",
      designId: "design.webhook.drt",
      draftId: "draft.webhook.drt",
    });
    await designStore.publishDraft("draft.webhook.drt");
    const inboxStore = new DbWorkflowWebhookInboxStore({
      db: handle.db,
      createId: (() => {
        let value = 1;
        return () => `inbox-drt-${value++}`;
      })(),
      now: (() => {
        let value = 20_000;
        return () => value++;
      })(),
    });
    const sessions = [
      vkSession("session-dev", "workspace-a", "Dev"),
      vkSession("session-review", "workspace-a", "Review"),
      vkSession("session-tester", "workspace-a", "Tester"),
    ];
    const queued: Array<{ id: string; sessionId: string; prompt: string }> = [];
    const finalResponses: Record<string, string> = {
      "exec-dev-implement-1": "Implemented pass one.",
      "exec-dev-self-1":
        '<decision action="ready_for_review"><summary>Implemented pass one</summary><concerns>Risk noted</concerns></decision>',
      "exec-review-changes":
        '<decision action="changes_requested"><requestedChanges>Fix review issue</requestedChanges><concerns>Concern</concerns></decision>',
      "exec-dev-implement-2": "Implemented review fixes.",
      "exec-dev-self-2":
        '<decision action="ready_for_review"><summary>Fixed review issue</summary></decision>',
      "exec-review-approved-1":
        '<decision action="approved"><remarks>Looks good</remarks></decision>',
      "exec-tester-bug":
        '<decision action="bug_found"><bugReport>Bug found during test</bugReport></decision>',
      "exec-dev-implement-3": "Fixed tester bug.",
      "exec-dev-self-3":
        '<decision action="ready_for_review"><summary>Fixed tester bug</summary></decision>',
      "exec-review-approved-2":
        '<decision action="approved"><remarks>Still good</remarks></decision>',
      "exec-tester-approved":
        '<decision action="approved"><testSummary>Acceptance passed</testSummary></decision>',
    };
    const app = new Hono();
    registerWorkflowRoutes(app, {
      registry: createWorkflowRegistry(),
      workflowHomeDb: handle.db,
      workflowDesignStore: designStore,
      workflowWebhookInboxStore: inboxStore,
      vkWorkflowWebhookSecret: "secret",
      vkClient: {
        getSessions: async (workspaceId) =>
          sessions.filter((session) => session.workspace_id === workspaceId),
        getSession: async (sessionId) =>
          sessions.find((session) => session.id === sessionId) ?? sessions[0]!,
        queueFollowUp: async (sessionId, prompt) => {
          const id = `queue-drt-${queued.length + 1}`;
          queued.push({ id, sessionId, prompt });
          return {
            queued_item: {
              id,
              session_id: sessionId,
              workspace_id: "workspace-a",
              status: "queued",
              source: "workflow",
              priority: 0,
              data: { message: prompt },
            },
            status: {
              count: queued.length,
              message: null,
              messages: [],
              status: "queued",
            },
          };
        },
        getExecutionProcessFinalMessage: async (executionProcessId) => ({
          execution_process_id: executionProcessId,
          session_id: "session-from-execution",
          workspace_id: "workspace-a",
          status: "completed",
          completed_at: "2026-08-11T00:00:00.000Z",
          coding_agent_turn_id: null,
          agent_session_id: null,
          agent_message_id: null,
          content: finalResponses[executionProcessId] ?? null,
          truncated: false,
          max_chars: 20_000,
          source_kind: "coding_agent_turn_summary",
          prompt_preview: null,
          prompt_truncated: false,
          prompt_max_chars: 0,
          prompt_source_kind: "coding_agent_turn_prompt",
        }),
      },
    });

    const launched = await app.request("/dashboard/api/workflows/launch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace-a",
        designId: "design.webhook.drt",
        inputs: { featureRequest: "Build a generic persisted DRT workflow" },
        roleBindings: {
          dev: { mode: "existing", sessionId: "session-dev" },
          review: { mode: "existing", sessionId: "session-review" },
          tester: { mode: "existing", sessionId: "session-tester" },
        },
      }),
    });
    expect(launched.status).toBe(201);
    const launchedJson = (await launched.json()) as { run: { runId: string } };

    async function postWebhook(queueIndex: number, executionId: string) {
      const queuedTurn = queued[queueIndex];
      expect(queuedTurn).toBeTruthy();
      const body = JSON.stringify(
        vkWebhookPayload({
          delivery_id: `delivery-${executionId}`,
          workspace_id: "workspace-a",
          session_id: queuedTurn!.sessionId,
          execution_id: executionId,
          queue_item_id: queuedTurn!.id,
        }),
      );
      const response = await app.request(
        "/dashboard/api/workflow-webhooks/vk",
        {
          method: "POST",
          headers: signedVkWebhookHeaders("secret", body),
          body,
        },
      );
      expect(response.status).toBe(202);
      const payload = (await response.json()) as {
        persistedWorkflow: {
          applied: boolean;
          reason: string;
          status: string | null;
        };
      };
      expect(payload.persistedWorkflow).toMatchObject({
        applied: true,
        reason: "applied",
      });
      return payload;
    }

    const earlySelfReviewBody = JSON.stringify(
      vkWebhookPayload({
        delivery_id: "delivery-exec-dev-self-1-early",
        workspace_id: "workspace-a",
        session_id: "session-dev",
        execution_id: "exec-dev-self-1",
        queue_item_id: "queue-drt-2",
      }),
    );
    const earlySelfReview = await app.request(
      "/dashboard/api/workflow-webhooks/vk",
      {
        method: "POST",
        headers: signedVkWebhookHeaders("secret", earlySelfReviewBody),
        body: earlySelfReviewBody,
      },
    );
    expect(earlySelfReview.status).toBe(202);
    await expect(earlySelfReview.json()).resolves.toMatchObject({
      persistedWorkflow: {
        applied: false,
        reason: "not_persisted_workflow_turn",
      },
    });

    await postWebhook(0, "exec-dev-implement-1");
    expect(queued[1]).toMatchObject({ sessionId: "session-dev" });
    expect(queued[2]).toMatchObject({ sessionId: "session-review" });
    await postWebhook(2, "exec-review-changes");
    expect(queued[3]).toMatchObject({ sessionId: "session-dev" });
    await postWebhook(3, "exec-dev-implement-2");
    await postWebhook(4, "exec-dev-self-2");
    await postWebhook(5, "exec-review-approved-1");
    expect(queued[6]).toMatchObject({ sessionId: "session-tester" });
    await postWebhook(6, "exec-tester-bug");
    expect(queued[7]).toMatchObject({ sessionId: "session-dev" });
    await postWebhook(7, "exec-dev-implement-3");
    await postWebhook(8, "exec-dev-self-3");
    await postWebhook(9, "exec-review-approved-2");
    const finished = await postWebhook(10, "exec-tester-approved");
    expect(finished.persistedWorkflow).toMatchObject({ status: "completed" });

    const runRow = await handle.db
      .selectFrom("WorkflowPersistedRun")
      .selectAll()
      .where("runId", "=", launchedJson.run.runId)
      .executeTakeFirstOrThrow();
    expect(runRow.status).toBe("completed");
    expect(
      JSON.parse(runRow.eventsJson).filter(
        (entry: any) => entry.kind === "agent_turn_observed",
      ),
    ).toHaveLength(11);
    const presentation = await app.request(
      `/dashboard/api/workflow-instances/${launchedJson.run.runId}/presentation`,
    );
    expect(presentation.status).toBe(200);
    const presentationJson = (await presentation.json()) as {
      presentation: any;
    };
    expect(presentationJson.presentation).toMatchObject({
      workflowName: "Dev / Review / Tester",
      status: "completed",
    });
    expect(
      presentationJson.presentation.timeline
        .filter((item: any) => item.kind === "agent_turn")
        .map((item: any) => item.role),
    ).toEqual([
      "Dev",
      "Dev",
      "Review",
      "Dev",
      "Dev",
      "Review",
      "Tester",
      "Dev",
      "Dev",
      "Review",
      "Tester",
    ]);
    expect(
      presentationJson.presentation.timeline.map((item: any) => item.kind),
    ).toEqual(expect.arrayContaining(["decision"]));
    expect(
      presentationJson.presentation.timeline.at(-1).finalResponse.text,
    ).toContain("Acceptance passed");
  });

  it("accepts execution.killed VK workflow webhooks and stores killed status", async () => {
    const handle = await initVdDb({ path: ":memory:" });
    dbHandles.push(handle);
    const inboxStore = new DbWorkflowWebhookInboxStore({
      db: handle.db,
      createId: () => "inbox-route-killed",
      now: () => 12,
    });
    const wakeup = {
      trigger: vi.fn(async () => ({ started: true, queued: false })),
    };
    const app = new Hono();
    registerWorkflowRoutes(app, {
      registry: createWorkflowRegistry(),
      workflowWebhookInboxStore: inboxStore,
      workflowWebhookWakeup: wakeup,
      vkWorkflowWebhookSecret: "secret",
    });
    const body = JSON.stringify(
      vkWebhookPayload({
        event_type: "execution.killed",
        delivery_id: "delivery-route-killed",
      }),
    );
    const response = await app.request("/dashboard/api/workflow-webhooks/vk", {
      method: "POST",
      headers: signedVkWebhookHeaders("secret", body),
      body,
    });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      accepted: true,
      duplicate: false,
      inbox: {
        status: "processed",
        eventType: "execution.killed",
        eventStatus: "killed",
      },
    });
    expect(wakeup.trigger).toHaveBeenCalledTimes(1);
  });

  it("coalesces overlapping non-duplicate VK webhook wakeups into a follow-up runReady pass", async () => {
    const handle = await initVdDb({ path: ":memory:" });
    dbHandles.push(handle);
    let id = 0;
    const inboxStore = new DbWorkflowWebhookInboxStore({
      db: handle.db,
      createId: () => `inbox-route-overlap-${++id}`,
      now: () => 20 + id,
    });
    const releases: Array<() => void> = [];
    const runReady = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        releases.push(resolve);
      });
    });
    const wakeup = new WorkflowWebhookWakeup(runReady);
    const app = new Hono();
    registerWorkflowRoutes(app, {
      registry: createWorkflowRegistry(),
      workflowWebhookInboxStore: inboxStore,
      workflowWebhookWakeup: wakeup,
      vkWorkflowWebhookSecret: "secret",
    });
    const bodyA = JSON.stringify(
      vkWebhookPayload({
        delivery_id: "delivery-route-overlap-a",
        execution_id: "exec-overlap-a",
      }),
    );
    const bodyB = JSON.stringify(
      vkWebhookPayload({
        delivery_id: "delivery-route-overlap-b",
        execution_id: "exec-overlap-b",
      }),
    );

    const first = app.request("/dashboard/api/workflow-webhooks/vk", {
      method: "POST",
      headers: signedVkWebhookHeaders("secret", bodyA),
      body: bodyA,
    });
    await waitUntil(() => releases.length === 1);
    const second = await app.request("/dashboard/api/workflow-webhooks/vk", {
      method: "POST",
      headers: signedVkWebhookHeaders("secret", bodyB),
      body: bodyB,
    });

    expect(second.status).toBe(202);
    await expect(second.json()).resolves.toMatchObject({
      accepted: true,
      duplicate: false,
      wakeup: { started: false, queued: true },
    });
    expect(runReady).toHaveBeenCalledTimes(1);

    releases[0]!();
    await waitUntil(() => releases.length === 2);
    expect(runReady).toHaveBeenCalledTimes(2);
    releases[1]!();
    const firstResponse = await first;
    expect(firstResponse.status).toBe(202);
    await expect(firstResponse.json()).resolves.toMatchObject({
      accepted: true,
      duplicate: false,
      wakeup: { started: true, queued: false, passes: 2 },
    });

    await expect(inboxStore.listEvents({ limit: 10 })).resolves.toMatchObject({
      events: [
        expect.objectContaining({
          deliveryId: "delivery-route-overlap-b",
          status: "processed",
        }),
        expect.objectContaining({
          deliveryId: "delivery-route-overlap-a",
          status: "processed",
        }),
      ],
    });
  });

  it("acknowledges duplicate valid VK workflow webhooks without duplicate wakeups", async () => {
    const handle = await initVdDb({ path: ":memory:" });
    dbHandles.push(handle);
    let id = 0;
    const inboxStore = new DbWorkflowWebhookInboxStore({
      db: handle.db,
      createId: () => `inbox-route-${++id}`,
      now: () => 10 + id,
    });
    const wakeup = {
      trigger: vi.fn(async () => ({ started: true, queued: false })),
    };
    const app = new Hono();
    registerWorkflowRoutes(app, {
      registry: createWorkflowRegistry(),
      workflowWebhookInboxStore: inboxStore,
      workflowWebhookWakeup: wakeup,
      vkWorkflowWebhookSecret: "secret",
    });
    const body = JSON.stringify(vkWebhookPayload());
    const headers = signedVkWebhookHeaders("secret", body);

    const first = await app.request("/dashboard/api/workflow-webhooks/vk", {
      method: "POST",
      headers,
      body,
    });
    const second = await app.request("/dashboard/api/workflow-webhooks/vk", {
      method: "POST",
      headers,
      body,
    });

    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    await expect(second.json()).resolves.toMatchObject({
      accepted: true,
      duplicate: true,
    });
    expect(wakeup.trigger).toHaveBeenCalledTimes(1);
    await expect(inboxStore.listEvents()).resolves.toMatchObject({
      events: [expect.objectContaining({ inboxId: "inbox-route-1" })],
    });
  });

  it("uses provisioned VK webhook secret when no env override is configured", async () => {
    const handle = await initVdDb({ path: ":memory:" });
    dbHandles.push(handle);
    const inboxStore = new DbWorkflowWebhookInboxStore({
      db: handle.db,
      createId: () => "inbox-provisioned-secret",
      now: () => 40,
    });
    const provisioningStore = new DbWorkflowWebhookProvisioningStore({
      db: handle.db,
      createSecret: () => "provisioned-secret",
      now: () => 30,
    });
    await provisioningStore.ensureState({
      upsertKey: "vd.workflow_wakeups.v1",
      targetUrl: "http://127.0.0.1:3109/dashboard/api/workflow-webhooks/vk",
    });
    const wakeup = {
      trigger: vi.fn(async () => ({ started: true, queued: false })),
    };
    const app = new Hono();
    registerWorkflowRoutes(app, {
      registry: createWorkflowRegistry(),
      workflowWebhookInboxStore: inboxStore,
      workflowWebhookProvisioningStore: provisioningStore,
      workflowWebhookWakeup: wakeup,
    });
    const body = JSON.stringify(
      vkWebhookPayload({ delivery_id: "delivery-provisioned-secret" }),
    );

    const response = await app.request("/dashboard/api/workflow-webhooks/vk", {
      method: "POST",
      headers: signedVkWebhookHeaders("provisioned-secret", body),
      body,
    });

    expect(response.status).toBe(202);
    expect(wakeup.trigger).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toMatchObject({
      accepted: true,
      inbox: { inboxId: "inbox-provisioned-secret" },
    });
  });

  it("exposes redacted VK workflow webhook provisioning status", async () => {
    const handle = await initVdDb({ path: ":memory:" });
    dbHandles.push(handle);
    const provisioningStore = new DbWorkflowWebhookProvisioningStore({
      db: handle.db,
      createSecret: () => "do-not-leak",
      now: () => 50,
    });
    await provisioningStore.ensureState({
      upsertKey: "vd.workflow_wakeups.v1",
      targetUrl: "http://127.0.0.1:3109/dashboard/api/workflow-webhooks/vk",
    });
    const app = new Hono();
    registerWorkflowRoutes(app, {
      registry: createWorkflowRegistry(),
      workflowWebhookProvisioningStore: provisioningStore,
    });

    const response = await app.request(
      "/dashboard/api/workflow-webhooks/provisioning",
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toMatchObject({
      state: { secretSet: true, upsertKey: "vd.workflow_wakeups.v1" },
    });
    expect(JSON.stringify(json)).not.toContain("do-not-leak");
    expect(JSON.stringify(json)).not.toContain('secret":"');
  });

  it("rejects invalid VK webhook signatures without storing or waking", async () => {
    const handle = await initVdDb({ path: ":memory:" });
    dbHandles.push(handle);
    const inboxStore = new DbWorkflowWebhookInboxStore({ db: handle.db });
    const wakeup = {
      trigger: vi.fn(async () => ({ started: true, queued: false })),
    };
    const app = new Hono();
    registerWorkflowRoutes(app, {
      registry: createWorkflowRegistry(),
      workflowWebhookInboxStore: inboxStore,
      workflowWebhookWakeup: wakeup,
      vkWorkflowWebhookSecret: "secret",
    });
    const body = JSON.stringify(vkWebhookPayload());
    const response = await app.request("/dashboard/api/workflow-webhooks/vk", {
      method: "POST",
      headers: {
        ...signedVkWebhookHeaders("wrong", body),
        "Content-Type": "application/json",
      },
      body,
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: "invalid_vk_workflow_webhook_signature",
    });
    expect(wakeup.trigger).not.toHaveBeenCalled();
    await expect(inboxStore.listEvents()).resolves.toMatchObject({
      events: [],
    });
  });
});

function customDefinition(id: string) {
  return {
    id,
    version: 1,
    name: "Custom review round",
    trigger: "manual",
    inputs: {
      task: { type: "string", required: true },
      workspaceId: { type: "string", required: true },
      sourceSessionId: { type: "string", required: false },
      reviewSessionId: { type: "string", required: false },
      overseerSessionId: { type: "string", required: false },
    },
    policies: { refsOnlyStorage: true },
    steps: [
      {
        id: "resolve_custom",
        type: "resolve_roles",
        workspaceInput: "workspaceId",
        roles: [
          {
            key: "source",
            sessionInput: "sourceSessionId",
            defaultRole: "implementer",
          },
          {
            key: "review",
            sessionInput: "reviewSessionId",
            defaultRole: "reviewer",
          },
        ],
      },
      {
        id: "ask_custom_source",
        type: "queue_prompt",
        target: "source",
        template: "{{inputs.task}}",
      },
      {
        id: "wait_custom_source",
        type: "wait_for_next_completed_response",
        target: "source",
        after: "ask_custom_source",
      },
      {
        id: "ask_custom_review",
        type: "pipe_response",
        source: "wait_custom_source",
        target: "review",
        template: "Review: {{source.response}}",
      },
      {
        id: "wait_custom_review",
        type: "wait_for_next_completed_response",
        target: "review",
        after: "ask_custom_review",
      },
      {
        id: "notify_custom_overseer",
        type: "notify_overseer",
        sessionInput: "overseerSessionId",
        template: "Review: {{responses.wait_custom_review}}",
      },
      {
        id: "complete_custom",
        type: "complete",
        summaryTemplate: "Done {{inputs.task}}",
      },
    ],
    outputs: {},
  };
}

function vkWebhookPayload(overrides: Record<string, unknown> = {}) {
  return {
    event_type: "execution.completed",
    delivery_id: "delivery-route-1",
    timestamp: "2026-08-08T00:00:00.000Z",
    workspace_id: "ws-1",
    session_id: "session-1",
    execution_id: "exec-1",
    queue_item_id: "queue-1",
    message: "full notification message should not be persisted",
    ...overrides,
  };
}

function signedVkWebhookHeaders(
  secret: string,
  body: string,
): Record<string, string> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  return {
    "Content-Type": "application/json",
    "X-VK-Webhook-Timestamp": timestamp,
    "X-VK-Webhook-Algorithm": "hmac-sha256",
    "X-VK-Webhook-Signature": signVkWebhookPayload(secret, timestamp, body),
  };
}

function routeValidDefinition() {
  return {
    schemaVersion: 1,
    name: "Home Workflow",
    roles: { dev: { label: "Dev" } },
    initialState: "dev",
    states: {
      dev: {
        owner: "dev",
        steps: [
          {
            id: "decide",
            type: "agent_turn",
            turnType: "decision",
            prompt: { template: "Decide" },
            response: {
              format: "xml",
              schema: { format: "xsd", source: "state_actions" },
              invalidXmlRetry: {
                maxAttempts: 1,
                prompt: "engine_default_with_validation_errors",
                onExhausted: "blocked",
              },
              storeRawXml: true,
              storeParsedFields: true,
              unknownFields: "reject_unless_allowed_by_result_contract",
            },
          },
        ],
        actions: {
          done: {
            targetState: "done",
            result: { fields: { summary: { type: "markdown" } }, required: ["summary"] },
          },
        },
      },
      done: { terminal: true },
    },
  };
}

function routeLaunchDefinition() {
  return {
    schemaVersion: 1,
    name: "Launch Workflow",
    inputs: {
      featureRequest: {
        type: "markdown",
        required: true,
        description: "What should the workflow do?",
      },
    },
    roles: { dev: { label: "Dev" }, review: { label: "Review" } },
    initialState: "dev",
    states: {
      dev: {
        owner: "dev",
        steps: [
          {
            id: "decide",
            type: "agent_turn",
            turnType: "decision",
            prompt: { template: "Decide {{inputs.featureRequest}}" },
            response: {
              format: "xml",
              schema: { format: "xsd", source: "state_actions" },
              invalidXmlRetry: {
                maxAttempts: 1,
                prompt: "engine_default_with_validation_errors",
                onExhausted: "blocked",
              },
              storeRawXml: true,
              storeParsedFields: true,
              unknownFields: "reject_unless_allowed_by_result_contract",
            },
          },
        ],
        actions: { done: { targetState: "done" } },
      },
      done: { terminal: true },
    },
  };
}

function routeCommandDefinition(options: { provider: string; command: string }) {
  return {
    schemaVersion: 1,
    name: "Command Workflow",
    roles: { dev: { label: "Dev" } },
    initialState: "inspect",
    states: {
      inspect: {
        owner: "dev",
        steps: [
          {
            id: "collect_status",
            type: "command",
            provider: options.provider,
            command: options.command,
            args: { includeDiffSummary: true },
            policy: {
              access: "read",
              cwd: { mode: "workspace_root" },
              timeoutMs: 10_000,
              output: { stdoutMaxChars: 64, stderrMaxChars: 64, combinedMaxChars: 4_096 },
            },
          },
          {
            id: "decide",
            type: "agent_turn",
            turnType: "decision",
            prompt: { template: "Review command result." },
            response: {
              format: "xml",
              schema: { format: "xsd", source: "state_actions" },
              invalidXmlRetry: {
                maxAttempts: 1,
                prompt: "engine_default_with_validation_errors",
                onExhausted: "blocked",
              },
              storeRawXml: true,
              storeParsedFields: true,
              unknownFields: "reject_unless_allowed_by_result_contract",
            },
          },
        ],
        actions: { done: { targetState: "done" } },
      },
      done: { terminal: true },
    },
  };
}

function routeHumanFormDefinition() {
  return {
    schemaVersion: 1,
    name: "Human Route Workflow",
    roles: { dev: { label: "Dev" } },
    initialState: "human",
    states: {
      human: {
        owner: "dev",
        steps: [
          {
            id: "approval",
            type: "human_form",
            title: "Approve plan",
            form: {
              providerType: "beads_form",
              formSchema: { fields: { approved: { required: true } } },
            },
          },
          {
            id: "continue",
            type: "agent_turn",
            turnType: "decision",
            prompt: { template: "Approved: {{human.approval.approved}}" },
            response: {
              format: "xml",
              schema: { format: "xsd", source: "state_actions" },
              invalidXmlRetry: {
                maxAttempts: 1,
                prompt: "engine_default_with_validation_errors",
                onExhausted: "blocked",
              },
              storeRawXml: true,
              storeParsedFields: true,
              unknownFields: "reject_unless_allowed_by_result_contract",
            },
          },
        ],
        actions: { done: { targetState: "done" } },
      },
      done: { terminal: true },
    },
  };
}

function vkSession(
  id: string,
  workspaceId: string,
  name: string | null,
): Session {
  return {
    id,
    workspace_id: workspaceId,
    executor: "CODEX" as const,
    name,
    created_at: "2026-08-11T00:00:00.000Z",
    updated_at: "2026-08-11T00:00:00.000Z",
  };
}

async function expectJson(
  app: Hono,
  path: string,
  status: number,
  expected: unknown,
): Promise<void> {
  const response = await app.request(path);
  expect(response.status).toBe(status);
  await expect(response.json()).resolves.toEqual(expected);
}

function signBody(body: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("condition not met");
}

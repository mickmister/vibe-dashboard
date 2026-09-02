import type { Hono } from "hono";
import {
  GasCityE2eFixtureStore,
  loadGasCityE2eFixtureConfigFromFile,
  type GasCityE2eFixtureConfig,
  type GasCityE2eFixtureEventInput,
} from "../modules/plugins/workflows/server/gasCityE2eFixture";
import {
  FakeGasCityWorkflowProvider,
  sanitizeGasCityProviderText,
  type GasCityProviderFormulaChoice,
  type GasCityWorkflowProvider,
} from "../modules/plugins/workflows/server/gasCityWorkflowProvider";
import type {
  WorkspaceGasCityWorkflowEngineModel,
  WorkspaceWorkflowsHomeModel,
} from "../modules/plugins/workflows/server/workflowsHomeReadModel";
import type { QueueFollowUpResponse, Session, VibeKanbanServerClient } from "./vk-client";

export interface RegisterGasCityE2eFixtureRoutesOptions {
  fixture?: GasCityE2eFixtureStore;
  gasCityProvider?: GasCityWorkflowProvider;
  enabled?: boolean;
  fixtureFile?: string | null;
  buildHome?: (workspaceId: string) => Promise<WorkspaceWorkflowsHomeModel>;
  vkClient?: GasCityE2eVkClient;
}

type GasCityE2eVkClient = Pick<
  VibeKanbanServerClient,
  "getSessions" | "createSession" | "queueFollowUp"
>;

interface GasCityE2eAgentMessage {
  status: "sent" | "unavailable" | "failed";
  sessionId: string | null;
  sessionName: string | null;
  summary: string;
}

let sharedFixture: GasCityE2eFixtureStore | null = null;
let sharedGasCityProvider: GasCityWorkflowProvider | null = null;
const firstAgentMessagesByKey = new Map<string, GasCityE2eAgentMessage>();
const advancementMessagesByKey = new Map<string, GasCityE2eAgentMessage>();

const defaultTarget = "worker";
const defaultFormula: GasCityProviderFormulaChoice = {
  formula: "dev-review-test",
  label: "Dev Review Test",
  contract: "graph.v2",
  description: "Task-backed workflow recipe for deterministic E2E orchestration.",
};

export function shouldRegisterGasCityE2eFixtureRoutes(): boolean {
  return process.env.VD_GAS_CITY_E2E_FIXTURE === "1";
}

export function registerGasCityE2eFixtureRoutes(
  hono: Hono,
  options: RegisterGasCityE2eFixtureRoutesOptions = {},
): void {
  const enabled = options.enabled ?? shouldRegisterGasCityE2eFixtureRoutes();
  if (!enabled) return;
  const fixture =
    options.fixture ??
    getSharedGasCityE2eFixture(
      options.fixtureFile ?? process.env.VD_GAS_CITY_E2E_FIXTURE_FILE ?? null,
    );
  const gasCityProvider = options.gasCityProvider ?? getSharedGasCityE2eWorkflowProvider();
  const vkClient = options.vkClient ?? null;

  hono.get("/dashboard/api/workflows/gas-city-e2e-fixture", (c) =>
    c.json({ ok: true, state: fixture.snapshot() }),
  );

  hono.post("/dashboard/api/workflows/gas-city-e2e-fixture/reset", async (c) => {
    const body = await safeJson<Partial<GasCityE2eFixtureConfig>>(c);
    const config = normalizeConfig(
      body,
      options.fixtureFile ?? process.env.VD_GAS_CITY_E2E_FIXTURE_FILE ?? null,
    );
    firstAgentMessagesByKey.clear();
    advancementMessagesByKey.clear();
    return c.json({ ok: true, state: fixture.reset(config) });
  });

  hono.post("/dashboard/api/workflows/gas-city-e2e-fixture/events", async (c) => {
    const body = await safeJson<Partial<GasCityE2eFixtureEventInput>>(c);
    const result = fixture.applyEvent({
      eventId: typeof body.eventId === "string" ? body.eventId : "",
      type:
        typeof body.type === "string"
          ? (body.type as GasCityE2eFixtureEventInput["type"])
          : "record_agent_result_note",
      workspaceId:
        typeof body.workspaceId === "string"
          ? body.workspaceId
          : fixture.snapshot().fixture.workspaceId,
      beadId: typeof body.beadId === "string" ? body.beadId : null,
      title: typeof body.title === "string" ? body.title : null,
      summary: typeof body.summary === "string" ? body.summary : null,
      metadata:
        body.metadata && typeof body.metadata === "object"
          ? (body.metadata as GasCityE2eFixtureEventInput["metadata"])
          : null,
    });
    if (result.status === "conflict") {
      return c.json({ ok: false, result }, 409);
    }
    const advancement = await routeAdvancementMessage({
      vkClient,
      event: {
        eventId: typeof body.eventId === "string" ? body.eventId : "",
        type:
          typeof body.type === "string"
            ? (body.type as GasCityE2eFixtureEventInput["type"])
            : "record_agent_result_note",
        workspaceId:
          typeof body.workspaceId === "string"
            ? body.workspaceId
            : fixture.snapshot().fixture.workspaceId,
        beadId: typeof body.beadId === "string" ? body.beadId : null,
        title: typeof body.title === "string" ? body.title : null,
      },
      shouldRoute: result.status === "applied",
    });
    return c.json({ ok: true, result, advancement });
  });

  hono.post("/dashboard/api/workflows/gas-city-e2e-fixture/launch", async (c) => {
    const body = await safeJson<Record<string, unknown>>(c);
    const workspaceId = safeId(
      typeof body.workspaceId === "string"
        ? body.workspaceId
        : fixture.snapshot().fixture.workspaceId,
    );
    const sourceBeadId = safeId(typeof body.sourceBeadId === "string" ? body.sourceBeadId : "");
    const target = safeId(typeof body.target === "string" ? body.target : defaultTarget);
    const formula = safeId(typeof body.formula === "string" ? body.formula : defaultFormula.formula);
    const idempotencyKey = safeId(
      typeof body.idempotencyKey === "string"
        ? body.idempotencyKey
        : `gas-city-e2e-${workspaceId}-${sourceBeadId}-${formula}`,
    );

    const beads = await fixture.getBeadsByIds({ workspaceId, beadIds: [sourceBeadId] });
    const bead = beads[0] ?? null;
    if (!workspaceId || !sourceBeadId || !bead) {
      return c.json(
        {
          ok: false,
          error: "source_bead_unavailable",
          message: "Choose an available task before starting workflow work.",
        },
        400,
      );
    }
    if (bead.readiness !== "ready") {
      return c.json(
        {
          ok: false,
          error: "source_bead_not_ready",
          message: "This task is not ready for workflow work yet.",
        },
        400,
      );
    }

    const launch = await gasCityProvider.launchSourceWorkflow({
      context: { workspaceId, currentBeadIds: [sourceBeadId] },
      sourceBeadId,
      target,
      formula,
      idempotencyKey,
    });
    if (launch.status === "blocked") {
      return c.json(
        {
          ok: false,
          error: "gas_city_launch_blocked",
          message: launch.summary,
          launch,
        },
        400,
      );
    }
    await fixture.upsertWorkflowLinkage?.({
      workspaceId,
      beadId: sourceBeadId,
      workflow: {
        workflowId: launch.workflowRef.workflowId ?? `workflow-${sourceBeadId}`,
        rootBeadId: launch.workflowRef.rootBeadId ?? `root-${sourceBeadId}`,
        formula: launch.workflowRef.formula,
        target: launch.workflowRef.target,
        status: "running",
      },
      idempotencyKey,
    });
    const workflow = await gasCityProvider.getWorkflow(launch.workflowRef);
    const firstAgentMessage =
      launch.status === "accepted" || firstAgentMessagesByKey.has(idempotencyKey)
        ? await routeFirstAgentMessage({
            vkClient,
            cacheKey: idempotencyKey,
            workspaceId,
            sourceBeadId,
            sourceBeadTitle: bead.title,
            target,
            launch,
          })
        : alreadyRoutedFirstAgentMessage();
    const home = options.buildHome ? await options.buildHome(workspaceId) : undefined;
    return c.json(
      { ok: true, launch, workflow, firstAgentMessage, home },
      launch.status === "accepted" ? 201 : 200,
    );
  });
}

export function getSharedGasCityE2eFixture(fixtureFile?: string | null): GasCityE2eFixtureStore {
  if (!sharedFixture) {
    sharedFixture = new GasCityE2eFixtureStore(normalizeConfig({}, fixtureFile ?? null));
  }
  return sharedFixture;
}

export function getSharedGasCityE2eWorkflowProvider(): GasCityWorkflowProvider {
  if (!sharedGasCityProvider) {
    sharedGasCityProvider = new FakeGasCityWorkflowProvider({
      version: "1.4.1",
      targets: [{ target: defaultTarget, label: "Worker" }],
      formulas: [defaultFormula],
    });
  }
  return sharedGasCityProvider;
}

export function buildGasCityE2eEngineHomeModel(
  workspaceId: string | null,
  fixture = getSharedGasCityE2eFixture(
    process.env.VD_GAS_CITY_E2E_FIXTURE_FILE ?? null,
  ),
): WorkspaceGasCityWorkflowEngineModel {
  if (!workspaceId) {
    return {
      health: { status: "unconfigured", summary: "Choose a workspace before starting task-backed workflow work.", version: null, checkedAt: Date.now(), warnings: [] },
      recipes: [],
      launch: { enabled: false, summary: "Choose a workspace before starting task-backed workflow work." },
      diagnosticsRef: null,
    };
  }
  const snapshot = fixture.snapshot();
  const bead = snapshot.beads.find((candidate) => candidate.workspaceId === workspaceId && candidate.readiness === "ready") ?? snapshot.beads.find((candidate) => candidate.workspaceId === workspaceId) ?? null;
  const providerAvailable = snapshot.fixture.providerAvailable;
  return {
    health: {
      status: providerAvailable ? "healthy" : "unavailable",
      summary: providerAvailable ? "Workflow orchestration is available for task-backed work." : "Workflow orchestration is unavailable for this workspace.",
      version: "1.4.1",
      checkedAt: snapshot.fixture.generatedAt,
      warnings: snapshot.warnings,
    },
    recipes: [{ id: defaultFormula.formula, name: "Dev Review Test recipe", summary: "Generated recipe available for deterministic task-backed workflow testing.", sourceWorkflow: "Dev Review Test", status: providerAvailable ? "ready" : "unavailable" }],
    launch: {
      enabled: Boolean(providerAvailable && bead?.readiness === "ready"),
      sourceBeadId: bead?.id ?? null,
      target: defaultTarget,
      recipeId: defaultFormula.formula,
      summary: bead?.readiness === "ready" ? `Ready to start task-backed workflow work for ${sanitizeGasCityProviderText(bead.title, bead.id)}.` : "Mark a task ready before starting task-backed workflow work.",
    },
    diagnosticsRef: "gas-city-e2e-fixture",
  };
}

async function routeAdvancementMessage(args: {
  vkClient: GasCityE2eVkClient | null;
  event: {
    eventId: string;
    type: GasCityE2eFixtureEventInput["type"];
    workspaceId: string;
    beadId: string | null;
    title: string | null;
  };
  shouldRoute: boolean;
}): Promise<GasCityE2eAgentMessage | null> {
  if (args.event.type !== "record_agent_result_note" || !args.event.beadId) {
    return null;
  }
  const cacheKey = safeId(
    `gcw14e-${args.event.workspaceId}-${args.event.beadId}-${args.event.eventId}-review`,
  );
  const cached = advancementMessagesByKey.get(cacheKey);
  if (cached) return cached;
  if (!args.shouldRoute) return null;
  const result = await routeWorkflowAgentMessage({
    cache: advancementMessagesByKey,
    cacheKey,
    vkClient: args.vkClient,
    workspaceId: safeId(args.event.workspaceId),
    sourceBeadId: safeId(args.event.beadId),
    sourceBeadTitle: args.event.title ?? args.event.beadId,
    target: "reviewer",
    sessionName: nextAgentSessionName(args.event.beadId),
    marker: "GCW14E_STEP:review_agent_message",
    heading: "Task-backed workflow advanced to review.",
    instruction:
      "Review the completed first workflow turn using the task context above. Respond with concise review findings for the next workflow step.",
    workflowRunId: cacheKey,
  });
  return result;
}

async function routeWorkflowAgentMessage(args: {
  cache: Map<string, GasCityE2eAgentMessage>;
  cacheKey: string;
  vkClient: GasCityE2eVkClient | null;
  workspaceId: string;
  sourceBeadId: string;
  sourceBeadTitle: string;
  target: string;
  sessionName: string;
  marker: string;
  heading: string;
  instruction: string;
  workflowRunId: string;
}): Promise<GasCityE2eAgentMessage> {
  const cached = args.cache.get(args.cacheKey);
  if (cached) return cached;
  if (!args.vkClient) {
    return {
      status: "unavailable",
      sessionId: null,
      sessionName: null,
      summary: "Agent message delivery is unavailable in this test environment.",
    };
  }

  try {
    const sessions = await args.vkClient.getSessions(args.workspaceId);
    const session =
      sessions.find((candidate) => candidate.name === args.sessionName) ??
      (await args.vkClient.createSession({
        workspace_id: args.workspaceId,
        executor: "CODEX",
        name: args.sessionName,
      }));
    const prompt = buildAgentPrompt({
      sourceBeadId: args.sourceBeadId,
      sourceBeadTitle: args.sourceBeadTitle,
      target: args.target,
      marker: args.marker,
      heading: args.heading,
      instruction: args.instruction,
    });
    const queued = await args.vkClient.queueFollowUp(session.id, prompt, {
      source: "workflow",
      provenance: {
        kind: "workflow",
        label: "Task-backed workflow",
        workflow_run_id: args.workflowRunId,
        workflow_name: "Dev Review Test",
        workflow_role_id: args.target,
      },
    });
    const routed = agentMessageReadModel(session, queued);
    args.cache.set(args.cacheKey, routed);
    return routed;
  } catch {
    return {
      status: "failed",
      sessionId: null,
      sessionName: null,
      summary: "Agent message could not be sent. Try again after checking the workspace session.",
    };
  }
}

async function routeFirstAgentMessage(args: {
  vkClient: GasCityE2eVkClient | null;
  cacheKey: string;
  workspaceId: string;
  sourceBeadId: string;
  sourceBeadTitle: string;
  target: string;
  launch: Awaited<ReturnType<GasCityWorkflowProvider["launchSourceWorkflow"]>>;
}): Promise<GasCityE2eAgentMessage> {
  return routeWorkflowAgentMessage({
    cache: firstAgentMessagesByKey,
    cacheKey: args.cacheKey,
    vkClient: args.vkClient,
    workspaceId: args.workspaceId,
    sourceBeadId: args.sourceBeadId,
    sourceBeadTitle: args.sourceBeadTitle,
    target: args.target,
    sessionName: firstAgentSessionName(args.sourceBeadId),
    marker: "GCW14D_STEP:first_agent_message",
    heading: "Task-backed workflow routed its first agent turn.",
    instruction:
      "Use the task context above and any explicitly available typed task tools to inspect more details when needed. Begin the first workflow turn and respond with a concise progress note.",
    workflowRunId: args.launch.workflowRef.workflowId ?? args.cacheKey,
  });
}

function agentMessageReadModel(
  session: Session,
  _queued: QueueFollowUpResponse,
): GasCityE2eAgentMessage {
  return {
    status: "sent",
    sessionId: session.id,
    sessionName: session.name ?? "Task workflow agent",
    summary: "First agent message sent to the workspace session.",
  };
}

function firstAgentSessionName(sourceBeadId: string): string {
  return sanitizeGasCityProviderText(`Task workflow ${sourceBeadId}`, "Task workflow");
}

function nextAgentSessionName(sourceBeadId: string): string {
  return sanitizeGasCityProviderText(
    `Task workflow review ${sourceBeadId}`,
    "Task workflow review",
  );
}

function buildAgentPrompt(input: {
  sourceBeadId: string;
  sourceBeadTitle: string;
  target: string;
  marker: string;
  heading: string;
  instruction: string;
}): string {
  const beadId = safeId(input.sourceBeadId);
  const beadTitle = sanitizeGasCityProviderText(input.sourceBeadTitle, beadId);
  const role = sanitizeGasCityProviderText(input.target, "worker");
  return [
    input.marker,
    "",
    input.heading,
    "",
    "Task context:",
    `- ID: ${beadId}`,
    `- Title: ${beadTitle}`,
    "",
    "Workflow recipe: Dev Review Test",
    `Assigned role: ${role}`,
    "",
    input.instruction,
  ].join("\n");
}

function alreadyRoutedFirstAgentMessage(): GasCityE2eAgentMessage {
  return {
    status: "unavailable",
    sessionId: null,
    sessionName: null,
    summary: "First agent message was already routed for this workflow.",
  };
}

function normalizeConfig(
  input: Partial<GasCityE2eFixtureConfig> | null,
  fixtureFile: string | null,
): GasCityE2eFixtureConfig {
  if (fixtureFile) {
    try {
      const fromFile = loadGasCityE2eFixtureConfigFromFile(fixtureFile);
      return {
        ...fromFile,
        ...input,
        beads: Array.isArray(input?.beads) ? input.beads : fromFile.beads,
      };
    } catch {
      // Fall back to explicit body/defaults. The fixture route must stay product-safe.
    }
  }
  return {
    workspaceId:
      typeof input?.workspaceId === "string" && input.workspaceId.trim()
        ? input.workspaceId
        : "workspace-e2e",
    providerAvailable: input?.providerAvailable !== false,
    beads: Array.isArray(input?.beads) ? input.beads : [],
  };
}

async function safeJson<T>(c: { req: { json: () => Promise<unknown> } }): Promise<T> {
  try {
    return (await c.req.json()) as T;
  } catch {
    return {} as T;
  }
}

function safeId(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9_.:-]+/g, "-").slice(0, 160);
}

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

interface GasCityE2eFirstAgentMessage {
  status: "sent" | "unavailable" | "failed";
  sessionId: string | null;
  sessionName: string | null;
  summary: string;
}

let sharedFixture: GasCityE2eFixtureStore | null = null;
let sharedGasCityProvider: GasCityWorkflowProvider | null = null;
const firstAgentMessagesByKey = new Map<string, GasCityE2eFirstAgentMessage>();

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
    return c.json({ ok: true, result });
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

async function routeFirstAgentMessage(args: {
  vkClient: GasCityE2eVkClient | null;
  cacheKey: string;
  workspaceId: string;
  sourceBeadId: string;
  sourceBeadTitle: string;
  target: string;
  launch: Awaited<ReturnType<GasCityWorkflowProvider["launchSourceWorkflow"]>>;
}): Promise<GasCityE2eFirstAgentMessage> {
  const cached = firstAgentMessagesByKey.get(args.cacheKey);
  if (cached) return cached;
  if (!args.vkClient) {
    return {
      status: "unavailable",
      sessionId: null,
      sessionName: null,
      summary: "First agent message delivery is unavailable in this test environment.",
    };
  }

  try {
    const sessionName = firstAgentSessionName(args.sourceBeadId);
    const sessions = await args.vkClient.getSessions(args.workspaceId);
    const session = sessions.find((candidate) => candidate.name === sessionName)
      ?? await args.vkClient.createSession({
        workspace_id: args.workspaceId,
        executor: "CODEX",
        name: sessionName,
      });
    const prompt = buildFirstAgentPrompt({
      sourceBeadId: args.sourceBeadId,
      sourceBeadTitle: args.sourceBeadTitle,
      target: args.target,
    });
    const queued = await args.vkClient.queueFollowUp(session.id, prompt, {
      source: "workflow",
      provenance: {
        kind: "workflow",
        label: "Task-backed workflow",
        workflow_run_id: args.launch.workflowRef.workflowId ?? args.cacheKey,
        workflow_name: "Dev Review Test",
        workflow_role_id: args.target,
      },
    });
    const result = firstAgentMessageReadModel(session, queued);
    firstAgentMessagesByKey.set(args.cacheKey, result);
    return result;
  } catch {
    return {
      status: "failed",
      sessionId: null,
      sessionName: null,
      summary: "First agent message could not be sent. Try again after checking the workspace session.",
    };
  }
}

function firstAgentMessageReadModel(
  session: Session,
  _queued: QueueFollowUpResponse,
): GasCityE2eFirstAgentMessage {
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

function buildFirstAgentPrompt(input: {
  sourceBeadId: string;
  sourceBeadTitle: string;
  target: string;
}): string {
  const beadId = safeId(input.sourceBeadId);
  const beadTitle = sanitizeGasCityProviderText(input.sourceBeadTitle, beadId);
  const role = sanitizeGasCityProviderText(input.target, "worker");
  return [
    "GCW14D_STEP:first_agent_message",
    "",
    "Task-backed workflow routed its first agent turn.",
    "",
    "Task context:",
    `- ID: ${beadId}`,
    `- Title: ${beadTitle}`,
    "",
    "Workflow recipe: Dev Review Test",
    `Assigned role: ${role}`,
    "",
    "Use the task context above and any explicitly available typed task tools to inspect more details when needed. Begin the first workflow turn and respond with a concise progress note.",
  ].join("\n");
}


function alreadyRoutedFirstAgentMessage(): GasCityE2eFirstAgentMessage {
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

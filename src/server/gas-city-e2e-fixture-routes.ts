import type { Hono } from "hono";
import {
  GasCityE2eFixtureStore,
  loadGasCityE2eFixtureConfigFromFile,
  type GasCityE2eFixtureConfig,
  type GasCityE2eFixtureEventInput,
} from "../modules/plugins/workflows/server/gasCityE2eFixture";

export interface RegisterGasCityE2eFixtureRoutesOptions {
  fixture?: GasCityE2eFixtureStore;
  enabled?: boolean;
  fixtureFile?: string | null;
}

let sharedFixture: GasCityE2eFixtureStore | null = null;

export function shouldRegisterGasCityE2eFixtureRoutes(): boolean {
  return process.env.VD_GAS_CITY_E2E_FIXTURE === "1";
}

export function registerGasCityE2eFixtureRoutes(hono: Hono, options: RegisterGasCityE2eFixtureRoutesOptions = {}): void {
  const enabled = options.enabled ?? shouldRegisterGasCityE2eFixtureRoutes();
  if (!enabled) return;
  const fixture = options.fixture ?? getSharedGasCityE2eFixture(options.fixtureFile ?? process.env.VD_GAS_CITY_E2E_FIXTURE_FILE ?? null);

  hono.get("/dashboard/api/workflows/gas-city-e2e-fixture", (c) => c.json({ ok: true, state: fixture.snapshot() }));

  hono.post("/dashboard/api/workflows/gas-city-e2e-fixture/reset", async (c) => {
    const body = await safeJson<Partial<GasCityE2eFixtureConfig>>(c);
    const config = normalizeConfig(body, options.fixtureFile ?? process.env.VD_GAS_CITY_E2E_FIXTURE_FILE ?? null);
    return c.json({ ok: true, state: fixture.reset(config) });
  });

  hono.post("/dashboard/api/workflows/gas-city-e2e-fixture/events", async (c) => {
    const body = await safeJson<Partial<GasCityE2eFixtureEventInput>>(c);
    const result = fixture.applyEvent({
      eventId: typeof body.eventId === "string" ? body.eventId : "",
      type: typeof body.type === "string" ? body.type as GasCityE2eFixtureEventInput["type"] : "record_agent_result_note",
      workspaceId: typeof body.workspaceId === "string" ? body.workspaceId : fixture.snapshot().fixture.workspaceId,
      beadId: typeof body.beadId === "string" ? body.beadId : null,
      title: typeof body.title === "string" ? body.title : null,
      summary: typeof body.summary === "string" ? body.summary : null,
      metadata: body.metadata && typeof body.metadata === "object" ? body.metadata as GasCityE2eFixtureEventInput["metadata"] : null,
    });
    if (result.status === "conflict") {
      return c.json({ ok: false, result }, 409);
    }
    return c.json({ ok: true, result });
  });
}

export function getSharedGasCityE2eFixture(fixtureFile?: string | null): GasCityE2eFixtureStore {
  if (!sharedFixture) {
    sharedFixture = new GasCityE2eFixtureStore(normalizeConfig({}, fixtureFile ?? null));
  }
  return sharedFixture;
}

function normalizeConfig(input: Partial<GasCityE2eFixtureConfig> | null, fixtureFile: string | null): GasCityE2eFixtureConfig {
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
    workspaceId: typeof input?.workspaceId === "string" && input.workspaceId.trim() ? input.workspaceId : "workspace-e2e",
    providerAvailable: input?.providerAvailable !== false,
    beads: Array.isArray(input?.beads) ? input.beads : [],
  };
}

async function safeJson<T>(c: { req: { json: () => Promise<unknown> } }): Promise<T> {
  try {
    return await c.req.json() as T;
  } catch {
    return {} as T;
  }
}

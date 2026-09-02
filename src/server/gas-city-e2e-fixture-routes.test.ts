import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { GasCityE2eFixtureStore } from "../modules/plugins/workflows/server/gasCityE2eFixture";
import { registerGasCityE2eFixtureRoutes } from "./gas-city-e2e-fixture-routes";

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

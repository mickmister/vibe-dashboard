import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorkflowRegistry } from "@vibe-dashboard/workflow-core";
import { WorkflowPlanAuthService } from "../modules/plugins/workflows/server/workflowPlanAuthorization";
import { registerWorkflowRoutes } from "./workflow-routes";

const servers: ReturnType<typeof serve>[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve())))); });

describe("workflow plan Node server authorization boundary", () => {
  it("uses the actual Node socket peer and exact request origin", async () => {
    const app = new Hono();
    const service = { plan: vi.fn(async () => ({ digest: "a".repeat(64) })), launch: vi.fn() } as any;
    registerWorkflowRoutes(app, { registry: createWorkflowRegistry(), workflowPlanLaunchService: service, workflowPlanAuthService: new WorkflowPlanAuthService({ now: () => 1_000 }) });
    const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 }); servers.push(server);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address(); if (!address || typeof address === "string") throw new Error("missing address");
    const origin = `http://127.0.0.1:${address.port}`;
    const issued = await fetch(`${origin}/dashboard/api/workflows/plan/auth/session`, { method: "POST", headers: { origin } });
    expect(issued.status).toBe(200);
    const { csrfToken } = await issued.json() as any; const cookie = issued.headers.get("set-cookie")!;
    const body = JSON.stringify({ workspaceId: "ws", designId: "d", inputs: {}, roleBindings: {}, beadIds: [] });
    const accepted = await fetch(`${origin}/dashboard/api/workflows/plan`, { method: "POST", headers: { origin, cookie, "x-vd-workflow-csrf": csrfToken, "content-type": "application/json" }, body });
    expect(accepted.status).toBe(200);
    const wrongOrigin = await fetch(`${origin}/dashboard/api/workflows/plan`, { method: "POST", headers: { origin: "http://localhost:1", cookie, "x-vd-workflow-csrf": csrfToken, "content-type": "application/json" }, body });
    expect(wrongOrigin.status).toBe(400);
  });
});

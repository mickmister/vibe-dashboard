import { serve } from "@hono/node-server";
import { createHash } from "node:crypto";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorkflowRegistry } from "@vibe-dashboard/workflow-core";
import { WorkflowPlanAuthService } from "../modules/plugins/workflows/server/workflowPlanAuthorization";
import { registerWorkflowRoutes } from "./workflow-routes";
import { initVdDb, type VdDbHandle } from "./database";
import { DbWorkflowPlanStore } from "../modules/plugins/workflows/server/workflowPlanStore";
import { WorkflowPlanLaunchService } from "../modules/plugins/workflows/server/workflowPlanLaunchService";

const servers: ReturnType<typeof serve>[] = []; const dbs: VdDbHandle[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve())))); for (const handle of dbs.splice(0)) { await handle.db.destroy(); handle.sqlite.close(); } });

describe("workflow plan Node server authorization boundary", () => {
  it("uses the actual Node socket peer and exact request origin", async () => {
    const app = new Hono();
    const service = { plan: vi.fn(async () => ({ digest: "a".repeat(64) })), launch: vi.fn() } as any;
    const authOptions: { browserOrigin?: string; now: () => number } = { now: () => 1_000 };
    registerWorkflowRoutes(app, { registry: createWorkflowRegistry(), workflowPlanLaunchService: service, workflowPlanAuthService: new WorkflowPlanAuthService(authOptions) });
    const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 }); servers.push(server);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address(); if (!address || typeof address === "string") throw new Error("missing address");
    const origin = `http://127.0.0.1:${address.port}`; authOptions.browserOrigin = origin;
    const issued = await fetch(`${origin}/dashboard/api/workflows/plan/auth/session`, { method: "POST", headers: { origin } });
    expect(issued.status).toBe(200);
    const { csrfToken } = await issued.json() as any; const cookie = issued.headers.get("set-cookie")!;
    const body = JSON.stringify({ workspaceId: "ws", designId: "d", inputs: {}, roleBindings: {}, beadIds: [] });
    const accepted = await fetch(`${origin}/dashboard/api/workflows/plan`, { method: "POST", headers: { origin, cookie, "x-vd-workflow-csrf": csrfToken, "content-type": "application/json" }, body });
    expect(accepted.status).toBe(200);
    const wrongOrigin = await fetch(`${origin}/dashboard/api/workflows/plan`, { method: "POST", headers: { origin: "http://localhost:1", cookie, "x-vd-workflow-csrf": csrfToken, "content-type": "application/json" }, body });
    expect(wrongOrigin.status).toBe(401);
    const missingOrigin = await fetch(`${origin}/dashboard/api/workflows/plan`, { method: "POST", headers: { cookie, "x-vd-workflow-csrf": csrfToken, "content-type": "application/json" }, body });
    expect(missingOrigin.status).toBe(401);
    const forwarded = await fetch(`${origin}/dashboard/api/workflows/plan`, { method: "POST", headers: { origin, cookie, "x-vd-workflow-csrf": csrfToken, "content-type": "application/json", "x-forwarded-host": "127.0.0.1" }, body });
    expect(forwarded.status).toBe(401);
    const launched = await fetch(`${origin}/dashboard/api/workflows/plan/launch`, { method: "POST", headers: { origin, cookie, "x-vd-workflow-csrf": csrfToken, "content-type": "application/json" }, body: JSON.stringify({ request: JSON.parse(body), planDigest: "a".repeat(64) }) });
    expect(launched.status).not.toBe(401);
    const refreshed = await fetch(`${origin}/dashboard/api/workflows/plan/auth/session`, { method: "POST", headers: { origin, cookie } });
    expect(refreshed.status).toBe(200);
    const oldSession = await fetch(`${origin}/dashboard/api/workflows/plan`, { method: "POST", headers: { origin, cookie, "x-vd-workflow-csrf": csrfToken, "content-type": "application/json" }, body });
    expect(oldSession.status).toBe(401);
  });
  it("proves route-level launch CAS, conflicts, and mandatory stale reconciliation", async () => {
    let now = 1_000; let launchMode: "success" | "throw" | "defer" = "success"; let reconcile: "unknown" | "found" = "unknown"; let releaseDeferred: (() => void) | undefined;
    const handle = await initVdDb({ path: ":memory:" }); dbs.push(handle);
    const launcher = {
      checkDynamic: vi.fn(async () => ({ ready: true })),
      launch: vi.fn(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); if (launchMode === "throw") throw new Error("interrupted"); if (launchMode === "defer") await new Promise<void>((resolve) => { releaseDeferred = resolve; }); return { runId: "run-1", status: "running", url: "/dashboard/workflows/run-1" }; }),
      reconcile: vi.fn(async () => reconcile === "found" ? { outcome: "found" as const, run: { runId: "run-recovered", status: "running", url: "/dashboard/workflows/run-recovered" } } : { outcome: "unknown" as const }),
    };
    const source = { resolve: vi.fn(async (request: any) => ({ compileInput: { workflow: { version: 1 }, inputs: request.inputs }, workflowLabel: "Workflow", tasks: [], repositories: [], securityPolicyRevision: "policy" })) };
    const compiler = { compile: vi.fn(async (input: any) => ({ schemaVersion: "vd.execution-bundle.v1", digest: createHash("sha256").update(JSON.stringify(input)).digest("hex"), bytes: new Uint8Array(), document: {}, verificationEvidence: {} })) };
    const serviceA = new WorkflowPlanLaunchService({ source: source as any, compiler: compiler as any, launcher, store: new DbWorkflowPlanStore({ getDb: async () => handle.db, now: () => now, leaseMs: 10, ownerId: "route-test-a" }), now: () => now, ttlMs: 10_000 });
    const serviceB = new WorkflowPlanLaunchService({ source: source as any, compiler: compiler as any, launcher, store: new DbWorkflowPlanStore({ getDb: async () => handle.db, now: () => now, leaseMs: 10, ownerId: "route-test-b" }), now: () => now, ttlMs: 10_000 });
    let launchInstance = 0;
    const routedService = { plan: serviceA.plan.bind(serviceA), launch: (...args: Parameters<typeof serviceA.launch>) => (++launchInstance % 2 ? serviceA : serviceB).launch(...args) };
    const authOptions: { browserOrigin?: string; now: () => number } = { now: () => now };
    const app = new Hono(); registerWorkflowRoutes(app, { registry: createWorkflowRegistry(), workflowPlanLaunchService: routedService, workflowPlanAuthService: new WorkflowPlanAuthService(authOptions) });
    const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 }); servers.push(server); await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address(); if (!address || typeof address === "string") throw new Error("missing address"); const origin = `http://127.0.0.1:${address.port}`; authOptions.browserOrigin = origin;
    const issued = await fetch(`${origin}/dashboard/api/workflows/plan/auth/session`, { method: "POST", headers: { origin } }); const csrf = (await issued.json() as any).csrfToken; const cookie = issued.headers.get("set-cookie")!;
    const headers = { origin, cookie, "x-vd-workflow-csrf": csrf, "content-type": "application/json" };
    const request = { workspaceId: "ws", designId: "d", inputs: { task: "one" }, roleBindings: {}, beadIds: [] };
    const planResponse = await fetch(`${origin}/dashboard/api/workflows/plan`, { method: "POST", headers, body: JSON.stringify(request) }); const plan = (await planResponse.json() as any).plan;
    const issuedB = await fetch(`${origin}/dashboard/api/workflows/plan/auth/session`, { method: "POST", headers: { origin } }); const csrfB = (await issuedB.json() as any).csrfToken; const headersB = { origin, cookie: issuedB.headers.get("set-cookie")!, "x-vd-workflow-csrf": csrfB, "content-type": "application/json" };
    expect((await fetch(`${origin}/dashboard/api/workflows/plan/launch`, { method: "POST", headers: headersB, body: JSON.stringify({ request, planDigest: plan.digest }) })).status).toBe(400);
    const launchBody = JSON.stringify({ request, planDigest: plan.digest });
    const [a, b] = await Promise.all([fetch(`${origin}/dashboard/api/workflows/plan/launch`, { method: "POST", headers, body: launchBody }), fetch(`${origin}/dashboard/api/workflows/plan/launch`, { method: "POST", headers, body: launchBody })]);
    expect([a.status, b.status].sort()).toEqual([200, 201]); expect(launcher.launch).toHaveBeenCalledTimes(1);
    expect((await fetch(`${origin}/dashboard/api/workflows/plan/launch`, { method: "POST", headers, body: JSON.stringify({ request: { ...request, inputs: { task: "changed" } }, planDigest: plan.digest }) })).status).toBe(400);

    launchMode = "defer"; const request2 = { ...request, inputs: { task: "two" } }; const plan2 = (await (await fetch(`${origin}/dashboard/api/workflows/plan`, { method: "POST", headers, body: JSON.stringify(request2) })).json() as any).plan;
    const firstStale = fetch(`${origin}/dashboard/api/workflows/plan/launch`, { method: "POST", headers, body: JSON.stringify({ request: request2, planDigest: plan2.digest }) });
    while (!releaseDeferred) await new Promise((resolve) => setTimeout(resolve, 1));
    now += 11; reconcile = "found"; const recovered = await fetch(`${origin}/dashboard/api/workflows/plan/launch`, { method: "POST", headers, body: JSON.stringify({ request: request2, planDigest: plan2.digest }) }); expect((await recovered.json() as any).result).toMatchObject({ status: "reused", run: { runId: "run-recovered" } });
    releaseDeferred(); expect((await firstStale).status).toBe(400);

    launchMode = "throw"; reconcile = "unknown"; const request3 = { ...request, inputs: { task: "three" } }; const plan3 = (await (await fetch(`${origin}/dashboard/api/workflows/plan`, { method: "POST", headers, body: JSON.stringify(request3) })).json() as any).plan;
    await fetch(`${origin}/dashboard/api/workflows/plan/launch`, { method: "POST", headers, body: JSON.stringify({ request: request3, planDigest: plan3.digest }) }); now += 11;
    const unknown = await fetch(`${origin}/dashboard/api/workflows/plan/launch`, { method: "POST", headers, body: JSON.stringify({ request: request3, planDigest: plan3.digest }) }); expect((await unknown.json() as any).result.status).toBe("waiting");
    expect(launcher.launch).toHaveBeenCalledTimes(3); expect(launcher.reconcile).toHaveBeenCalledTimes(2);
  });

});

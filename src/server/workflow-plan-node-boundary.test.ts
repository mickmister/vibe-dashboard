import { serve } from "@hono/node-server";
import { createHash } from "node:crypto";
import { request as httpRequest } from "node:http";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorkflowRegistry } from "@vibe-dashboard/workflow-core";
import { signWorkflowCliCapability, WorkflowPlanAuthService } from "../modules/plugins/workflows/server/workflowPlanAuthorization";
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
    for (const header of ["forwarded", "via", "x-real-ip", "x-original-url", "x-rewrite-url", "x-forwarded-for", "x-forwarded-host", "x-forwarded-port", "x-forwarded-proto"]) {
      const forwarded = await fetch(`${origin}/dashboard/api/workflows/plan`, { method: "POST", headers: { origin, cookie, "x-vd-workflow-csrf": csrfToken, "content-type": "application/json", [header]: "spoof" }, body });
      expect(forwarded.status, header).toBe(401);
    }
    const spoofedHostStatus = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(`${origin}/dashboard/api/workflows/plan`, { method: "POST", headers: { origin, host: "127.0.0.1:1", cookie, "x-vd-workflow-csrf": csrfToken, "content-type": "application/json", "content-length": Buffer.byteLength(body) } }, (response) => { response.resume(); response.on("end", () => resolve(response.statusCode ?? 0)); });
      request.on("error", reject); request.end(body);
    });
    expect(spoofedHostStatus).toBe(401);
    const launched = await fetch(`${origin}/dashboard/api/workflows/plan/launch`, { method: "POST", headers: { origin, cookie, "x-vd-workflow-csrf": csrfToken, "content-type": "application/json" }, body: JSON.stringify({ request: JSON.parse(body), planDigest: "a".repeat(64) }) });
    expect(launched.status).not.toBe(401);
    const refreshed = await fetch(`${origin}/dashboard/api/workflows/plan/auth/session`, { method: "POST", headers: { origin, cookie } });
    expect(refreshed.status).toBe(200);
    const oldSession = await fetch(`${origin}/dashboard/api/workflows/plan`, { method: "POST", headers: { origin, cookie, "x-vd-workflow-csrf": csrfToken, "content-type": "application/json" }, body });
    expect(oldSession.status).toBe(401);
  });
  it("accepts real IPv6 and mapped IPv4 peers when the platform supports those sockets", async (context) => {
    const exercise = async (hostname: string, requestHost: string) => {
      const app = new Hono(); const authOptions: { browserOrigin?: string } = {};
      registerWorkflowRoutes(app, { registry: createWorkflowRegistry(), workflowPlanLaunchService: { plan: vi.fn(async () => ({ digest: "a".repeat(64) })), launch: vi.fn() } as any, workflowPlanAuthService: new WorkflowPlanAuthService(authOptions) });
      const server = serve({ fetch: app.fetch, hostname, port: 0 });
      await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); }); servers.push(server);
      const address = server.address(); if (!address || typeof address === "string") throw new Error("missing address");
      const origin = `http://${requestHost}:${address.port}`; authOptions.browserOrigin = origin;
      const response = await fetch(`${origin}/dashboard/api/workflows/plan/auth/session`, { method: "POST", headers: { origin } });
      expect(response.status).toBe(200);
    };
    try { await exercise("::1", "[::1]"); } catch (error: any) { if (["EAFNOSUPPORT", "EADDRNOTAVAIL"].includes(error?.code)) return context.skip(); throw error; }
    try { await exercise("::", "127.0.0.1"); } catch (error: any) { if (["EAFNOSUPPORT", "EADDRNOTAVAIL", "ECONNREFUSED"].includes(error?.cause?.code ?? error?.code)) return context.skip(); throw error; }
  });

  it("fails closed for missing or mismatched configured listener origins", async () => {
    for (const configured of [undefined, "http://127.0.0.1:3000"] as const) {
      const app = new Hono();
      registerWorkflowRoutes(app, { registry: createWorkflowRegistry(), workflowPlanLaunchService: {} as any, workflowPlanAuthService: new WorkflowPlanAuthService({ browserOrigin: configured }) });
      const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 }); servers.push(server); await new Promise<void>((resolve) => server.once("listening", resolve));
      const address = server.address(); if (!address || typeof address === "string") throw new Error("missing address"); const origin = `http://127.0.0.1:${address.port}`;
      expect((await fetch(`${origin}/dashboard/api/workflows/plan/auth/session`, { method: "POST", headers: { origin } })).status).toBe(403);
    }
  });
  it("honors the configured standard and remapped Docker listener ports", async () => {
    for (const port of [3000, 43127]) {
      const origin = `http://127.0.0.1:${port}`; const app = new Hono();
      registerWorkflowRoutes(app, { registry: createWorkflowRegistry(), workflowPlanLaunchService: {} as any, workflowPlanAuthService: new WorkflowPlanAuthService({ browserOrigin: origin }) });
      const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port }); servers.push(server);
      await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
      expect((await fetch(`${origin}/dashboard/api/workflows/plan/auth/session`, { method: "POST", headers: { origin } })).status).toBe(200);
      await new Promise<void>((resolve) => server.close(() => resolve())); servers.splice(servers.indexOf(server), 1);
    }
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
    const key = { keyId: "node-boundary", generation: 7, secret: "n".repeat(32) }; const auth = new WorkflowPlanAuthService({ cliCapabilityKey: key, now: () => now });
    const appA = new Hono(); registerWorkflowRoutes(appA, { registry: createWorkflowRegistry(), workflowPlanLaunchService: serviceA, workflowPlanAuthService: auth });
    const appB = new Hono(); registerWorkflowRoutes(appB, { registry: createWorkflowRegistry(), workflowPlanLaunchService: serviceB, workflowPlanAuthService: auth });
    const serverA = serve({ fetch: appA.fetch, hostname: "127.0.0.1", port: 0 }); const serverB = serve({ fetch: appB.fetch, hostname: "127.0.0.1", port: 0 }); servers.push(serverA, serverB);
    await Promise.all([serverA, serverB].map((server) => new Promise<void>((resolve) => server.once("listening", resolve))));
    const addressA = serverA.address(), addressB = serverB.address(); if (!addressA || typeof addressA === "string" || !addressB || typeof addressB === "string") throw new Error("missing address");
    const originA = `http://127.0.0.1:${addressA.port}`, originB = `http://127.0.0.1:${addressB.port}`;
    const capability = signWorkflowCliCapability(key.secret, { v: 1, aud: "vd-workflow-plan", purpose: "plan-launch", kid: key.keyId, generation: key.generation, jti: "node-boundary-capability", iat: 900, exp: 10_000, workspaceId: "ws", sessionId: "session" });
    const headers = { "x-vk-workflow-session-capability": capability, "content-type": "application/json" };
    const request = { workspaceId: "ws", designId: "d", inputs: { task: "one" }, roleBindings: {}, beadIds: [], completionResponse: { sessionId: "session", source: "vibe-agent-cli" } };
    const planResponse = await fetch(`${originA}/dashboard/api/workflows/plan`, { method: "POST", headers, body: JSON.stringify(request) }); const plan = (await planResponse.json() as any).plan;
    const launchBody = JSON.stringify({ request, planDigest: plan.digest });
    const [a, b] = await Promise.all([fetch(`${originA}/dashboard/api/workflows/plan/launch`, { method: "POST", headers, body: launchBody }), fetch(`${originB}/dashboard/api/workflows/plan/launch`, { method: "POST", headers, body: launchBody })]);
    expect([a.status, b.status].sort()).toEqual([200, 201]); expect(launcher.launch).toHaveBeenCalledTimes(1);
    expect((await fetch(`${originB}/dashboard/api/workflows/plan/launch`, { method: "POST", headers, body: JSON.stringify({ request: { ...request, inputs: { task: "changed" } }, planDigest: plan.digest }) })).status).toBe(400);

    launchMode = "defer"; const request2 = { ...request, inputs: { task: "two" } }; const plan2 = (await (await fetch(`${originA}/dashboard/api/workflows/plan`, { method: "POST", headers, body: JSON.stringify(request2) })).json() as any).plan;
    const firstStale = fetch(`${originA}/dashboard/api/workflows/plan/launch`, { method: "POST", headers, body: JSON.stringify({ request: request2, planDigest: plan2.digest }) });
    while (!releaseDeferred) await new Promise((resolve) => setTimeout(resolve, 1));
    now += 11; reconcile = "found"; const recovered = await fetch(`${originB}/dashboard/api/workflows/plan/launch`, { method: "POST", headers, body: JSON.stringify({ request: request2, planDigest: plan2.digest }) }); expect((await recovered.json() as any).result).toMatchObject({ status: "reused", run: { runId: "run-recovered" } });
    releaseDeferred(); expect((await firstStale).status).toBe(400);

    launchMode = "throw"; reconcile = "unknown"; const request3 = { ...request, inputs: { task: "three" } }; const plan3 = (await (await fetch(`${originA}/dashboard/api/workflows/plan`, { method: "POST", headers, body: JSON.stringify(request3) })).json() as any).plan;
    await fetch(`${originA}/dashboard/api/workflows/plan/launch`, { method: "POST", headers, body: JSON.stringify({ request: request3, planDigest: plan3.digest }) }); now += 11;
    const unknown = await fetch(`${originB}/dashboard/api/workflows/plan/launch`, { method: "POST", headers, body: JSON.stringify({ request: request3, planDigest: plan3.digest }) }); expect((await unknown.json() as any).result.status).toBe("waiting");
    expect(launcher.launch).toHaveBeenCalledTimes(3); expect(launcher.reconcile).toHaveBeenCalledTimes(2);
  });

});

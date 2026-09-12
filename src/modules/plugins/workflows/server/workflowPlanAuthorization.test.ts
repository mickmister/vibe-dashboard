import { describe, expect, it } from "vitest";
import { signWorkflowCliCapability, WorkflowPlanAuthService, type WorkflowCliCapabilityPayload } from "./workflowPlanAuthorization";
const plan = (workspaceId = "ws-1", sessionId: string | null = null): any => ({ workspaceId, completionResponse: sessionId ? { sessionId, source: "vibe-agent-cli" } : null });
const local = { peerAddress: "127.0.0.1", serverOrigin: "https://vd.test:7443" };
const payload = (overrides: Partial<WorkflowCliCapabilityPayload> = {}): WorkflowCliCapabilityPayload => ({ v: 1, aud: "vd-workflow-plan", purpose: "plan-launch", kid: "key-1", generation: 7, jti: "0123456789abcdef", iat: 1_000, exp: 200_000, workspaceId: "ws-1", sessionId: "session-1", ...overrides });
describe("workflow plan authorization", () => {
  it("binds a browser session to exact origin and checks loopback on every request", async () => {
    const auth = new WorkflowPlanAuthService({ now: () => 1000 });
    expect(() => auth.issueBrowserSession(new Request("https://vd.test:7443/auth", { headers: { origin: "https://vd.test:7443" } }), { ...local, peerAddress: "10.0.0.2" })).toThrow("verified local");
    const issued = auth.issueBrowserSession(new Request("https://vd.test:7443/auth", { headers: { origin: "https://vd.test:7443" } }), local);
    const cookie = issued.cookie.split(";")[0]!;
    const request = (origin = local.serverOrigin) => new Request("https://vd.test:7443/plan", { headers: { cookie, origin, "sec-fetch-site": "same-origin", "x-vd-workflow-csrf": issued.csrfToken } });
    await expect(auth.authenticate(request(), plan(), local)).resolves.toMatchObject({ workspaceId: "ws-1" });
    await expect(auth.authenticate(request(), plan(), { ...local, peerAddress: "10.0.0.2" })).rejects.toThrow("verified local");
    await expect(auth.authenticate(request("https://vd.test:7444"), plan(), local)).rejects.toThrow("origin");
    await expect(auth.authenticate(new Request("https://vd.test:7443/plan", { headers: { cookie, origin: local.serverOrigin, "x-vd-workflow-csrf": "forged" } }), plan(), local)).rejects.toThrow("authorization");
  });
  it("expires browser sessions and restart or cross-session replay fails closed", async () => {
    let now = 1000; const auth = new WorkflowPlanAuthService({ now: () => now, browserTtlMs: 10 });
    const issued = auth.issueBrowserSession(new Request("https://vd.test:7443/auth", { headers: { origin: local.serverOrigin } }), local);
    const request = new Request("https://vd.test:7443/plan", { headers: { cookie: issued.cookie.split(";")[0]!, origin: local.serverOrigin, "x-vd-workflow-csrf": issued.csrfToken } });
    await expect(new WorkflowPlanAuthService({ now: () => now }).authenticate(request, plan(), local)).rejects.toThrow("authorization");
    now = 1011; await expect(auth.authenticate(request, plan(), local)).rejects.toThrow("authorization");
  });
  it("verifies the versioned capability contract and key rotation", async () => {
    const secret = "s".repeat(32); const old = "o".repeat(32);
    const token = signWorkflowCliCapability(secret, payload());
    const request = new Request("https://vd.test/plan", { headers: { "x-vk-workflow-session-capability": token } });
    const auth = new WorkflowPlanAuthService({ cliCapabilityKeys: [{ keyId: "key-1", generation: 7, secret }, { keyId: "old", generation: 6, secret: old }], now: () => 2_000 });
    await expect(auth.authenticate(request, plan("ws-1", "session-1"), { peerAddress: "10.0.0.2", serverOrigin: "https://vd.test" })).resolves.toMatchObject({ callerSessionId: "session-1" });
    for (const bad of [payload({ workspaceId: "ws-2" }), payload({ sessionId: "session-2" }), payload({ purpose: "other" as any }), payload({ aud: "other" as any }), payload({ exp: 1_999 }), payload({ generation: 8 })]) {
      const badRequest = new Request("https://vd.test/plan", { headers: { "x-vk-workflow-session-capability": signWorkflowCliCapability(secret, bad) } });
      await expect(auth.authenticate(badRequest, plan("ws-1", "session-1"), local)).rejects.toThrow();
    }
    await expect(new WorkflowPlanAuthService({ cliCapabilityKeys: [{ keyId: "key-2", generation: 8, secret: "n".repeat(32) }], now: () => 2_000 }).authenticate(request, plan("ws-1", "session-1"), local)).rejects.toThrow("invalid");
  });
  it("accepts the stable token emitted by the Rust VK capability implementation", () => {
    const token = "eyJ2IjoxLCJhdWQiOiJ2ZC13b3JrZmxvdy1wbGFuIiwicHVycG9zZSI6InBsYW4tbGF1bmNoIiwia2lkIjoiZ29sZGVuIiwiZ2VuZXJhdGlvbiI6MywianRpIjoiMDAxMTIyMzM0NDU1NjY3Nzg4OTlhYWJiY2NkZGVlZmYiLCJpYXQiOjE3MDAwMDAwMDAwMDAsImV4cCI6MTcwMDAwMDMwMDAwMCwid29ya3NwYWNlSWQiOiJ3b3Jrc3BhY2UtZ29sZGVuIiwic2Vzc2lvbklkIjoic2Vzc2lvbi1nb2xkZW4ifQ.-Gqr3kkiJ2cULsCVakLqK5DzEp1SIcdqbh4V-F8zGJc";
    expect(() => new WorkflowPlanAuthService({ cliCapabilityKeys: [{ keyId: "golden", generation: 3, secret: "0123456789abcdef0123456789abcdef" }], now: () => 1_700_000_000_100 }).verifyCliCapability(token, plan("workspace-golden", "session-golden"))).not.toThrow();
  });
});

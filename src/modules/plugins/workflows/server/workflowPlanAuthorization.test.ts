import { describe, expect, it } from "vitest";
import { signWorkflowCliCapability, WorkflowPlanAuthService, type WorkflowCliCapabilityPayload } from "./workflowPlanAuthorization";
const plan = (workspaceId = "ws-1", sessionId: string | null = null): any => ({ workspaceId, completionResponse: sessionId ? { sessionId, source: "vibe-agent-cli" } : null });
const local = { peerAddress: "127.0.0.1" };
const localOrigin = "https://127.0.0.1:7443";
const payload = (overrides: Partial<WorkflowCliCapabilityPayload> = {}): WorkflowCliCapabilityPayload => ({ v: 1, aud: "vd-workflow-plan", purpose: "plan-launch", kid: "key-1", generation: 7, jti: "0123456789abcdef", iat: 1_000, exp: 200_000, workspaceId: "ws-1", sessionId: "session-1", ...overrides });
describe("workflow plan authorization", () => {
  it("binds a browser session to exact origin and checks loopback on every request", async () => {
    const auth = new WorkflowPlanAuthService({ browserOrigin: localOrigin, now: () => 1000 });
    expect(() => auth.issueBrowserSession(new Request("https://127.0.0.1:7443/auth", { headers: { origin: "https://127.0.0.1:7443" } }), { ...local, peerAddress: "10.0.0.2" })).toThrow("verified local");
    const issued = auth.issueBrowserSession(new Request("https://127.0.0.1:7443/auth", { headers: { origin: "https://127.0.0.1:7443", host: "127.0.0.1:7443" } }), local);
    const cookie = issued.cookie.split(";")[0]!;
    const request = (origin = localOrigin) => new Request("https://127.0.0.1:7443/plan", { headers: { cookie, origin, host: "127.0.0.1:7443", "sec-fetch-site": "same-origin", "x-vd-workflow-csrf": issued.csrfToken } });
    await expect(auth.authenticate(request(), plan(), local)).resolves.toMatchObject({ workspaceId: "ws-1" });
    await expect(auth.authenticate(request(), plan(), { ...local, peerAddress: "10.0.0.2" })).rejects.toThrow("verified local");
    await expect(auth.authenticate(request("https://vd.test:7444"), plan(), local)).rejects.toThrow("origin");
    await expect(auth.authenticate(new Request("https://127.0.0.1:7443/plan", { headers: { cookie, origin: localOrigin, host: "127.0.0.1:7443", "x-vd-workflow-csrf": "forged" } }), plan(), local)).rejects.toThrow("authorization");
  });
  it("expires browser sessions and restart or cross-session replay fails closed", async () => {
    let now = 1000; const auth = new WorkflowPlanAuthService({ browserOrigin: localOrigin, now: () => now, browserTtlMs: 10 });
    const issued = auth.issueBrowserSession(new Request("https://127.0.0.1:7443/auth", { headers: { origin: localOrigin, host: "127.0.0.1:7443" } }), local);
    const request = new Request("https://127.0.0.1:7443/plan", { headers: { cookie: issued.cookie.split(";")[0]!, origin: localOrigin, host: "127.0.0.1:7443", "x-vd-workflow-csrf": issued.csrfToken } });
    await expect(new WorkflowPlanAuthService({ browserOrigin: localOrigin, now: () => now }).authenticate(request, plan(), local)).rejects.toThrow("authorization");
    now = 1011; await expect(auth.authenticate(request, plan(), local)).rejects.toThrow("authorization");
  });
  it("verifies the versioned capability contract and restart generation invalidation", async () => {
    const secret = "s".repeat(32);
    const token = signWorkflowCliCapability(secret, payload());
    const request = new Request("https://vd.test/plan", { headers: { "x-vk-workflow-session-capability": token } });
    const auth = new WorkflowPlanAuthService({ cliCapabilityKey: { keyId: "key-1", generation: 7, secret }, now: () => 2_000 });
    await expect(auth.authenticate(request, plan("ws-1", "session-1"), { peerAddress: "10.0.0.2",  })).resolves.toMatchObject({ callerSessionId: "session-1" });
    for (const bad of [payload({ workspaceId: "ws-2" }), payload({ sessionId: "session-2" }), payload({ purpose: "other" as any }), payload({ aud: "other" as any }), payload({ exp: 1_999 }), payload({ generation: 8 })]) {
      const badRequest = new Request("https://vd.test/plan", { headers: { "x-vk-workflow-session-capability": signWorkflowCliCapability(secret, bad) } });
      await expect(auth.authenticate(badRequest, plan("ws-1", "session-1"), local)).rejects.toThrow();
    }
    await expect(new WorkflowPlanAuthService({ cliCapabilityKey: { keyId: "key-2", generation: 8, secret: "n".repeat(32) }, now: () => 2_000 }).authenticate(request, plan("ws-1", "session-1"), local)).rejects.toThrow("invalid");
  });
  it("accepts the stable token emitted by the Rust VK capability implementation", () => {
    const token = "eyJ2IjoxLCJhdWQiOiJ2ZC13b3JrZmxvdy1wbGFuIiwicHVycG9zZSI6InBsYW4tbGF1bmNoIiwia2lkIjoiZ29sZGVuIiwiZ2VuZXJhdGlvbiI6MywianRpIjoiMDAxMTIyMzM0NDU1NjY3Nzg4OTlhYWJiY2NkZGVlZmYiLCJpYXQiOjE3MDAwMDAwMDAwMDAsImV4cCI6MTcwMDAwMDMwMDAwMCwid29ya3NwYWNlSWQiOiJ3b3Jrc3BhY2UtZ29sZGVuIiwic2Vzc2lvbklkIjoic2Vzc2lvbi1nb2xkZW4ifQ.-Gqr3kkiJ2cULsCVakLqK5DzEp1SIcdqbh4V-F8zGJc";
    expect(() => new WorkflowPlanAuthService({ cliCapabilityKey: { keyId: "golden", generation: 3, secret: "0123456789abcdef0123456789abcdef" }, now: () => 1_700_000_000_100 }).verifyCliCapability(token, plan("workspace-golden", "session-golden"))).not.toThrow();
  });
  it("rejects Rust-generated negative capability vectors", () => {
    const tokens = [
      "eyJ2IjoxLCJhdWQiOiJvdGhlciIsInB1cnBvc2UiOiJwbGFuLWxhdW5jaCIsImtpZCI6ImdvbGRlbiIsImdlbmVyYXRpb24iOjMsImp0aSI6IjAwMTEyMjMzNDQ1NTY2Nzc4ODk5YWFiYmNjZGRlZWZmIiwiaWF0IjoxNzAwMDAwMDAwMDAwLCJleHAiOjE3MDAwMDAzMDAwMDAsIndvcmtzcGFjZUlkIjoid29ya3NwYWNlLWdvbGRlbiIsInNlc3Npb25JZCI6InNlc3Npb24tZ29sZGVuIn0.JIzZbJtDk9VkQPXB9RaLBdclpoOhlsXTYHouR65Mj58",
      "eyJ2IjoxLCJhdWQiOiJ2ZC13b3JrZmxvdy1wbGFuIiwicHVycG9zZSI6Im90aGVyIiwia2lkIjoiZ29sZGVuIiwiZ2VuZXJhdGlvbiI6MywianRpIjoiMDAxMTIyMzM0NDU1NjY3Nzg4OTlhYWJiY2NkZGVlZmYiLCJpYXQiOjE3MDAwMDAwMDAwMDAsImV4cCI6MTcwMDAwMDMwMDAwMCwid29ya3NwYWNlSWQiOiJ3b3Jrc3BhY2UtZ29sZGVuIiwic2Vzc2lvbklkIjoic2Vzc2lvbi1nb2xkZW4ifQ.GqxofinGYe2qTkwUJMtFvffBfzfI1vFz8pezyJEvSJk",
      "eyJ2IjoxLCJhdWQiOiJ2ZC13b3JrZmxvdy1wbGFuIiwicHVycG9zZSI6InBsYW4tbGF1bmNoIiwia2lkIjoiZ29sZGVuIiwiZ2VuZXJhdGlvbiI6NCwianRpIjoiMDAxMTIyMzM0NDU1NjY3Nzg4OTlhYWJiY2NkZGVlZmYiLCJpYXQiOjE3MDAwMDAwMDAwMDAsImV4cCI6MTcwMDAwMDMwMDAwMCwid29ya3NwYWNlSWQiOiJ3b3Jrc3BhY2UtZ29sZGVuIiwic2Vzc2lvbklkIjoic2Vzc2lvbi1nb2xkZW4ifQ.CJTQVtfuaS0Mc7h1eu69fonRyMUlOnk_q00CVVwot-Y",
      "eyJ2IjoxLCJhdWQiOiJ2ZC13b3JrZmxvdy1wbGFuIiwicHVycG9zZSI6InBsYW4tbGF1bmNoIiwia2lkIjoiZ29sZGVuIiwiZ2VuZXJhdGlvbiI6MywianRpIjoiMDAxMTIyMzM0NDU1NjY3Nzg4OTlhYWJiY2NkZGVlZmYiLCJpYXQiOjE3MDAwMDAwMDAwMDAsImV4cCI6MTY5OTk5OTk5OTk5OSwid29ya3NwYWNlSWQiOiJ3b3Jrc3BhY2UtZ29sZGVuIiwic2Vzc2lvbklkIjoic2Vzc2lvbi1nb2xkZW4ifQ.Ln1mE4Pk0i9PqN17eNEufsAf5GpggzYQTv1JxUylb1o",
    ];
    const auth = new WorkflowPlanAuthService({ cliCapabilityKey: { keyId: "golden", generation: 3, secret: "0123456789abcdef0123456789abcdef" }, now: () => 1_700_000_000_100 });
    for (const token of tokens) expect(() => auth.verifyCliCapability(token, plan("workspace-golden", "session-golden"))).toThrow();
    const valid = "eyJ2IjoxLCJhdWQiOiJ2ZC13b3JrZmxvdy1wbGFuIiwicHVycG9zZSI6InBsYW4tbGF1bmNoIiwia2lkIjoiZ29sZGVuIiwiZ2VuZXJhdGlvbiI6MywianRpIjoiMDAxMTIyMzM0NDU1NjY3Nzg4OTlhYWJiY2NkZGVlZmYiLCJpYXQiOjE3MDAwMDAwMDAwMDAsImV4cCI6MTcwMDAwMDMwMDAwMCwid29ya3NwYWNlSWQiOiJ3b3Jrc3BhY2UtZ29sZGVuIiwic2Vzc2lvbklkIjoic2Vzc2lvbi1nb2xkZW4ifQ.-Gqr3kkiJ2cULsCVakLqK5DzEp1SIcdqbh4V-F8zGJc";
    expect(() => auth.verifyCliCapability(`${valid.slice(0, -1)}x`, plan("workspace-golden", "session-golden"))).toThrow("invalid");
  });

  it.each(["127.0.0.1", "::1", "::ffff:127.0.0.1"])("accepts explicit kernel loopback peer %s", (peerAddress) => {
    const auth = new WorkflowPlanAuthService({ browserOrigin: localOrigin, now: () => 1000 });
    expect(() => auth.issueBrowserSession(new Request(`${localOrigin}/auth`, { headers: { origin: localOrigin, host: "127.0.0.1:7443" } }), { peerAddress })).not.toThrow();
  });
  it("rejects missing origin, host spoofing, and proxy override headers", () => {
    const auth = new WorkflowPlanAuthService({ browserOrigin: localOrigin, now: () => 1000 });
    const request = (headers: Record<string,string>) => new Request(`${localOrigin}/auth`, { headers });
    expect(() => auth.issueBrowserSession(request({ host: "127.0.0.1:7443" }), local)).toThrow("origin");
    expect(() => auth.issueBrowserSession(request({ origin: localOrigin, host: "127.0.0.1:9999" }), local)).toThrow("origin");
    for (const name of ["forwarded", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-real-ip", "x-original-url", "x-rewrite-url", "via"]) expect(() => auth.issueBrowserSession(request({ origin: localOrigin, host: "127.0.0.1:7443", [name]: "spoof" }), local)).toThrow("Proxy");
  });

});

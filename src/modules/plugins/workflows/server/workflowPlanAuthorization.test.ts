import { describe, expect, it } from "vitest";
import { signWorkflowCliCapability, WorkflowPlanAuthService } from "./workflowPlanAuthorization";
const plan = (workspaceId = "ws-1", sessionId: string | null = null): any => ({ workspaceId, completionResponse: sessionId ? { sessionId, source: "vibe-agent-cli" } : null });
describe("workflow plan authorization", () => {
  it("issues unguessable bound browser sessions only over verified local ingress", async () => {
    const auth = new WorkflowPlanAuthService({ kernelLoopback: (request) => request.headers.get("x-test-loopback") === "yes", now: () => 1000 });
    expect(() => auth.issueBrowserSession(new Request("https://vd.test/auth"))).toThrow("verified local");
    const issued = auth.issueBrowserSession(new Request("https://vd.test/auth", { headers: { "x-test-loopback": "yes", origin: "https://localhost" } }));
    const cookie = issued.cookie.split(";")[0]!;
    const request = new Request("https://vd.test/plan", { headers: { cookie, origin: "https://vd.test", "sec-fetch-site": "same-origin", "x-vd-workflow-csrf": issued.csrfToken } });
    const principal = await auth.authenticate(request, plan());
    await expect(auth.authenticate(new Request("https://vd.test/plan", { headers: { cookie, origin: "https://vd.test", "x-vd-workflow-csrf": "forged" } }), plan())).rejects.toThrow("authorization");
    const other = auth.issueBrowserSession(new Request("https://vd.test/auth", { headers: { "x-test-loopback": "yes", origin: "https://localhost" } }));
    expect((await auth.authenticate(new Request("https://vd.test/plan", { headers: { cookie: other.cookie.split(";")[0]!, origin: "https://vd.test", "x-vd-workflow-csrf": other.csrfToken } }), plan())).principalId).not.toBe(principal.principalId);
  });
  it("requires a signed short-lived CLI capability bound to session and workspace", async () => {
    const auth = new WorkflowPlanAuthService({ cliCapabilitySecret: "secret", now: () => 1000 });
    const token = signWorkflowCliCapability("secret", { workspaceId: "ws-1", sessionId: "session-1", exp: 2000 });
    const request = new Request("https://vd.test/plan", { headers: { "x-vk-workflow-session-capability": token } });
    await expect(auth.authenticate(request, plan("ws-1", "session-1"))).resolves.toMatchObject({ principalId: "session:session-1" });
    await expect(auth.authenticate(request, plan("ws-2", "session-1"))).rejects.toThrow("authorize");
    await expect(new WorkflowPlanAuthService({ cliCapabilitySecret: "other", now: () => 1000 }).authenticate(request, plan("ws-1", "session-1"))).rejects.toThrow("invalid");
  });
});

import { describe, expect, it, vi } from "vitest";
import { createWorkflowPlanAuthorizer } from "./workflowPlanAuthorization";

const plan = (workspaceId = "ws-1", sessionId: string | null = null): any => ({ workspaceId, completionResponse: sessionId ? { sessionId, source: "vibe-agent-cli" } : null });
describe("workflow plan authorization", () => {
  const vk = { getSession: vi.fn(async (id: string) => ({ id, workspace_id: "ws-1" })) };
  it("accepts same-origin UI and rejects cross-site requests", async () => {
    const authorize = createWorkflowPlanAuthorizer(vk);
    await expect(authorize(new Request("https://vd.test/dashboard/api/workflows/plan", { headers: { origin: "https://vd.test", "sec-fetch-site": "same-origin" } }), plan())).resolves.toMatchObject({ principalId: "local-ui" });
    await expect(authorize(new Request("https://vd.test/dashboard/api/workflows/plan", { headers: { origin: "https://other.test", "sec-fetch-site": "cross-site" } }), plan())).rejects.toThrow("origin");
  });
  it("binds CLI identity to a VK session in the requested workspace", async () => {
    const authorize = createWorkflowPlanAuthorizer(vk);
    const request = new Request("https://vd.test/dashboard/api/workflows/plan", { headers: { "x-vd-workflow-client": "vibe-agent" } });
    await expect(authorize(request, plan("ws-1", "session-1"))).resolves.toMatchObject({ principalId: "session:session-1", callerSessionId: "session-1" });
    await expect(authorize(request, plan("ws-2", "session-1"))).rejects.toThrow("workspace");
    await expect(authorize(new Request("https://vd.test/dashboard/api/workflows/plan"), plan())).rejects.toThrow("caller session");
  });
});

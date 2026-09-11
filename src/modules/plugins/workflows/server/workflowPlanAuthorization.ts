import type { WorkflowPlanPrincipal, WorkflowPlanRequest } from "./workflowPlanLaunchService";

interface SessionReader { getSession(id: string): Promise<{ id: string; workspace_id: string } | null> }

/** Local UI uses same-origin CSRF protection. CLI identity is a real VK caller session. */
export function createWorkflowPlanAuthorizer(vk: SessionReader) {
  return async (request: Request, plan: WorkflowPlanRequest): Promise<WorkflowPlanPrincipal> => {
    const origin = request.headers.get("origin");
    if (origin) {
      if (origin !== new URL(request.url).origin || request.headers.get("sec-fetch-site") === "cross-site") throw new Error("Workflow request origin is not authorized.");
      if (plan.completionResponse) throw new Error("Browser workflow requests cannot claim a caller session.");
      return { principalId: "local-ui", workspaceId: plan.workspaceId, callerSessionId: null };
    }
    if (request.headers.get("x-vd-workflow-client") !== "vibe-agent" || !plan.completionResponse?.sessionId) throw new Error("Workflow CLI authorization requires a caller session.");
    const session = await vk.getSession(plan.completionResponse.sessionId);
    if (!session || session.workspace_id !== plan.workspaceId) throw new Error("Caller session is not available in this workspace.");
    return { principalId: `session:${session.id}`, workspaceId: plan.workspaceId, callerSessionId: session.id };
  };
}

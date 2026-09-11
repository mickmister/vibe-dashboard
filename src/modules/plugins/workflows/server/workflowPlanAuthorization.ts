import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { WorkflowPlanPrincipal, WorkflowPlanRequest } from "./workflowPlanLaunchService";

export const WORKFLOW_BROWSER_COOKIE = "vd_workflow_plan_session";
export class WorkflowPlanAuthService {
  private readonly browserSessions = new Map<string, { principalId: string; csrfHash: string; expiresAt: number }>();
  constructor(private readonly options: { kernelLoopback?: (request: Request) => boolean; cliCapabilitySecret?: string; now?: () => number; ttlMs?: number }) {}
  issueBrowserSession(request: Request) {
    if (!(this.options.kernelLoopback ?? isKernelLoopback)(request)) throw new Error("A verified local connection is required.");
    const origin = request.headers.get("origin");
    if (!origin || !isLoopbackHost(new URL(origin).hostname)) throw new Error("Unsigned browser authorization is limited to the local interface.");
    const now = this.now();
    for (const [id, session] of this.browserSessions) if (session.expiresAt <= now) this.browserSessions.delete(id);
    const sessionId = randomBytes(32).toString("base64url"), csrfToken = randomBytes(32).toString("base64url"), expiresAt = now + (this.options.ttlMs ?? 3_600_000);
    this.browserSessions.set(sessionId, { principalId: `browser:${randomBytes(24).toString("base64url")}`, csrfHash: hash(csrfToken), expiresAt });
    return { cookie: `${WORKFLOW_BROWSER_COOKIE}=${sessionId}; HttpOnly; SameSite=Strict; Path=/dashboard/api/workflows/plan; Max-Age=${Math.floor((this.options.ttlMs ?? 3_600_000) / 1000)}`, csrfToken, expiresAt };
  }
  async authenticate(request: Request, plan: WorkflowPlanRequest): Promise<WorkflowPlanPrincipal> {
    const capability = request.headers.get("x-vk-workflow-session-capability");
    if (capability) return this.verifyCliCapability(capability, plan);
    const sessionId = readCookie(request.headers.get("cookie"), WORKFLOW_BROWSER_COOKIE), csrf = request.headers.get("x-vd-workflow-csrf") ?? "";
    const session = sessionId ? this.browserSessions.get(sessionId) : undefined;
    if (!session || session.expiresAt <= this.now() || !constantEqual(hash(csrf), session.csrfHash)) throw new Error("Workflow browser session authorization failed.");
    if (request.headers.get("origin") !== new URL(request.url).origin || request.headers.get("sec-fetch-site") === "cross-site") throw new Error("Workflow request origin is not authorized.");
    if (plan.completionResponse) throw new Error("Browser workflow requests cannot claim a caller session.");
    return { principalId: session.principalId, workspaceId: plan.workspaceId, callerSessionId: null };
  }
  private verifyCliCapability(token: string, plan: WorkflowPlanRequest): WorkflowPlanPrincipal {
    const secret = this.options.cliCapabilitySecret; if (!secret) throw new Error("Workflow CLI session capabilities are unavailable.");
    const [encoded, signature] = token.split(".");
    if (!encoded || !signature || !constantEqual(createHmac("sha256", secret).update(encoded).digest("base64url"), signature)) throw new Error("Workflow CLI session capability is invalid.");
    let payload: any; try { payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")); } catch { throw new Error("Workflow CLI session capability is invalid."); }
    if (payload.exp <= this.now() || payload.workspaceId !== plan.workspaceId || payload.sessionId !== plan.completionResponse?.sessionId || payload.scope !== "workflow-plan") throw new Error("Workflow CLI session capability does not authorize this request.");
    return { principalId: `session:${payload.sessionId}`, workspaceId: payload.workspaceId, callerSessionId: payload.sessionId };
  }
  private now() { return (this.options.now ?? Date.now)(); }
}
export function signWorkflowCliCapability(secret: string, payload: { workspaceId: string; sessionId: string; exp: number }): string {
  const encoded = Buffer.from(JSON.stringify({ ...payload, scope: "workflow-plan" })).toString("base64url");
  return `${encoded}.${createHmac("sha256", secret).update(encoded).digest("base64url")}`;
}
function hash(value: string) { return createHash("sha256").update(value).digest("hex"); }
function constantEqual(a: string, b: string) { const aa = Buffer.from(a), bb = Buffer.from(b); return aa.length === bb.length && timingSafeEqual(aa, bb); }
function readCookie(header: string | null, name: string) { return header?.split(";").map((item) => item.trim().split("=")).find(([key]) => key === name)?.[1] ?? null; }
function isKernelLoopback(request: Request): boolean {
  // @hono/node-server retains the IncomingMessage behind a private symbol.
  // Inspect only its kernel-populated socket address; never trust forwarding headers.
  for (const symbol of Object.getOwnPropertySymbols(request)) {
    const incoming = (request as any)[symbol];
    const address = incoming?.socket?.remoteAddress;
    if (address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1") return true;
  }
  return false;
}
function isLoopbackHost(host: string) { return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1"; }

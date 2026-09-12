import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { WorkflowPlanPrincipal, WorkflowPlanRequest } from "./workflowPlanLaunchService";

export const WORKFLOW_BROWSER_COOKIE = "vd_workflow_plan_session";
export const WORKFLOW_CAPABILITY_AUDIENCE = "vd-workflow-plan";
export const WORKFLOW_CAPABILITY_PURPOSE = "plan-launch";
export type WorkflowRequestAuthContext = { peerAddress: string | undefined };
export class WorkflowPlanAuthorizationError extends Error {}
type CapabilityKey = { keyId: string; generation: number; secret: string };
type BrowserSession = { principalId: string; csrfHash: string; origin: string; expiresAt: number };

/**
 * A VK capability authorizes one agent process to plan and launch for one
 * workspace/session pair. Its random token ID is part of the issued-plan
 * principal, so another capability cannot claim that plan. Rotation may retain
 * an old key only until its short-lived capabilities expire. Durable external
 * exactly-once reconciliation remains owned by 9cx7.21.
 */
export class WorkflowPlanAuthService {
  private readonly browserSessions = new Map<string, BrowserSession>();
  constructor(private readonly options: { cliCapabilityKey?: CapabilityKey; browserOrigin?: string; now?: () => number; browserTtlMs?: number }) {}

  issueBrowserSession(request: Request, context: WorkflowRequestAuthContext) {
    this.requireLocalBrowserRequest(request, context);
    const origin = this.canonicalBrowserOrigin();
    const priorSessionId = readCookie(request.headers.get("cookie"), WORKFLOW_BROWSER_COOKIE);
    if (priorSessionId) this.browserSessions.delete(priorSessionId);
    const now = this.now();
    for (const [id, session] of this.browserSessions) if (session.expiresAt <= now) this.browserSessions.delete(id);
    const sessionId = randomBytes(32).toString("base64url");
    const csrfToken = randomBytes(32).toString("base64url");
    const expiresAt = now + (this.options.browserTtlMs ?? 900_000);
    this.browserSessions.set(sessionId, { principalId: `browser:${randomBytes(24).toString("base64url")}`, csrfHash: hash(csrfToken), origin, expiresAt });
    return { cookie: `${WORKFLOW_BROWSER_COOKIE}=${sessionId}; HttpOnly; SameSite=Strict; Path=/dashboard/api/workflows/plan; Max-Age=${Math.floor((this.options.browserTtlMs ?? 900_000) / 1000)}`, csrfToken, expiresAt };
  }

  async authenticate(request: Request, plan: WorkflowPlanRequest, context: WorkflowRequestAuthContext): Promise<WorkflowPlanPrincipal> {
    const capability = request.headers.get("x-vk-workflow-session-capability");
    if (capability) return this.verifyCliCapability(capability, plan);
    this.requireLocalBrowserRequest(request, context);
    const sessionId = readCookie(request.headers.get("cookie"), WORKFLOW_BROWSER_COOKIE);
    const csrf = request.headers.get("x-vd-workflow-csrf") ?? "";
    const session = sessionId ? this.browserSessions.get(sessionId) : undefined;
    if (!session || session.expiresAt <= this.now() || !constantEqual(hash(csrf), session.csrfHash)) throw authError("Workflow browser session authorization failed.");
    const origin = this.canonicalBrowserOrigin();
    if (origin !== session.origin || request.headers.get("sec-fetch-site") === "cross-site") throw authError("Workflow request origin is not authorized.");
    if (plan.completionResponse) throw authError("Browser workflow requests cannot claim a caller session.");
    return { principalId: session.principalId, workspaceId: plan.workspaceId, callerSessionId: null };
  }

  verifyCliCapability(token: string, plan: WorkflowPlanRequest): WorkflowPlanPrincipal {
    const [encoded, signature] = token.split(".");
    if (!encoded || !signature) throw invalidCapability();
    let payload: any;
    try { payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")); } catch { throw invalidCapability(); }
    const configuredKey = this.options.cliCapabilityKey;
    const key = configuredKey && configuredKey.keyId === payload.kid && configuredKey.generation === payload.generation ? configuredKey : undefined;
    if (!key || key.secret.length < 32 || !constantEqual(createHmac("sha256", key.secret).update(encoded).digest("base64url"), signature)) throw invalidCapability();
    const now = this.now();
    if (payload.v !== 1 || payload.aud !== WORKFLOW_CAPABILITY_AUDIENCE || payload.purpose !== WORKFLOW_CAPABILITY_PURPOSE || typeof payload.jti !== "string" || payload.jti.length < 16 || !Number.isFinite(payload.iat) || !Number.isFinite(payload.exp) || payload.iat > now + 30_000 || payload.exp <= now || payload.exp - payload.iat > 300_000 || payload.workspaceId !== plan.workspaceId || payload.sessionId !== plan.completionResponse?.sessionId) throw authError("Workflow CLI session capability does not authorize this request.");
    return { principalId: `session:${payload.sessionId}:cap:${payload.kid}:${payload.generation}:${payload.jti}`, workspaceId: payload.workspaceId, callerSessionId: payload.sessionId };
  }
  private canonicalBrowserOrigin(): string {
    const configured = canonicalOrigin(this.options.browserOrigin ?? null);
    if (!configured || configured !== this.options.browserOrigin || !isLoopbackHost(new URL(configured).hostname)) throw authError("Local workflow browser authorization is not configured.");
    return configured;
  }
  private requireLocalBrowserRequest(request: Request, context: WorkflowRequestAuthContext): void {
    requireLoopback(context.peerAddress);
    const configured = this.canonicalBrowserOrigin();
    if (canonicalOrigin(request.url) !== configured || canonicalOrigin(request.headers.get("origin")) !== configured || request.headers.get("host") !== new URL(configured).host) throw authError("Workflow request origin is not authorized.");
    for (const name of request.headers.keys()) if (name === "forwarded" || name === "via" || name === "x-real-ip" || name === "x-original-url" || name === "x-rewrite-url" || name.startsWith("x-forwarded-")) throw authError("Proxy browser requests are not supported.");
  }
  private now() { return (this.options.now ?? Date.now)(); }
}

export type WorkflowCliCapabilityPayload = { v: 1; aud: typeof WORKFLOW_CAPABILITY_AUDIENCE; purpose: typeof WORKFLOW_CAPABILITY_PURPOSE; kid: string; generation: number; jti: string; iat: number; exp: number; workspaceId: string; sessionId: string };
export function signWorkflowCliCapability(secret: string, payload: WorkflowCliCapabilityPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${createHmac("sha256", secret).update(encoded).digest("base64url")}`;
}
function invalidCapability() { return authError("Workflow CLI session capability is invalid."); }
function authError(message: string) { return new WorkflowPlanAuthorizationError(message); }
function hash(value: string) { return createHash("sha256").update(value).digest("hex"); }
function constantEqual(a: string, b: string) { const aa = Buffer.from(a), bb = Buffer.from(b); return aa.length === bb.length && timingSafeEqual(aa, bb); }
function readCookie(header: string | null, name: string) { return header?.split(";").map((item) => item.trim().split("=")).find(([key]) => key === name)?.[1] ?? null; }
function canonicalOrigin(value: string | null): string | null { try { return value ? new URL(value).origin : null; } catch { return null; } }
function requireLoopback(address: string | undefined) { if (!address || !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address)) throw authError("A verified local connection is required."); }
function isLoopbackHost(host: string) { return host === "127.0.0.1" || host === "::1" || host === "[::1]"; }

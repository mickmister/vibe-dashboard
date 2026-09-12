import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { WorkflowPlanPrincipal, WorkflowPlanRequest } from "./workflowPlanLaunchService";

export const WORKFLOW_BROWSER_COOKIE = "vd_workflow_plan_session";
export const WORKFLOW_CAPABILITY_AUDIENCE = "vd-workflow-plan";
export const WORKFLOW_CAPABILITY_PURPOSE = "plan-launch";
export type WorkflowRequestAuthContext = { peerAddress: string | undefined; serverOrigin: string };
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
  constructor(private readonly options: { cliCapabilityKeys?: CapabilityKey[]; now?: () => number; browserTtlMs?: number }) {}

  issueBrowserSession(request: Request, context: WorkflowRequestAuthContext) {
    requireLoopback(context.peerAddress);
    const origin = canonicalOrigin(request.headers.get("origin"));
    if (!origin || origin !== context.serverOrigin) throw new Error("Workflow request origin is not authorized.");
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
    requireLoopback(context.peerAddress);
    const sessionId = readCookie(request.headers.get("cookie"), WORKFLOW_BROWSER_COOKIE);
    const csrf = request.headers.get("x-vd-workflow-csrf") ?? "";
    const session = sessionId ? this.browserSessions.get(sessionId) : undefined;
    if (!session || session.expiresAt <= this.now() || !constantEqual(hash(csrf), session.csrfHash)) throw new Error("Workflow browser session authorization failed.");
    const origin = canonicalOrigin(request.headers.get("origin"));
    if (!origin || origin !== context.serverOrigin || origin !== session.origin || request.headers.get("sec-fetch-site") === "cross-site") throw new Error("Workflow request origin is not authorized.");
    if (plan.completionResponse) throw new Error("Browser workflow requests cannot claim a caller session.");
    return { principalId: session.principalId, workspaceId: plan.workspaceId, callerSessionId: null };
  }

  verifyCliCapability(token: string, plan: WorkflowPlanRequest): WorkflowPlanPrincipal {
    const [encoded, signature] = token.split(".");
    if (!encoded || !signature) throw invalidCapability();
    let payload: any;
    try { payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")); } catch { throw invalidCapability(); }
    const key = this.options.cliCapabilityKeys?.find((candidate) => candidate.keyId === payload.kid && candidate.generation === payload.generation);
    if (!key || key.secret.length < 32 || !constantEqual(createHmac("sha256", key.secret).update(encoded).digest("base64url"), signature)) throw invalidCapability();
    const now = this.now();
    if (payload.v !== 1 || payload.aud !== WORKFLOW_CAPABILITY_AUDIENCE || payload.purpose !== WORKFLOW_CAPABILITY_PURPOSE || typeof payload.jti !== "string" || payload.jti.length < 16 || !Number.isFinite(payload.iat) || !Number.isFinite(payload.exp) || payload.iat > now + 30_000 || payload.exp <= now || payload.exp - payload.iat > 300_000 || payload.workspaceId !== plan.workspaceId || payload.sessionId !== plan.completionResponse?.sessionId) throw new Error("Workflow CLI session capability does not authorize this request.");
    return { principalId: `session:${payload.sessionId}:cap:${payload.kid}:${payload.generation}:${payload.jti}`, workspaceId: payload.workspaceId, callerSessionId: payload.sessionId };
  }
  private now() { return (this.options.now ?? Date.now)(); }
}

export type WorkflowCliCapabilityPayload = { v: 1; aud: typeof WORKFLOW_CAPABILITY_AUDIENCE; purpose: typeof WORKFLOW_CAPABILITY_PURPOSE; kid: string; generation: number; jti: string; iat: number; exp: number; workspaceId: string; sessionId: string };
export function signWorkflowCliCapability(secret: string, payload: WorkflowCliCapabilityPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${createHmac("sha256", secret).update(encoded).digest("base64url")}`;
}
function invalidCapability() { return new Error("Workflow CLI session capability is invalid."); }
function hash(value: string) { return createHash("sha256").update(value).digest("hex"); }
function constantEqual(a: string, b: string) { const aa = Buffer.from(a), bb = Buffer.from(b); return aa.length === bb.length && timingSafeEqual(aa, bb); }
function readCookie(header: string | null, name: string) { return header?.split(";").map((item) => item.trim().split("=")).find(([key]) => key === name)?.[1] ?? null; }
function canonicalOrigin(value: string | null): string | null { try { return value ? new URL(value).origin : null; } catch { return null; } }
function requireLoopback(address: string | undefined) { if (!address || !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address)) throw new Error("A verified local connection is required."); }

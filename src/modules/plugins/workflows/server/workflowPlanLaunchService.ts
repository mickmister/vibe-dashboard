import { createHash } from "node:crypto";
import type { GasCityExecutionBundleCompileInput, CompiledGasCityExecutionBundle } from "./gasCityExecutionBundleCompiler";
import type { DbWorkflowPlanStore } from "./workflowPlanStore";

export interface WorkflowPlanPrincipal { principalId: string; workspaceId: string; callerSessionId?: string | null }
export interface WorkflowRoleBinding { mode: "existing" | "create" | "create_or_reuse"; sessionId?: string; name?: string; executorType?: string; model?: string; reasoningId?: string }

export interface WorkflowPlanRequest {
  workspaceId: string;
  designId: string;
  version?: number | null;
  inputs: Record<string, unknown>;
  roleBindings: Record<string, WorkflowRoleBinding>;
  beadIds: string[];
  completionResponse?: { sessionId: string; source: "vibe-agent-cli" } | null;
}

export interface WorkflowAuthoritativePlanInput {
  compileInput: GasCityExecutionBundleCompileInput;
  workflowLabel: string;
  tasks: Array<{ id: string; title: string; structuralRevision: string }>;
  repositories: Array<{ id: string; accessRevision: string; mode: "read" | "write" }>;
  securityPolicyRevision: string;
}

export interface WorkflowPlan {
  schemaVersion: "vd.workflow-plan.v1";
  digest: string;
  bundleDigest: string;
  workspaceId: string;
  workflow: { designId: string; version: number; label: string };
  tasks: Array<{ id: string; title: string }>;
  repositories: Array<{ id: string; mode: "read" | "write" }>;
  summary: string;
  expiresAt: number;
}

export type WorkflowPlanLaunchResult =
  | { status: "launched" | "reused"; plan: WorkflowPlan; run: { runId: string; status: string; url: string } }
  | { status: "stale"; plan: WorkflowPlan; changed: string[]; message: string }
  | { status: "waiting"; plan: WorkflowPlan; message: string };

export interface WorkflowPlanSource {
  resolve(request: WorkflowPlanRequest): Promise<WorkflowAuthoritativePlanInput>;
}
export interface WorkflowBundleCompiler {
  compile(input: GasCityExecutionBundleCompileInput): Promise<CompiledGasCityExecutionBundle>;
}
export interface WorkflowNativeLaunchProvider {
  checkDynamic(plan: WorkflowPlan): Promise<{ ready: boolean; message?: string }>;
  launch(input: { request: WorkflowPlanRequest; plan: WorkflowPlan; bundle: CompiledGasCityExecutionBundle; idempotencyKey: string }): Promise<{ runId: string; status: string; url: string; reused?: boolean }>;
  reconcile(idempotencyKey: string): Promise<{ outcome: "found"; run: { runId: string; status: string; url: string; reused?: boolean } } | { outcome: "not_found" | "unknown" }>;
}

export class WorkflowPlanLaunchService {
  constructor(private readonly options: { source: WorkflowPlanSource; compiler: WorkflowBundleCompiler; launcher: WorkflowNativeLaunchProvider; store: Pick<DbWorkflowPlanStore, "issue" | "requireIssued" | "claimLaunch" | "complete" | "fail">; now?: () => number; ttlMs?: number }) {}

  async plan(request: WorkflowPlanRequest, principal: WorkflowPlanPrincipal): Promise<WorkflowPlan> {
    validateRequest(request);
    validatePrincipal(request, principal);
    const resolved = await this.options.source.resolve(clone(request));
    const bundle = await this.options.compiler.compile(resolved.compileInput);
    const plan = makePlan(request, resolved, bundle, this.now(), this.options.ttlMs ?? 300_000);
    await this.options.store.issue(principal, request, plan);
    return plan;
  }

  async launch(request: WorkflowPlanRequest, confirmedDigest: string, principal: WorkflowPlanPrincipal): Promise<WorkflowPlanLaunchResult> {
    validateRequest(request);
    validatePrincipal(request, principal);
    if (!/^[a-f0-9]{64}$/.test(confirmedDigest)) throw new Error("A current plan digest is required.");
    const issued = await this.options.store.requireIssued(principal, request, confirmedDigest);
    const resolved = await this.options.source.resolve(clone(request));
    const bundle = await this.options.compiler.compile(resolved.compileInput);
    const current = makePlan(request, resolved, bundle, this.now(), this.options.ttlMs ?? 300_000);
    if (current.digest !== confirmedDigest) {
      await this.options.store.issue(principal, request, current);
      return { status: "stale", plan: current, changed: staleChanges(JSON.parse(issued.planJson), current), message: "The plan changed. Nothing was started." };
    }
    const dynamic = await this.options.launcher.checkDynamic(current);
    if (!dynamic.ready) return { status: "waiting", plan: current, message: safe(dynamic.message || "Work is waiting for available capacity.") };
    const idempotencyKey = hash({ digest: confirmedDigest, workspaceId: request.workspaceId, designId: request.designId });
    let claim = await this.options.store.claimLaunch(issued.planId, idempotencyKey, hash(request));
    if (claim.state === "launched") return { status: "reused", plan: current, run: safeRun(claim.result) };
    if (claim.state === "pending") return { status: "waiting", plan: current, message: "This plan is already starting." };
    if (claim.state === "reconcile_required") {
      const reconciliation = await this.options.launcher.reconcile(idempotencyKey);
      if (reconciliation.outcome === "unknown") return { status: "waiting", plan: current, message: "The earlier start outcome cannot be confirmed. No replacement work was started." };
      claim = await this.options.store.claimLaunch(issued.planId, idempotencyKey, hash(request), reconciliation.outcome);
      if (claim.state !== "claimed") return { status: "waiting", plan: current, message: "This plan is already being reconciled." };
      if (reconciliation.outcome === "found") {
        await this.options.store.complete(issued.planId, idempotencyKey, claim.fence, reconciliation.run);
        return { status: "reused", plan: current, run: safeRun(reconciliation.run) };
      }
    }
    if (claim.state !== "claimed") return { status: "waiting", plan: current, message: "This plan is already starting." };
    // An exception can occur after the provider performed its durable effect.
    // Keep the claim pending so expiry always requires provider reconciliation;
    // only an explicit, proven pre-effect failure may transition to failed.
    const run = await this.options.launcher.launch({ request: clone(request), plan: current, bundle, idempotencyKey });
    await this.options.store.complete(issued.planId, idempotencyKey, claim.fence, run);
    return { status: run.reused ? "reused" : "launched", plan: current, run: safeRun(run) };
  }

  private now(): number { return (this.options.now ?? Date.now)(); }
}

function makePlan(request: WorkflowPlanRequest, resolved: WorkflowAuthoritativePlanInput, bundle: CompiledGasCityExecutionBundle, now: number, ttl: number): WorkflowPlan {
  const expiresAt = (Math.floor(now / ttl) + 1) * ttl;
  const identity = {
    bundleDigest: bundle.digest,
    workspaceId: request.workspaceId,
    workflow: { designId: request.designId, version: resolved.compileInput.workflow.version },
    taskOrder: resolved.tasks.map((item) => ({ id: item.id, structuralRevision: item.structuralRevision })),
    repositories: [...resolved.repositories].sort((a, b) => a.id.localeCompare(b.id)),
    securityPolicyRevision: resolved.securityPolicyRevision,
    requestPolicy: { inputs: request.inputs, roleBindings: request.roleBindings, completionResponse: request.completionResponse ?? null },
    expiresAt,
  };
  return {
    schemaVersion: "vd.workflow-plan.v1", digest: hash(identity), bundleDigest: bundle.digest,
    workspaceId: safeId(request.workspaceId), workflow: { designId: safeId(request.designId), version: resolved.compileInput.workflow.version, label: safe(resolved.workflowLabel) },
    tasks: resolved.tasks.map((item) => ({ id: safeId(item.id), title: safe(item.title) })),
    repositories: resolved.repositories.map((item) => ({ id: safeId(item.id), mode: item.mode })),
    summary: `${resolved.tasks.length} task${resolved.tasks.length === 1 ? "" : "s"}; ${resolved.repositories.length} repositor${resolved.repositories.length === 1 ? "y" : "ies"}.`,
    expiresAt,
  };
}
function validateRequest(value: WorkflowPlanRequest): void {
  if (!value || !value.workspaceId?.trim()) throw new Error("Workspace is required.");
  if (!value.designId?.trim()) throw new Error("Workflow is required.");
  if (!Array.isArray(value.beadIds) || new Set(value.beadIds).size !== value.beadIds.length) throw new Error("Task list contains duplicates.");
  const allowed = new Set(["workspaceId", "designId", "version", "inputs", "roleBindings", "beadIds", "completionResponse"]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error("The plan contains an unsupported setting.");
  for (const [roleId, binding] of Object.entries(value.roleBindings ?? {})) {
    if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(roleId) || !binding || typeof binding !== "object" || Array.isArray(binding)) throw new Error("A role setting is invalid.");
    for (const key of Object.keys(binding)) if (!["mode", "sessionId", "name", "executorType", "model", "reasoningId"].includes(key)) throw new Error("A role setting is not supported.");
    for (const field of Object.values(binding)) if (field !== undefined && (typeof field !== "string" || !field.trim())) throw new Error("A role setting is invalid.");
    if (!["existing", "create", "create_or_reuse"].includes(binding.mode)) throw new Error("A role session mode is required.");
    if (binding.mode === "existing" && (!binding.sessionId || binding.name)) throw new Error("An existing role requires only a session id.");
    if (binding.mode === "existing" && (binding.executorType || binding.model || binding.reasoningId)) throw new Error("Existing role preferences require session compatibility validation and are not supported during planning yet.");
    if ((binding.mode === "create" || binding.mode === "create_or_reuse") && (!binding.name || binding.sessionId)) throw new Error("A new role requires only a session name.");
  }
  if (value.completionResponse && (!value.completionResponse.sessionId?.trim() || value.completionResponse.source !== "vibe-agent-cli")) throw new Error("Completion response settings are invalid.");
}
function validatePrincipal(request: WorkflowPlanRequest, principal: WorkflowPlanPrincipal): void { if (!principal.principalId.trim() || principal.workspaceId !== request.workspaceId || (request.completionResponse?.sessionId ?? null) !== (principal.callerSessionId ?? null)) throw new Error("The plan context is not authorized."); }
function safeRun(run: {runId:string;status:string;url:string}) { return { runId: safeId(run.runId), status: safe(run.status), url: safeUrl(run.url) }; }
function staleChanges(oldPlan: WorkflowPlan, next: WorkflowPlan): string[] { const changes: string[] = []; if (oldPlan.bundleDigest !== next.bundleDigest) changes.push("Workflow or role settings changed."); if (JSON.stringify(oldPlan.tasks) !== JSON.stringify(next.tasks)) changes.push("Task content or order changed."); if (JSON.stringify(oldPlan.repositories) !== JSON.stringify(next.repositories)) changes.push("Repository access changed."); if (oldPlan.expiresAt !== next.expiresAt) changes.push("The plan expired."); return (changes.length ? changes : ["Plan policy changed."]).slice(0, 4); }
function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex"); }
function canonical(value: unknown): unknown { if (Array.isArray(value)) return value.map(canonical); if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)])); return value; }
function safe(value: string, max = 240): string { return value.replace(/(?:\/Users|\/tmp|\/private\/var)\/\S+|\b(?:queue[_ -]?item|webhook|provider diagnostics|raw XML|raw JSON)\b/gi, "details unavailable").slice(0, max); }
function safeId(value: string): string { return safe(value, 120).replace(/[^A-Za-z0-9_.:-]/g, "-"); }
function safeUrl(value: string): string { return value.startsWith("/dashboard/") ? value : "/dashboard/workflows"; }
function clone<T>(value: T): T { return structuredClone(value); }

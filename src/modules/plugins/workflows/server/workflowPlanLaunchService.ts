import { createHash } from "node:crypto";
import type { GasCityExecutionBundleCompileInput, CompiledGasCityExecutionBundle } from "./gasCityExecutionBundleCompiler";

export interface WorkflowPlanRequest {
  workspaceId: string;
  designId: string;
  version?: number | null;
  inputs: Record<string, unknown>;
  roleBindings: Record<string, unknown>;
  beadIds: string[];
  effects?: string[];
  additionalInstructions?: string | null;
  laneId?: string | null;
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
}

export class WorkflowPlanLaunchService {
  constructor(private readonly options: { source: WorkflowPlanSource; compiler: WorkflowBundleCompiler; launcher: WorkflowNativeLaunchProvider; now?: () => number; ttlMs?: number }) {}

  async plan(request: WorkflowPlanRequest): Promise<WorkflowPlan> {
    validateRequest(request);
    const resolved = await this.options.source.resolve(clone(request));
    const bundle = await this.options.compiler.compile(resolved.compileInput);
    return makePlan(request, resolved, bundle, this.now(), this.options.ttlMs ?? 300_000);
  }

  async launch(request: WorkflowPlanRequest, confirmedDigest: string): Promise<WorkflowPlanLaunchResult> {
    validateRequest(request);
    if (!/^[a-f0-9]{64}$/.test(confirmedDigest)) throw new Error("A current plan digest is required.");
    const resolved = await this.options.source.resolve(clone(request));
    const bundle = await this.options.compiler.compile(resolved.compileInput);
    const current = makePlan(request, resolved, bundle, this.now(), this.options.ttlMs ?? 300_000);
    if (current.digest !== confirmedDigest) return { status: "stale", plan: current, changed: ["Workflow plan changed. Review the new plan before starting."], message: "The plan changed. Nothing was started." };
    const dynamic = await this.options.launcher.checkDynamic(current);
    if (!dynamic.ready) return { status: "waiting", plan: current, message: safe(dynamic.message || "Work is waiting for available capacity.") };
    const idempotencyKey = hash({ digest: confirmedDigest, workspaceId: request.workspaceId, designId: request.designId });
    const run = await this.options.launcher.launch({ request: clone(request), plan: current, bundle, idempotencyKey });
    return { status: run.reused ? "reused" : "launched", plan: current, run: { runId: safeId(run.runId), status: safe(run.status), url: safeUrl(run.url) } };
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
    requestPolicy: { inputs: request.inputs, roleBindings: request.roleBindings, effects: request.effects ?? [], additionalInstructions: request.additionalInstructions ?? null, laneId: request.laneId ?? null },
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
}
function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex"); }
function canonical(value: unknown): unknown { if (Array.isArray(value)) return value.map(canonical); if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)])); return value; }
function safe(value: string, max = 240): string { return value.replace(/(?:\/Users|\/tmp|\/private\/var)\/\S+|\b(?:queue[_ -]?item|webhook|provider diagnostics|raw XML|raw JSON)\b/gi, "details unavailable").slice(0, max); }
function safeId(value: string): string { return safe(value, 120).replace(/[^A-Za-z0-9_.:-]/g, "-"); }
function safeUrl(value: string): string { return value.startsWith("/dashboard/") ? value : "/dashboard/workflows"; }
function clone<T>(value: T): T { return structuredClone(value); }

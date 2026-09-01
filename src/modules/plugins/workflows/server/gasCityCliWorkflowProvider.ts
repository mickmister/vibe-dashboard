import { execFile, type ExecFileOptions } from "node:child_process";
import { promisify } from "node:util";
import {
  sanitizeGasCityProviderText,
  validateGasCityProviderLaunchRequest,
  type GasCityOpaqueMetadata,
  type GasCityProviderActivitySnapshot,
  type GasCityProviderCapability,
  type GasCityProviderFormulaChoice,
  type GasCityProviderHealth,
  type GasCityProviderLaunchRequest,
  type GasCityProviderLaunchResult,
  type GasCityProviderLaunchTarget,
  type GasCityProviderProductLink,
  type GasCityProviderValidationIssue,
  type GasCityProviderWorkflowReadModel,
  type GasCityProviderWorkflowRef,
  type GasCityWorkflowProvider,
  type GasCityWorkflowProviderContext,
} from "./gasCityWorkflowProvider";

export const DEFAULT_PINNED_GAS_CITY_VERSION = "1.4.1";

export interface GasCityCommandResult {
  stdout: string;
  stderr: string;
}

export interface GasCityCommandRunner {
  execFile(file: string, args: readonly string[], options?: ExecFileOptions): Promise<GasCityCommandResult>;
}

export interface GasCityCliWorkflowProviderOptions {
  gcPath?: string;
  cwd?: string;
  requiredVersion?: string;
  runner?: GasCityCommandRunner;
  now?: () => number;
  targets?: GasCityProviderLaunchTarget[];
  formulas?: GasCityProviderFormulaChoice[];
}

export interface GasCitySlingCommand {
  file: string;
  args: string[];
}

export interface GasCityFormulaShowCommand {
  file: string;
  args: string[];
}

interface CachedLaunch {
  identity: string;
  result: GasCityProviderLaunchResult;
  workflow: GasCityProviderWorkflowReadModel;
}

interface GasCitySlingJsonPayload {
  schema_version?: string;
  success?: boolean;
  target?: string;
  bead_id?: string;
  formula?: string;
  molecule_id?: string;
  workflow_id?: string;
  convoy_id?: string;
  routed?: boolean;
  queued?: boolean;
  dashboard_url?: string;
  warnings?: string[];
}

interface GasCityVersionJsonPayload {
  version?: string;
}

interface GasCityFormulaShowJsonPayload {
  ok?: boolean;
  name?: string;
  contract?: string;
  metadata?: unknown;
  steps?: unknown[];
}

export class GasCityCliWorkflowProvider implements GasCityWorkflowProvider {
  readonly providerId = "gas_city" as const;
  readonly label = "Gas City";
  readonly version: string;

  private readonly gcPath: string;
  private readonly cwd?: string;
  private readonly requiredVersion: string;
  private readonly runner: GasCityCommandRunner;
  private readonly now: () => number;
  private readonly targets: GasCityProviderLaunchTarget[];
  private readonly formulas: GasCityProviderFormulaChoice[];
  private readonly launchesByKey = new Map<string, CachedLaunch>();
  private readonly workflows = new Map<string, GasCityProviderWorkflowReadModel>();

  constructor(options: GasCityCliWorkflowProviderOptions = {}) {
    this.gcPath = options.gcPath ?? process.env.GC_BIN ?? "gc";
    this.cwd = options.cwd;
    this.requiredVersion = options.requiredVersion ?? DEFAULT_PINNED_GAS_CITY_VERSION;
    this.version = `gc ${this.requiredVersion}`;
    this.runner = options.runner ?? defaultGasCityCommandRunner;
    this.now = options.now ?? (() => Date.now());
    this.targets = (options.targets ?? []).map(sanitizeCliTarget);
    this.formulas = (options.formulas ?? []).map(sanitizeCliFormula);
  }

  async getHealth(_context: GasCityWorkflowProviderContext): Promise<GasCityProviderHealth> {
    const checkedAt = this.now();
    try {
      const result = await this.runner.execFile(this.gcPath, ["version", "--json"], commandOptions(this.cwd, 2048));
      const version = readJsonLine<GasCityVersionJsonPayload>(result.stdout)?.version?.trim() ?? "";
      if (version !== this.requiredVersion) {
        return {
          available: false,
          status: "unavailable",
          summary: `Gas City workflow engine must use the pinned ${this.requiredVersion} release.`,
          checkedAt,
          provider: { providerId: this.providerId, label: this.label, version: sanitizeGasCityProviderText(version || "unknown") },
          warnings: ["Gas City workflow engine version does not match the pinned release."],
        };
      }
      return {
        available: true,
        status: "healthy",
        summary: "Gas City workflow engine is available.",
        checkedAt,
        provider: { providerId: this.providerId, label: this.label, version },
        warnings: [],
      };
    } catch (_error) {
      return {
        available: false,
        status: "unavailable",
        summary: "Gas City workflow engine is unavailable.",
        checkedAt,
        provider: { providerId: this.providerId, label: this.label, version: this.requiredVersion },
        warnings: ["Gas City workflow engine could not be checked."],
      };
    }
  }

  async listCapabilities(context: GasCityWorkflowProviderContext): Promise<GasCityProviderCapability[]> {
    return [
      ...(await this.listLaunchTargets(context)).map((target) => ({ id: `target:${target.target}`, label: target.label, kind: "target" as const, description: target.description ?? null, metadata: target.metadata })),
      ...(await this.listFormulaChoices(context)).map((formula) => ({ id: `formula:${formula.formula}`, label: formula.label, kind: "formula" as const, description: formula.description ?? null, metadata: formula.metadata })),
    ];
  }

  async listLaunchTargets(_context: GasCityWorkflowProviderContext): Promise<GasCityProviderLaunchTarget[]> {
    return this.targets.map((target) => ({ ...target, metadata: copyMetadata(target.metadata) }));
  }

  async listFormulaChoices(_context: GasCityWorkflowProviderContext): Promise<GasCityProviderFormulaChoice[]> {
    return this.formulas.map((formula) => ({ ...formula, metadata: copyMetadata(formula.metadata) }));
  }

  async validateLaunch(input: GasCityProviderLaunchRequest): Promise<GasCityProviderValidationIssue[]> {
    const base = validateGasCityProviderLaunchRequest(input, {
      available: true,
      targets: this.targets.length > 0 ? this.targets : undefined,
      formulas: this.formulas.length > 0 ? this.formulas : undefined,
    });
    if (base.length > 0) return base;

    const pinned = await this.checkPinnedVersion();
    if (!pinned.ok) {
      return [{ code: "GAS_CITY_PROVIDER_UNAVAILABLE", path: "provider", message: pinned.message }];
    }

    const formula = this.formulas.find((candidate) => candidate.formula === input.formula.trim());
    if (formula?.contract === "graph.v2") return [];

    const valid = await this.validateFormulaWithPinnedGc(input.formula.trim());
    if (!valid.ok) {
      return [{ code: "GAS_CITY_FORMULA_UNSUPPORTED", path: "formula", message: valid.message }];
    }
    return [];
  }

  async launchSourceWorkflow(input: GasCityProviderLaunchRequest): Promise<GasCityProviderLaunchResult> {
    const idempotencyKey = input.idempotencyKey.trim();
    const identity = launchIdentity(input);
    const existing = this.launchesByKey.get(idempotencyKey);
    if (existing) {
      if (existing.identity !== identity) {
        return blockedLaunch(input, "This launch key already belongs to a different Gas City workflow request.", this.now());
      }
      return { ...existing.result, status: existing.result.status === "accepted" ? "already_running" : existing.result.status };
    }

    const issues = await this.validateLaunch(input);
    if (issues.length > 0) {
      return blockedLaunch(input, issues[0]?.message ?? "Gas City launch is not available.", this.now());
    }

    try {
      const command = buildGasCitySlingCommand({ gcPath: this.gcPath, launch: input });
      const result = await this.runner.execFile(command.file, command.args, commandOptions(this.cwd, 64 * 1024));
      const payload = readJsonLine<GasCitySlingJsonPayload>(result.stdout);
      if (!payload?.success) {
        return blockedLaunch(input, "Gas City did not accept the workflow launch.", this.now());
      }
      const launch = launchResultFromSlingPayload(input, payload, this.now());
      const workflow = readModelFromLaunch(input, launch, payload, this.now());
      this.launchesByKey.set(idempotencyKey, { identity, result: launch, workflow });
      this.workflows.set(workflowKey(launch.workflowRef), workflow);
      return launch;
    } catch (_error) {
      return blockedLaunch(input, "Gas City workflow launch failed before it was accepted.", this.now());
    }
  }

  async getWorkflow(ref: GasCityProviderWorkflowRef): Promise<GasCityProviderWorkflowReadModel | null> {
    const workflow = this.workflows.get(workflowKey(ref));
    return workflow ? cloneWorkflow(workflow) : null;
  }

  async listWorkflows(context: GasCityWorkflowProviderContext): Promise<GasCityProviderWorkflowReadModel[]> {
    return [...this.workflows.values()]
      .filter((workflow) => workflow.workflowRef.workspaceId === context.workspaceId.trim())
      .map(cloneWorkflow);
  }

  async getActivity(context: GasCityWorkflowProviderContext): Promise<GasCityProviderActivitySnapshot> {
    return {
      providerId: this.providerId,
      workspaceId: sanitizeId(context.workspaceId),
      generatedAt: this.now(),
      workflows: await this.listWorkflows(context),
      warnings: [],
    };
  }

  private async validateFormulaWithPinnedGc(formula: string): Promise<{ ok: true } | { ok: false; message: string }> {
    try {
      const command = buildGasCityFormulaShowCommand({ gcPath: this.gcPath, formula });
      const result = await this.runner.execFile(command.file, command.args, commandOptions(this.cwd, 64 * 1024));
      const payload = readJsonLine<GasCityFormulaShowJsonPayload>(result.stdout);
      if (payload && payload.ok === false) {
        return { ok: false, message: "Gas City could not validate this graph.v2 formula." };
      }
      return { ok: true };
    } catch (_error) {
      return { ok: false, message: "Gas City could not validate this graph.v2 formula." };
    }
  }

  private async checkPinnedVersion(): Promise<{ ok: true } | { ok: false; message: string }> {
    try {
      const result = await this.runner.execFile(this.gcPath, ["version", "--json"], commandOptions(this.cwd, 2048));
      const version = readJsonLine<GasCityVersionJsonPayload>(result.stdout)?.version?.trim() ?? "";
      if (version !== this.requiredVersion) {
        return { ok: false, message: `Gas City workflow engine must use the pinned ${this.requiredVersion} release.` };
      }
      return { ok: true };
    } catch (_error) {
      return { ok: false, message: "Gas City workflow engine is unavailable." };
    }
  }
}

export function buildGasCitySlingCommand(input: { gcPath?: string; launch: GasCityProviderLaunchRequest }): GasCitySlingCommand {
  const launch = input.launch;
  const args = ["sling", launch.target.trim(), launch.sourceBeadId.trim(), "--on", launch.formula.trim(), "--json"];
  const vars = Object.entries(launch.vars ?? {}).sort(([left], [right]) => left.localeCompare(right));
  for (const [key, value] of vars) {
    args.push("--var", `${key}=${value}`);
  }
  if (launch.nudge) args.push("--nudge");
  return { file: input.gcPath ?? process.env.GC_BIN ?? "gc", args };
}

export function buildGasCityFormulaShowCommand(input: { gcPath?: string; formula: string }): GasCityFormulaShowCommand {
  return { file: input.gcPath ?? process.env.GC_BIN ?? "gc", args: ["formula", "show", input.formula.trim(), "--json"] };
}

const defaultGasCityCommandRunner: GasCityCommandRunner = {
  async execFile(file, args, options) {
    const execFileAsync = promisify(execFile);
    const result = await execFileAsync(file, [...args], { ...options, encoding: "utf8" });
    return { stdout: String(result.stdout ?? ""), stderr: String(result.stderr ?? "") };
  },
};

function commandOptions(cwd: string | undefined, maxBuffer: number): ExecFileOptions {
  return { cwd, timeout: 30_000, maxBuffer };
}

function launchResultFromSlingPayload(input: GasCityProviderLaunchRequest, payload: GasCitySlingJsonPayload, now: number): GasCityProviderLaunchResult {
  const workflowRef = workflowRefFromPayload(input, payload);
  return {
    providerId: "gas_city",
    status: "accepted",
    workflowRef,
    summary: "Gas City accepted the workflow launch.",
    productLinks: productLinksFromPayload(input, payload),
    diagnosticsRef: `gas-city-launch:${shortHash(input.idempotencyKey.trim())}`,
    metadata: metadataFromPayload(payload, now),
  };
}

function readModelFromLaunch(input: GasCityProviderLaunchRequest, launch: GasCityProviderLaunchResult, payload: GasCitySlingJsonPayload, now: number): GasCityProviderWorkflowReadModel {
  return {
    providerId: "gas_city",
    workflowRef: launch.workflowRef,
    sourceBead: {
      id: launch.workflowRef.sourceBeadId,
      title: launch.workflowRef.sourceBeadId,
      status: "open",
    },
    status: "running",
    currentOwner: launch.workflowRef.target,
    currentStage: launch.workflowRef.formula,
    nextAction: "Gas City is coordinating this workflow.",
    progress: null,
    updatedAt: now,
    productLinks: productLinksFromPayload(input, payload),
    warnings: (payload.warnings ?? []).map((warning) => sanitizeGasCityProviderText(warning)),
    metadata: launch.metadata,
  };
}

function workflowRefFromPayload(input: GasCityProviderLaunchRequest, payload: GasCitySlingJsonPayload): GasCityProviderWorkflowRef {
  return {
    providerId: "gas_city",
    workspaceId: sanitizeId(input.context.workspaceId),
    sourceBeadId: sanitizeId(payload.bead_id ?? input.sourceBeadId),
    target: sanitizeId(payload.target ?? input.target),
    formula: sanitizeId(payload.formula ?? input.formula),
    rootBeadId: payload.molecule_id ? sanitizeId(payload.molecule_id) : payload.convoy_id ? sanitizeId(payload.convoy_id) : null,
    workflowId: payload.workflow_id ? sanitizeId(payload.workflow_id) : null,
  };
}

function productLinksFromPayload(input: GasCityProviderLaunchRequest, payload: GasCitySlingJsonPayload): GasCityProviderProductLink[] {
  const links: GasCityProviderProductLink[] = [{ label: "Open source bead", href: `#bead-${encodeURIComponent(input.sourceBeadId.trim())}`, kind: "bead" }];
  if (payload.dashboard_url && isProductSafeHref(payload.dashboard_url)) {
    links.push({ label: "Open Gas City workflow", href: payload.dashboard_url, kind: "dashboard" });
  }
  return links;
}

function metadataFromPayload(payload: GasCitySlingJsonPayload, now: number): GasCityOpaqueMetadata {
  const metadata: Record<string, string | number | boolean | null> = {
    acceptedAt: now,
    routed: payload.routed === true,
    targetNotified: payload.queued === true,
  };
  if (payload.convoy_id) metadata.convoyId = sanitizeId(payload.convoy_id);
  return metadata;
}

function blockedLaunch(input: GasCityProviderLaunchRequest, message: string, now: number): GasCityProviderLaunchResult {
  return {
    providerId: "gas_city",
    status: "blocked",
    workflowRef: {
      providerId: "gas_city",
      workspaceId: sanitizeId(input.context.workspaceId),
      sourceBeadId: sanitizeId(input.sourceBeadId),
      target: sanitizeId(input.target),
      formula: sanitizeId(input.formula),
      rootBeadId: null,
      workflowId: null,
    },
    summary: sanitizeGasCityProviderText(message, "Gas City launch is not available."),
    productLinks: [],
    diagnosticsRef: input.idempotencyKey.trim() ? `gas-city-launch:${shortHash(input.idempotencyKey.trim())}` : null,
    metadata: { checkedAt: now },
  };
}

function launchIdentity(input: GasCityProviderLaunchRequest): string {
  return stableJson({
    workspaceId: input.context.workspaceId.trim(),
    sourceBeadId: input.sourceBeadId.trim(),
    target: input.target.trim(),
    formula: input.formula.trim(),
    vars: input.vars ?? {},
    nudge: input.nudge === true,
  });
}

function readJsonLine<T>(stdout: string): T | null {
  const line = stdout.split(/\r?\n/u).map((candidate) => candidate.trim()).find((candidate) => candidate.startsWith("{") && candidate.endsWith("}"));
  if (!line) return null;
  try {
    return JSON.parse(line) as T;
  } catch {
    return null;
  }
}

function sanitizeCliTarget(target: GasCityProviderLaunchTarget): GasCityProviderLaunchTarget {
  return {
    target: sanitizeId(target.target),
    label: sanitizeGasCityProviderText(target.label, target.target),
    description: target.description == null ? null : sanitizeGasCityProviderText(target.description),
    metadata: copyMetadata(target.metadata),
  };
}

function sanitizeCliFormula(formula: GasCityProviderFormulaChoice): GasCityProviderFormulaChoice {
  return {
    formula: sanitizeId(formula.formula),
    label: sanitizeGasCityProviderText(formula.label, formula.formula),
    contract: formula.contract === "graph.v2" ? "graph.v2" : "unknown",
    description: formula.description == null ? null : sanitizeGasCityProviderText(formula.description),
    metadata: copyMetadata(formula.metadata),
  };
}

function cloneWorkflow(workflow: GasCityProviderWorkflowReadModel): GasCityProviderWorkflowReadModel {
  return {
    ...workflow,
    workflowRef: { ...workflow.workflowRef },
    sourceBead: { ...workflow.sourceBead },
    progress: workflow.progress ? { ...workflow.progress } : null,
    productLinks: workflow.productLinks.map((link) => ({ ...link })),
    warnings: [...workflow.warnings],
    metadata: copyMetadata(workflow.metadata),
  };
}

function copyMetadata(metadata: GasCityOpaqueMetadata | undefined): GasCityOpaqueMetadata | undefined {
  return metadata ? { ...metadata } : undefined;
}

function isProductSafeHref(href: string): boolean {
  return /^(?:https?:\/\/|\/|#)/i.test(href) && !/\/Users\/|\/private\/var\/|\/tmp\//i.test(href);
}

function workflowKey(ref: GasCityProviderWorkflowRef): string {
  return [ref.workspaceId, ref.sourceBeadId, ref.target, ref.formula, ref.workflowId ?? ""].join("\u0000");
}

function sanitizeId(value: string): string {
  return value.trim().slice(0, 160);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function shortHash(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(16).padStart(8, "0").slice(0, 8);
}

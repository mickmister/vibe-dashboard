export type GasCityProviderWorkflowStatus =
  | "pending"
  | "running"
  | "waiting"
  | "blocked"
  | "completed"
  | "failed"
  | "unknown";

export type GasCityProviderLaunchStatus =
  | "accepted"
  | "already_running"
  | "blocked";

export interface GasCityWorkflowProviderContext {
  /**
   * VK workspace id. VD Workflows and VK share the same workspace identity; this
   * must not be interpreted as a separate VD-only workspace id.
   */
  workspaceId: string;
  vkSessionId?: string | null;
  currentBeadIds?: string[];
  userId?: string | null;
}

export interface GasCityProviderHealth {
  available: boolean;
  status: "healthy" | "unconfigured" | "unavailable";
  summary: string;
  checkedAt: number;
  provider: {
    providerId: "gas_city";
    label: string;
    version: string;
  };
  warnings: string[];
}

export interface GasCityProviderCapability {
  id: string;
  label: string;
  kind: "formula" | "target" | "session" | "order" | "dashboard";
  description?: string | null;
  metadata?: GasCityOpaqueMetadata;
}

export interface GasCityProviderLaunchTarget {
  target: string;
  label: string;
  description?: string | null;
  metadata?: GasCityOpaqueMetadata;
}

export interface GasCityProviderFormulaChoice {
  formula: string;
  label: string;
  contract: "graph.v2" | "unknown";
  description?: string | null;
  metadata?: GasCityOpaqueMetadata;
}

export interface GasCityProviderLaunchRequest {
  context: GasCityWorkflowProviderContext;
  sourceBeadId: string;
  target: string;
  formula: string;
  vars?: Record<string, string>;
  nudge?: boolean;
  idempotencyKey: string;
}

export interface GasCityProviderWorkflowRef {
  providerId: "gas_city";
  workspaceId: string;
  sourceBeadId: string;
  target: string;
  formula: string;
  rootBeadId?: string | null;
  workflowId?: string | null;
}

export interface GasCityProviderLaunchResult {
  providerId: "gas_city";
  status: GasCityProviderLaunchStatus;
  workflowRef: GasCityProviderWorkflowRef;
  summary: string;
  productLinks: GasCityProviderProductLink[];
  diagnosticsRef?: string | null;
  metadata?: GasCityOpaqueMetadata;
}

export interface GasCityProviderProductLink {
  label: string;
  href: string;
  kind: "workflow" | "bead" | "session" | "dashboard";
}

export interface GasCityProviderWorkflowReadModel {
  providerId: "gas_city";
  workflowRef: GasCityProviderWorkflowRef;
  sourceBead: {
    id: string;
    title: string;
    status: string;
  };
  status: GasCityProviderWorkflowStatus;
  currentOwner?: string | null;
  currentStage?: string | null;
  nextAction?: string | null;
  progress?: {
    total: number;
    completed: number;
    running: number;
    blocked: number;
  } | null;
  updatedAt?: number | null;
  productLinks: GasCityProviderProductLink[];
  warnings: string[];
  metadata?: GasCityOpaqueMetadata;
}

export interface GasCityProviderActivitySnapshot {
  providerId: "gas_city";
  workspaceId: string;
  generatedAt: number;
  workflows: GasCityProviderWorkflowReadModel[];
  warnings: string[];
}

export interface GasCityProviderValidationIssue {
  code:
    | "GAS_CITY_PROVIDER_UNAVAILABLE"
    | "GAS_CITY_WORKSPACE_REQUIRED"
    | "GAS_CITY_SOURCE_BEAD_REQUIRED"
    | "GAS_CITY_TARGET_REQUIRED"
    | "GAS_CITY_FORMULA_REQUIRED"
    | "GAS_CITY_FORMULA_UNSUPPORTED"
    | "GAS_CITY_IDEMPOTENCY_KEY_REQUIRED";
  path: string;
  message: string;
}

export type GasCityOpaqueMetadata = Readonly<Record<string, string | number | boolean | null>>;

export interface GasCityWorkflowProvider {
  readonly providerId: "gas_city";
  readonly label: string;
  readonly version: string;
  getHealth(context: GasCityWorkflowProviderContext): Promise<GasCityProviderHealth>;
  listCapabilities(context: GasCityWorkflowProviderContext): Promise<GasCityProviderCapability[]>;
  listLaunchTargets(context: GasCityWorkflowProviderContext): Promise<GasCityProviderLaunchTarget[]>;
  listFormulaChoices(context: GasCityWorkflowProviderContext): Promise<GasCityProviderFormulaChoice[]>;
  validateLaunch(input: GasCityProviderLaunchRequest): Promise<GasCityProviderValidationIssue[]>;
  launchSourceWorkflow(input: GasCityProviderLaunchRequest): Promise<GasCityProviderLaunchResult>;
  getWorkflow(ref: GasCityProviderWorkflowRef): Promise<GasCityProviderWorkflowReadModel | null>;
  listWorkflows(context: GasCityWorkflowProviderContext): Promise<GasCityProviderWorkflowReadModel[]>;
  getActivity(context: GasCityWorkflowProviderContext): Promise<GasCityProviderActivitySnapshot>;
}

export interface FakeGasCityWorkflowProviderOptions {
  now?: () => number;
  available?: boolean;
  version?: string;
  targets?: GasCityProviderLaunchTarget[];
  formulas?: GasCityProviderFormulaChoice[];
  workflows?: GasCityProviderWorkflowReadModel[];
}

export class FakeGasCityWorkflowProvider implements GasCityWorkflowProvider {
  readonly providerId = "gas_city" as const;
  readonly label = "Gas City";
  readonly version: string;
  private readonly now: () => number;
  private readonly available: boolean;
  private readonly targets: GasCityProviderLaunchTarget[];
  private readonly formulas: GasCityProviderFormulaChoice[];
  private readonly workflows = new Map<string, GasCityProviderWorkflowReadModel>();
  readonly launches: GasCityProviderLaunchRequest[] = [];

  constructor(options: FakeGasCityWorkflowProviderOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.available = options.available ?? true;
    this.version = options.version ?? "fake-gc-test-provider";
    this.targets = (options.targets ?? [{ target: "worker", label: "Worker" }]).map(sanitizeLaunchTarget);
    this.formulas = (options.formulas ?? [{ formula: "dev-review-test", label: "Dev review test", contract: "graph.v2" }]).map(sanitizeFormulaChoice);
    for (const workflow of options.workflows ?? []) {
      this.workflows.set(workflowKey(workflow.workflowRef), sanitizeWorkflowReadModel(workflow));
    }
  }

  async getHealth(_context: GasCityWorkflowProviderContext): Promise<GasCityProviderHealth> {
    return {
      available: this.available,
      status: this.available ? "healthy" : "unavailable",
      summary: this.available ? "Gas City workflow engine is available." : "Gas City workflow engine is unavailable.",
      checkedAt: this.now(),
      provider: { providerId: this.providerId, label: this.label, version: this.version },
      warnings: [],
    };
  }

  async listCapabilities(_context: GasCityWorkflowProviderContext): Promise<GasCityProviderCapability[]> {
    return [
      ...this.targets.map((target) => ({ id: `target:${target.target}`, label: target.label, kind: "target" as const, description: target.description ?? null, metadata: target.metadata })),
      ...this.formulas.map((formula) => ({ id: `formula:${formula.formula}`, label: formula.label, kind: "formula" as const, description: formula.description ?? null, metadata: formula.metadata })),
    ];
  }

  async listLaunchTargets(_context: GasCityWorkflowProviderContext): Promise<GasCityProviderLaunchTarget[]> {
    return this.targets.map((target) => ({ ...target }));
  }

  async listFormulaChoices(_context: GasCityWorkflowProviderContext): Promise<GasCityProviderFormulaChoice[]> {
    return this.formulas.map((formula) => ({ ...formula }));
  }

  async validateLaunch(input: GasCityProviderLaunchRequest): Promise<GasCityProviderValidationIssue[]> {
    const issues = validateGasCityProviderLaunchRequest(input, {
      available: this.available,
      targets: this.targets,
      formulas: this.formulas,
    });
    return issues;
  }

  async launchSourceWorkflow(input: GasCityProviderLaunchRequest): Promise<GasCityProviderLaunchResult> {
    const issues = await this.validateLaunch(input);
    if (issues.length > 0) {
      return {
        providerId: this.providerId,
        status: "blocked",
        workflowRef: makeWorkflowRef(input, { rootBeadId: null, workflowId: null }),
        summary: issues[0]?.message ?? "Gas City launch is not available.",
        productLinks: [],
      };
    }

    this.launches.push({ ...input, vars: { ...(input.vars ?? {}) } });
    const existing = this.workflows.get(workflowKey(makeWorkflowRef(input)));
    if (existing) {
      return {
        providerId: this.providerId,
        status: "already_running",
        workflowRef: existing.workflowRef,
        summary: "Gas City workflow is already running for this bead.",
        productLinks: existing.productLinks,
        metadata: existing.metadata,
      };
    }

    const workflowRef = makeWorkflowRef(input, {
      rootBeadId: `gc-root-${safeOpaqueId(input.sourceBeadId)}`,
      workflowId: `gc-workflow-${safeOpaqueId(input.sourceBeadId)}`,
    });
    const workflow: GasCityProviderWorkflowReadModel = sanitizeWorkflowReadModel({
      providerId: this.providerId,
      workflowRef,
      sourceBead: { id: input.sourceBeadId, title: input.sourceBeadId, status: "open" },
      status: "running",
      currentOwner: input.target,
      currentStage: input.formula,
      nextAction: "Gas City accepted the workflow launch.",
      progress: null,
      updatedAt: this.now(),
      productLinks: [{ label: "Open source bead", href: `#bead-${encodeURIComponent(input.sourceBeadId)}`, kind: "bead" }],
      warnings: [],
      metadata: { target: input.target, formula: input.formula },
    });
    this.workflows.set(workflowKey(workflowRef), workflow);
    return {
      providerId: this.providerId,
      status: "accepted",
      workflowRef,
      summary: "Gas City accepted the workflow launch.",
      productLinks: workflow.productLinks,
      metadata: workflow.metadata,
    };
  }

  async getWorkflow(ref: GasCityProviderWorkflowRef): Promise<GasCityProviderWorkflowReadModel | null> {
    const workflow = this.workflows.get(workflowKey(ref));
    return workflow ? sanitizeWorkflowReadModel(workflow) : null;
  }

  async listWorkflows(context: GasCityWorkflowProviderContext): Promise<GasCityProviderWorkflowReadModel[]> {
    return [...this.workflows.values()]
      .filter((workflow) => workflow.workflowRef.workspaceId === context.workspaceId)
      .map(sanitizeWorkflowReadModel);
  }

  async getActivity(context: GasCityWorkflowProviderContext): Promise<GasCityProviderActivitySnapshot> {
    return {
      providerId: this.providerId,
      workspaceId: context.workspaceId,
      generatedAt: this.now(),
      workflows: await this.listWorkflows(context),
      warnings: this.available ? [] : ["Gas City workflow engine is unavailable."],
    };
  }
}

export function validateGasCityProviderLaunchRequest(
  input: GasCityProviderLaunchRequest,
  options: {
    available?: boolean;
    targets?: GasCityProviderLaunchTarget[];
    formulas?: GasCityProviderFormulaChoice[];
  } = {},
): GasCityProviderValidationIssue[] {
  const issues: GasCityProviderValidationIssue[] = [];
  if (options.available === false) {
    issues.push({ code: "GAS_CITY_PROVIDER_UNAVAILABLE", path: "provider", message: "Gas City workflow engine is unavailable." });
  }
  if (!input.context.workspaceId.trim()) {
    issues.push({ code: "GAS_CITY_WORKSPACE_REQUIRED", path: "context.workspaceId", message: "Choose a workspace before launching a Gas City workflow." });
  }
  if (!input.sourceBeadId.trim()) {
    issues.push({ code: "GAS_CITY_SOURCE_BEAD_REQUIRED", path: "sourceBeadId", message: "Choose a source bead before launching a Gas City workflow." });
  }
  if (!input.target.trim()) {
    issues.push({ code: "GAS_CITY_TARGET_REQUIRED", path: "target", message: "Choose a Gas City target before launching." });
  }
  if (!input.formula.trim()) {
    issues.push({ code: "GAS_CITY_FORMULA_REQUIRED", path: "formula", message: "Choose a graph.v2 formula before launching." });
  }
  if (!input.idempotencyKey.trim()) {
    issues.push({ code: "GAS_CITY_IDEMPOTENCY_KEY_REQUIRED", path: "idempotencyKey", message: "A launch idempotency key is required." });
  }
  const formula = options.formulas?.find((candidate) => candidate.formula === input.formula.trim());
  if (formula && formula.contract !== "graph.v2") {
    issues.push({ code: "GAS_CITY_FORMULA_UNSUPPORTED", path: "formula", message: "Gas City source workflow launch requires a graph.v2 formula." });
  }
  return issues.map(sanitizeValidationIssue);
}

export function sanitizeGasCityWorkflowReadModel(model: GasCityProviderWorkflowReadModel): GasCityProviderWorkflowReadModel {
  return sanitizeWorkflowReadModel(model);
}

export function sanitizeGasCityProviderText(value: unknown, fallback = "Gas City status is unavailable."): string {
  const text = typeof value === "string" ? value : fallback;
  const cleaned = text
    .replace(/\/Users\/[^\s)]+/gi, "local path")
    .replace(/\/private\/var\/[^\s)]+/gi, "local path")
    .replace(/\/tmp\/[^\s)]+/gi, "local path")
    .replace(/\b(?:bd|git|gc)\s+[\w:./=-]+(?:\s+[\w:./=-]+)*/gi, "provider command")
    .replace(/\bwebhook\b/gi, "callback")
    .replace(/\bqueue[_ -]?item\b/gi, "work item")
    .replace(/\btrigger\b/gi, "event")
    .replace(/\bdelivery\s*id\b/gi, "delivery reference")
    .replace(/\bHMAC\b/gi, "signature")
    .replace(/\bprovider diagnostics?\b/gi, "provider status")
    .replace(/\braw\s+(?:XML|JSON)\b/gi, "response details")
    .replace(/<\/?[A-Za-z_][^>]*>/g, "response details")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned || fallback).slice(0, 280);
}

function makeWorkflowRef(input: GasCityProviderLaunchRequest, refs: { rootBeadId?: string | null; workflowId?: string | null } = {}): GasCityProviderWorkflowRef {
  return {
    providerId: "gas_city",
    workspaceId: input.context.workspaceId.trim(),
    sourceBeadId: input.sourceBeadId.trim(),
    target: input.target.trim(),
    formula: input.formula.trim(),
    rootBeadId: refs.rootBeadId,
    workflowId: refs.workflowId,
  };
}

function sanitizeWorkflowReadModel(model: GasCityProviderWorkflowReadModel): GasCityProviderWorkflowReadModel {
  return {
    providerId: "gas_city",
    workflowRef: sanitizeWorkflowRef(model.workflowRef),
    sourceBead: {
      id: sanitizeId(model.sourceBead.id),
      title: sanitizeGasCityProviderText(model.sourceBead.title, model.sourceBead.id),
      status: sanitizeGasCityProviderText(model.sourceBead.status, "unknown"),
    },
    status: model.status,
    currentOwner: model.currentOwner == null ? null : sanitizeGasCityProviderText(model.currentOwner),
    currentStage: model.currentStage == null ? null : sanitizeGasCityProviderText(model.currentStage),
    nextAction: model.nextAction == null ? null : sanitizeGasCityProviderText(model.nextAction),
    progress: model.progress ? { ...model.progress } : null,
    updatedAt: typeof model.updatedAt === "number" ? model.updatedAt : null,
    productLinks: model.productLinks.map(sanitizeProductLink),
    warnings: model.warnings.map((warning) => sanitizeGasCityProviderText(warning)),
    metadata: sanitizeOpaqueMetadata(model.metadata),
  };
}

function sanitizeWorkflowRef(ref: GasCityProviderWorkflowRef): GasCityProviderWorkflowRef {
  return {
    providerId: "gas_city",
    workspaceId: sanitizeId(ref.workspaceId),
    sourceBeadId: sanitizeId(ref.sourceBeadId),
    target: sanitizeId(ref.target),
    formula: sanitizeId(ref.formula),
    rootBeadId: ref.rootBeadId == null ? null : sanitizeId(ref.rootBeadId),
    workflowId: ref.workflowId == null ? null : sanitizeId(ref.workflowId),
  };
}

function sanitizeLaunchTarget(target: GasCityProviderLaunchTarget): GasCityProviderLaunchTarget {
  return {
    target: sanitizeId(target.target),
    label: sanitizeGasCityProviderText(target.label, target.target),
    description: target.description == null ? null : sanitizeGasCityProviderText(target.description),
    metadata: sanitizeOpaqueMetadata(target.metadata),
  };
}

function sanitizeFormulaChoice(formula: GasCityProviderFormulaChoice): GasCityProviderFormulaChoice {
  return {
    formula: sanitizeId(formula.formula),
    label: sanitizeGasCityProviderText(formula.label, formula.formula),
    contract: formula.contract === "graph.v2" ? "graph.v2" : "unknown",
    description: formula.description == null ? null : sanitizeGasCityProviderText(formula.description),
    metadata: sanitizeOpaqueMetadata(formula.metadata),
  };
}

function sanitizeProductLink(link: GasCityProviderProductLink): GasCityProviderProductLink {
  const href = /^(?:\/|#)/.test(link.href) && !/\/Users\/|\/private\/var\/|\/tmp\//i.test(link.href) ? link.href : "#";
  return {
    label: sanitizeGasCityProviderText(link.label, "Open details"),
    href,
    kind: link.kind,
  };
}

function sanitizeValidationIssue(issue: GasCityProviderValidationIssue): GasCityProviderValidationIssue {
  return {
    ...issue,
    message: sanitizeGasCityProviderText(issue.message, "Gas City launch is not available."),
  };
}

function sanitizeOpaqueMetadata(metadata: GasCityOpaqueMetadata | undefined): GasCityOpaqueMetadata | undefined {
  if (!metadata) return undefined;
  const output: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(metadata)) {
    const safeKey = sanitizeId(key);
    if (!safeKey) continue;
    if (typeof value === "string") output[safeKey] = sanitizeGasCityProviderText(value, "");
    else if (typeof value === "number" && Number.isFinite(value)) output[safeKey] = value;
    else if (typeof value === "boolean" || value === null) output[safeKey] = value;
  }
  return output;
}

function workflowKey(ref: GasCityProviderWorkflowRef): string {
  return [ref.workspaceId, ref.sourceBeadId, ref.target, ref.formula].join("\u0000");
}

function safeOpaqueId(value: string): string {
  return sanitizeId(value).replace(/[^A-Za-z0-9_.-]+/g, "-") || "bead";
}

function sanitizeId(value: string): string {
  return value.trim().slice(0, 160);
}

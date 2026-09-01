import {
  sanitizeGasCityProviderText,
  type GasCityProviderFormulaChoice,
  type GasCityProviderHealth,
  type GasCityProviderLaunchTarget,
  type GasCityProviderWorkflowReadModel,
  type GasCityWorkflowProvider,
  type GasCityWorkflowProviderContext,
} from "./gasCityWorkflowProvider";

export type ReadyBeadFanoutItemStatus = "will_launch" | "skipped" | "blocked" | "already_running";

export type ReadyBeadFanoutSkipReason =
  | "provider_unavailable"
  | "target_unavailable"
  | "formula_missing"
  | "formula_unsupported"
  | "bead_not_found"
  | "bead_not_ready"
  | "terminal_status"
  | "wrong_workspace"
  | "parent_mismatch"
  | "convoy_mismatch"
  | "already_running"
  | "capacity_reached"
  | "limit_reached";

export interface ReadyBeadFanoutBead {
  id: string;
  title: string;
  status: string;
  workspaceId?: string | null;
  parentBeadId?: string | null;
  convoyIds?: string[];
  metadata?: Record<string, string | null | undefined>;
}

export interface ReadyBeadFanoutPreviewRequest {
  context: GasCityWorkflowProviderContext;
  target: string;
  formula?: string | null;
  formulaByBeadId?: Record<string, string | null | undefined>;
  source?: {
    explicitBeadIds?: string[];
    parentBeadId?: string | null;
    convoyId?: string | null;
  };
  limits?: {
    maxLaunches?: number | null;
    maxActiveSourceWorkflows?: number | null;
  };
}

export interface ReadyBeadFanoutPreviewItem {
  beadId: string;
  title: string;
  status: ReadyBeadFanoutItemStatus;
  reasonCode?: ReadyBeadFanoutSkipReason;
  reason?: string;
  formula?: string | null;
  lane: null;
}

export interface ReadyBeadFanoutPreview {
  workspaceId: string;
  authoritativeSource: "gas_city_beads";
  advisory: true;
  formula: { id: string; label: string; contract: "graph.v2" | "unknown" } | null;
  target: { id: string; label: string } | null;
  counts: {
    ready: number;
    willLaunch: number;
    skipped: number;
    blocked: number;
    alreadyRunning: number;
    activeBefore: number;
    capacity: number;
    maxLaunches: number;
  };
  items: ReadyBeadFanoutPreviewItem[];
  nextAction: string;
  warnings: string[];
  generatedAt: number;
}

export interface ReadyBeadFanoutBeadProvider {
  listReadyBeads(input: { workspaceId: string; parentBeadId?: string | null; convoyId?: string | null }): Promise<ReadyBeadFanoutBead[]>;
  getBeadsByIds?(input: { workspaceId: string; beadIds: string[] }): Promise<ReadyBeadFanoutBead[]>;
  listConvoyMemberBeadIds?(input: { workspaceId: string; convoyId: string }): Promise<string[]>;
}

export interface ReadyBeadFanoutPreviewProviderOptions {
  gasCityProvider: GasCityWorkflowProvider;
  beadProvider: ReadyBeadFanoutBeadProvider;
  now?: () => number;
}

const TERMINAL_STATUSES = new Set(["closed", "archived", "removed"]);
const READY_STATUSES = new Set(["open", "ready"]);
const DEFAULT_MAX_ACTIVE = 1;
const DEFAULT_MAX_LAUNCHES = 25;

export class GasCityReadyBeadFanoutPreviewProvider {
  private readonly gasCityProvider: GasCityWorkflowProvider;
  private readonly beadProvider: ReadyBeadFanoutBeadProvider;
  private readonly now: () => number;

  constructor(options: ReadyBeadFanoutPreviewProviderOptions) {
    this.gasCityProvider = options.gasCityProvider;
    this.beadProvider = options.beadProvider;
    this.now = options.now ?? (() => Date.now());
  }

  async previewReadyBeadFanout(request: ReadyBeadFanoutPreviewRequest): Promise<ReadyBeadFanoutPreview> {
    const workspaceId = sanitizeId(request.context.workspaceId);
    const health = await this.gasCityProvider.getHealth(request.context);
    const targets = await safeListTargets(this.gasCityProvider, request.context);
    const formulas = await safeListFormulas(this.gasCityProvider, request.context);
    const activeWorkflows = await safeListWorkflows(this.gasCityProvider, request.context);
    const activeSourceBeadIds = new Set(activeWorkflows.map((workflow) => workflow.workflowRef.sourceBeadId));
    const target = resolveTarget(request.target, targets);
    const source = request.source ?? {};
    const explicitIds = uniqueStrings(source.explicitBeadIds ?? []);
    const beads = explicitIds.length > 0
      ? await this.loadExplicitBeads(workspaceId, explicitIds)
      : await this.beadProvider.listReadyBeads({ workspaceId, parentBeadId: cleanOptional(source.parentBeadId), convoyId: cleanOptional(source.convoyId) });
    const ordered = orderCandidateBeads(beads, explicitIds);
    const convoyMemberIds = await this.loadConvoyMembers(workspaceId, cleanOptional(source.convoyId));
    const maxActive = normalizePositiveLimit(request.limits?.maxActiveSourceWorkflows, DEFAULT_MAX_ACTIVE);
    const maxLaunches = normalizePositiveLimit(request.limits?.maxLaunches, DEFAULT_MAX_LAUNCHES);
    const activeBefore = activeSourceBeadIds.size;
    const capacity = Math.max(0, maxActive - activeBefore);
    let willLaunchCount = 0;
    const warnings: string[] = [];

    if (!health.available) warnings.push(health.summary);
    if (!target) warnings.push("Choose an available workflow target before launching ready tasks.");

    const items = ordered.map((bead): ReadyBeadFanoutPreviewItem => {
      const formulaId = resolveFormulaForBead(bead, request.formula, request.formulaByBeadId?.[bead.id]);
      const formula = formulaId ? resolveFormula(formulaId, formulas) : null;
      const unavailable = commonBlockReason({ health, target, bead, workspaceId, parentBeadId: cleanOptional(source.parentBeadId), convoyMemberIds, activeSourceBeadIds, formulaId, formula });
      if (unavailable) return previewItem(bead, unavailable.status, unavailable.reasonCode, unavailable.reason, formulaId);
      if (willLaunchCount >= capacity) return previewItem(bead, "skipped", "capacity_reached", "Ready task capacity is already full for this workspace.", formulaId);
      if (willLaunchCount >= maxLaunches) return previewItem(bead, "skipped", "limit_reached", "This preview reached the selected launch limit.", formulaId);
      willLaunchCount += 1;
      return previewItem(bead, "will_launch", undefined, undefined, formulaId);
    });

    const formulaForPreview = resolveFormula(cleanOptional(request.formula) ?? firstUsableFormula(items), formulas);
    const safeItems = items.map(sanitizePreviewItem);
    return {
      workspaceId,
      authoritativeSource: "gas_city_beads",
      advisory: true,
      formula: formulaForPreview ? { id: sanitizeId(formulaForPreview.formula), label: sanitizeText(formulaForPreview.label, formulaForPreview.formula), contract: formulaForPreview.contract } : null,
      target: target ? { id: sanitizeId(target.target), label: sanitizeText(target.label, target.target) } : null,
      counts: {
        ready: safeItems.filter((item) => item.status === "will_launch" || item.status === "already_running").length,
        willLaunch: safeItems.filter((item) => item.status === "will_launch").length,
        skipped: safeItems.filter((item) => item.status === "skipped").length,
        blocked: safeItems.filter((item) => item.status === "blocked").length,
        alreadyRunning: safeItems.filter((item) => item.status === "already_running").length,
        activeBefore,
        capacity,
        maxLaunches,
      },
      items: safeItems,
      nextAction: nextActionForPreview(safeItems, health, target),
      warnings: warnings.map((warning) => sanitizeText(warning, "Workflow engine warning.")),
      generatedAt: this.now(),
    };
  }

  private async loadExplicitBeads(workspaceId: string, explicitIds: string[]): Promise<ReadyBeadFanoutBead[]> {
    const found = this.beadProvider.getBeadsByIds
      ? await this.beadProvider.getBeadsByIds({ workspaceId, beadIds: explicitIds })
      : await this.beadProvider.listReadyBeads({ workspaceId });
    const byId = new Map(found.map((bead) => [bead.id, bead]));
    return explicitIds.map((id) => byId.get(id) ?? missingBead(id, workspaceId));
  }

  private async loadConvoyMembers(workspaceId: string, convoyId: string | null): Promise<Set<string> | null> {
    if (!convoyId) return null;
    if (!this.beadProvider.listConvoyMemberBeadIds) return null;
    return new Set(await this.beadProvider.listConvoyMemberBeadIds({ workspaceId, convoyId }));
  }
}

export class FakeReadyBeadFanoutBeadProvider implements ReadyBeadFanoutBeadProvider {
  private readonly beads: ReadyBeadFanoutBead[];
  private readonly convoyMembers: Map<string, string[]>;

  constructor(options: { beads?: ReadyBeadFanoutBead[]; convoyMembers?: Record<string, string[]> } = {}) {
    this.beads = options.beads ?? [];
    this.convoyMembers = new Map(Object.entries(options.convoyMembers ?? {}));
  }

  async listReadyBeads(input: { workspaceId: string; parentBeadId?: string | null; convoyId?: string | null }): Promise<ReadyBeadFanoutBead[]> {
    return this.beads.filter((bead) => {
      if (bead.workspaceId && bead.workspaceId !== input.workspaceId) return false;
      if (input.parentBeadId && bead.parentBeadId !== input.parentBeadId) return false;
      if (input.convoyId && !(bead.convoyIds ?? []).includes(input.convoyId)) return false;
      return READY_STATUSES.has(bead.status);
    });
  }

  async getBeadsByIds(input: { workspaceId: string; beadIds: string[] }): Promise<ReadyBeadFanoutBead[]> {
    const byId = new Map(this.beads.filter((bead) => !bead.workspaceId || bead.workspaceId === input.workspaceId).map((bead) => [bead.id, bead]));
    return input.beadIds.map((id) => byId.get(id) ?? missingBead(id, input.workspaceId));
  }

  async listConvoyMemberBeadIds(input: { workspaceId: string; convoyId: string }): Promise<string[]> {
    return [...(this.convoyMembers.get(input.convoyId) ?? [])];
  }
}

function commonBlockReason(input: {
  health: GasCityProviderHealth;
  target: GasCityProviderLaunchTarget | null;
  bead: ReadyBeadFanoutBead;
  workspaceId: string;
  parentBeadId: string | null;
  convoyMemberIds: Set<string> | null;
  activeSourceBeadIds: Set<string>;
  formulaId: string | null;
  formula: GasCityProviderFormulaChoice | null;
}): { status: ReadyBeadFanoutItemStatus; reasonCode: ReadyBeadFanoutSkipReason; reason: string } | null {
  if (!input.health.available) return { status: "blocked", reasonCode: "provider_unavailable", reason: "Workflow engine is unavailable." };
  if (!input.target) return { status: "blocked", reasonCode: "target_unavailable", reason: "The selected workflow target is unavailable." };
  if (input.bead.status === "missing") return { status: "blocked", reasonCode: "bead_not_found", reason: "Task bead was not found." };
  if (input.bead.workspaceId && input.bead.workspaceId !== input.workspaceId) return { status: "blocked", reasonCode: "wrong_workspace", reason: "Task bead belongs to another workspace." };
  if (input.parentBeadId && input.bead.parentBeadId !== input.parentBeadId) return { status: "skipped", reasonCode: "parent_mismatch", reason: "Task bead is not under the selected parent." };
  if (input.convoyMemberIds && !input.convoyMemberIds.has(input.bead.id)) return { status: "skipped", reasonCode: "convoy_mismatch", reason: "Task bead is not in the selected group." };
  if (TERMINAL_STATUSES.has(input.bead.status)) return { status: "skipped", reasonCode: "terminal_status", reason: "Task bead is already finished or archived." };
  if (!READY_STATUSES.has(input.bead.status)) return { status: "skipped", reasonCode: "bead_not_ready", reason: "Task bead is not ready to start." };
  if (input.activeSourceBeadIds.has(input.bead.id) || hasLiveWorkflowMetadata(input.bead)) return { status: "already_running", reasonCode: "already_running", reason: "Task bead already has an active workflow." };
  if (!input.formulaId) return { status: "blocked", reasonCode: "formula_missing", reason: "No workflow recipe is available for this task bead." };
  if (!input.formula || input.formula.contract !== "graph.v2") return { status: "blocked", reasonCode: "formula_unsupported", reason: "Workflow recipe must use the supported graph.v2 contract." };
  return null;
}

function resolveTarget(targetId: string, targets: GasCityProviderLaunchTarget[]): GasCityProviderLaunchTarget | null {
  const target = targetId.trim();
  if (!target) return null;
  if (targets.length === 0) return { target, label: target };
  return targets.find((candidate) => candidate.target === target) ?? null;
}

function resolveFormula(formulaId: string | null | undefined, formulas: GasCityProviderFormulaChoice[]): GasCityProviderFormulaChoice | null {
  const formula = formulaId?.trim();
  if (!formula) return null;
  if (formulas.length === 0) return { formula, label: formula, contract: "unknown" };
  return formulas.find((candidate) => candidate.formula === formula) ?? null;
}

function resolveFormulaForBead(bead: ReadyBeadFanoutBead, defaultFormula?: string | null, explicitFormula?: string | null): string | null {
  return cleanOptional(explicitFormula) ?? cleanOptional(bead.metadata?.["vd.gas_city.formula"]) ?? cleanOptional(bead.metadata?.["gc.formula"]) ?? cleanOptional(defaultFormula);
}

function hasLiveWorkflowMetadata(bead: ReadyBeadFanoutBead): boolean {
  const metadata = bead.metadata ?? {};
  return Boolean(cleanOptional(metadata.workflow_id) ?? cleanOptional(metadata["gc.workflow_id"]) ?? cleanOptional(metadata["gc.root_bead_id"]));
}

function previewItem(bead: ReadyBeadFanoutBead, status: ReadyBeadFanoutItemStatus, reasonCode?: ReadyBeadFanoutSkipReason, reason?: string, formula?: string | null): ReadyBeadFanoutPreviewItem {
  return { beadId: bead.id, title: bead.title, status, reasonCode, reason, formula: formula ?? null, lane: null };
}

function sanitizePreviewItem(item: ReadyBeadFanoutPreviewItem): ReadyBeadFanoutPreviewItem {
  return {
    beadId: sanitizeId(item.beadId),
    title: sanitizeText(item.title, item.beadId),
    status: item.status,
    reasonCode: item.reasonCode,
    reason: item.reason ? sanitizeText(item.reason, "Task bead cannot launch yet.") : undefined,
    formula: item.formula ? sanitizeId(item.formula) : null,
    lane: null,
  };
}

async function safeListTargets(provider: GasCityWorkflowProvider, context: GasCityWorkflowProviderContext): Promise<GasCityProviderLaunchTarget[]> {
  try {
    return provider.listLaunchTargets(context);
  } catch {
    return [];
  }
}

async function safeListFormulas(provider: GasCityWorkflowProvider, context: GasCityWorkflowProviderContext): Promise<GasCityProviderFormulaChoice[]> {
  try {
    return provider.listFormulaChoices(context);
  } catch {
    return [];
  }
}

async function safeListWorkflows(provider: GasCityWorkflowProvider, context: GasCityWorkflowProviderContext): Promise<GasCityProviderWorkflowReadModel[]> {
  try {
    return provider.listWorkflows(context);
  } catch {
    return [];
  }
}

function orderCandidateBeads(beads: ReadyBeadFanoutBead[], explicitIds: string[]): ReadyBeadFanoutBead[] {
  if (explicitIds.length > 0) {
    const order = new Map(explicitIds.map((id, index) => [id, index]));
    return [...beads].sort((left, right) => (order.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(right.id) ?? Number.MAX_SAFE_INTEGER) || left.id.localeCompare(right.id));
  }
  return [...beads].sort((left, right) => left.id.localeCompare(right.id));
}

function firstUsableFormula(items: ReadyBeadFanoutPreviewItem[]): string | null {
  return items.find((item) => item.formula)?.formula ?? null;
}

function nextActionForPreview(items: ReadyBeadFanoutPreviewItem[], health: GasCityProviderHealth, target: GasCityProviderLaunchTarget | null): string {
  if (!health.available) return "Configure the workflow engine before launching ready tasks.";
  if (!target) return "Choose an available target before launching ready tasks.";
  const launchable = items.filter((item) => item.status === "will_launch").length;
  if (launchable > 0) return `Review ${launchable} ready task${launchable === 1 ? "" : "s"} before launching.`;
  if (items.length === 0) return "No ready task beads match this preview.";
  return "Resolve blocked or skipped tasks before launching.";
}

function missingBead(id: string, workspaceId: string): ReadyBeadFanoutBead {
  return { id, title: id, status: "missing", workspaceId };
}

function normalizePositiveLimit(value: number | null | undefined, fallback: number): number {
  if (!Number.isFinite(value) || !Number.isInteger(value) || (value ?? 0) < 0) return fallback;
  return value ?? fallback;
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    output.push(trimmed);
  }
  return output;
}

function cleanOptional(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed || null;
}

function sanitizeText(value: unknown, fallback: string): string {
  return sanitizeGasCityProviderText(value, fallback);
}

function sanitizeId(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9_.:-]+/g, "-").slice(0, 160) || "task";
}

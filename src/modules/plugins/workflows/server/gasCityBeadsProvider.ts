import { sanitizeGasCityProviderText, type GasCityOpaqueMetadata } from "./gasCityWorkflowProvider";
import type { ReadyBeadFanoutBead, ReadyBeadFanoutBeadProvider } from "./gasCityReadyBeadFanoutPreview";

export type GasCityBeadStatus = "open" | "ready" | "blocked" | "closed" | "archived" | "removed" | "unknown";
export type GasCityBeadReadiness = "ready" | "not_ready" | "blocked" | "terminal" | "unknown";
export type GasCityWorkflowLinkageStatus = "pending" | "running" | "waiting" | "blocked" | "completed" | "failed" | "unknown";

export interface GasCityBeadWorkflowMetadata {
  workflowId?: string | null;
  rootBeadId?: string | null;
  sourceBeadId?: string | null;
  formula?: string | null;
  target?: string | null;
  status?: GasCityWorkflowLinkageStatus | null;
  updatedAt?: number | null;
}

export interface GasCityBeadDto {
  id: string;
  title: string;
  status: GasCityBeadStatus;
  readiness: GasCityBeadReadiness;
  workspaceId: string;
  parentBeadId?: string | null;
  dependencyBeadIds: string[];
  convoyIds: string[];
  workflow?: GasCityBeadWorkflowMetadata | null;
  metadata?: GasCityOpaqueMetadata;
  updatedAt?: number | null;
}

export interface GasCityBeadsListInput {
  workspaceId: string;
  parentBeadId?: string | null;
  convoyId?: string | null;
  readiness?: GasCityBeadReadiness | "any";
}

export interface GasCityBeadsByIdInput {
  workspaceId: string;
  beadIds: string[];
}

export interface GasCityWorkflowLinkageWriteInput {
  workspaceId: string;
  beadId: string;
  workflow: Required<Pick<GasCityBeadWorkflowMetadata, "workflowId" | "rootBeadId" | "formula" | "target">> & {
    status?: GasCityWorkflowLinkageStatus | null;
    updatedAt?: number | null;
  };
  idempotencyKey: string;
}

export interface GasCityWorkflowResultNoteWriteInput {
  workspaceId: string;
  beadId: string;
  noteKey: string;
  summary: string;
  workflow?: GasCityBeadWorkflowMetadata | null;
  idempotencyKey: string;
}

export interface GasCityBeadsMutationResult {
  status: "created" | "updated" | "already_applied" | "conflict" | "unavailable";
  message: string;
}

export interface GasCityBeadsProvider {
  readonly providerId: "gas_city_beads";
  readonly label: string;
  listBeads(input: GasCityBeadsListInput): Promise<GasCityBeadDto[]>;
  getBeadsByIds(input: GasCityBeadsByIdInput): Promise<GasCityBeadDto[]>;
  listConvoyMemberBeadIds?(input: { workspaceId: string; convoyId: string }): Promise<string[]>;
  upsertWorkflowLinkage?(input: GasCityWorkflowLinkageWriteInput): Promise<GasCityBeadsMutationResult>;
  writeWorkflowResultNote?(input: GasCityWorkflowResultNoteWriteInput): Promise<GasCityBeadsMutationResult>;
}

export class GasCityReadyBeadFanoutBeadsAdapter implements ReadyBeadFanoutBeadProvider {
  constructor(private readonly provider: GasCityBeadsProvider) {}

  async listReadyBeads(input: { workspaceId: string; parentBeadId?: string | null; convoyId?: string | null }): Promise<ReadyBeadFanoutBead[]> {
    const beads = await this.provider.listBeads({ ...input, readiness: "ready" });
    return beads.map(toReadyBeadFanoutBead);
  }

  async getBeadsByIds(input: { workspaceId: string; beadIds: string[] }): Promise<ReadyBeadFanoutBead[]> {
    const beads = await this.provider.getBeadsByIds(input);
    return beads.map(toReadyBeadFanoutBead);
  }

  async listConvoyMemberBeadIds(input: { workspaceId: string; convoyId: string }): Promise<string[]> {
    return this.provider.listConvoyMemberBeadIds?.(input) ?? [];
  }
}

export class FakeGasCityBeadsProvider implements GasCityBeadsProvider {
  readonly providerId = "gas_city_beads" as const;
  readonly label = "Gas City Beads";
  private readonly beads = new Map<string, GasCityBeadDto>();
  private readonly convoyMembers = new Map<string, string[]>();
  private readonly linkageWrites = new Map<string, GasCityWorkflowLinkageWriteInput>();
  private readonly resultNotes = new Map<string, GasCityWorkflowResultNoteWriteInput>();

  constructor(options: { beads?: GasCityBeadDto[]; convoyMembers?: Record<string, string[]> } = {}) {
    for (const bead of options.beads ?? []) this.beads.set(bead.id, sanitizeGasCityBeadDto(bead));
    for (const [convoyId, beadIds] of Object.entries(options.convoyMembers ?? {})) this.convoyMembers.set(convoyId, uniqueSafeIds(beadIds));
  }

  async listBeads(input: GasCityBeadsListInput): Promise<GasCityBeadDto[]> {
    return [...this.beads.values()].filter((bead) => {
      if (bead.workspaceId !== input.workspaceId) return false;
      if (input.parentBeadId && bead.parentBeadId !== input.parentBeadId) return false;
      if (input.convoyId && !bead.convoyIds.includes(input.convoyId)) return false;
      if (input.readiness && input.readiness !== "any" && bead.readiness !== input.readiness) return false;
      return true;
    }).map(cloneBeadDto);
  }

  async getBeadsByIds(input: GasCityBeadsByIdInput): Promise<GasCityBeadDto[]> {
    const output: GasCityBeadDto[] = [];
    for (const id of uniqueSafeIds(input.beadIds)) {
      const bead = this.beads.get(id);
      if (bead && bead.workspaceId === input.workspaceId) output.push(cloneBeadDto(bead));
    }
    return output;
  }

  async listConvoyMemberBeadIds(input: { workspaceId: string; convoyId: string }): Promise<string[]> {
    return [...(this.convoyMembers.get(input.convoyId) ?? [])];
  }

  async upsertWorkflowLinkage(input: GasCityWorkflowLinkageWriteInput): Promise<GasCityBeadsMutationResult> {
    const key = sanitizeProviderId(input.idempotencyKey);
    if (!key) return { status: "conflict", message: "A stable workflow linkage key is required." };
    const safeInput = sanitizeWorkflowLinkageInput(input);
    const existing = this.linkageWrites.get(key);
    if (existing) {
      return sameWorkflowLinkageIdentity(existing, safeInput)
        ? { status: "already_applied", message: "Workflow linkage is already recorded." }
        : { status: "conflict", message: "Workflow linkage key was already used for different work." };
    }
    const bead = this.beads.get(safeInput.beadId);
    if (!bead || bead.workspaceId !== safeInput.workspaceId) return { status: "unavailable", message: "Task bead is unavailable." };
    this.linkageWrites.set(key, safeInput);
    this.beads.set(bead.id, sanitizeGasCityBeadDto({ ...bead, workflow: { ...safeInput.workflow, sourceBeadId: bead.id } }));
    return { status: "created", message: "Workflow linkage recorded." };
  }

  async writeWorkflowResultNote(input: GasCityWorkflowResultNoteWriteInput): Promise<GasCityBeadsMutationResult> {
    const key = sanitizeProviderId(input.idempotencyKey || input.noteKey);
    if (!key) return { status: "conflict", message: "A stable workflow result note key is required." };
    const safeInput = sanitizeResultNoteInput(input);
    const existing = this.resultNotes.get(key);
    if (existing) {
      return sameResultNoteIdentity(existing, safeInput)
        ? { status: "already_applied", message: "Workflow result note is already recorded." }
        : { status: "conflict", message: "Workflow result note key was already used for different work." };
    }
    const bead = this.beads.get(safeInput.beadId);
    if (!bead || bead.workspaceId !== safeInput.workspaceId) return { status: "unavailable", message: "Task bead is unavailable." };
    this.resultNotes.set(key, safeInput);
    return { status: "created", message: "Workflow result note recorded." };
  }
}

export function sanitizeGasCityBeadDto(input: GasCityBeadDto): GasCityBeadDto {
  return {
    id: sanitizeProviderId(input.id),
    title: sanitizeGasCityProviderText(input.title, input.id),
    status: normalizeBeadStatus(input.status),
    readiness: normalizeReadiness(input.readiness),
    workspaceId: sanitizeProviderId(input.workspaceId),
    parentBeadId: input.parentBeadId == null ? null : sanitizeProviderId(input.parentBeadId),
    dependencyBeadIds: uniqueSafeIds(input.dependencyBeadIds),
    convoyIds: uniqueSafeIds(input.convoyIds),
    workflow: input.workflow ? sanitizeWorkflowMetadata(input.workflow) : null,
    metadata: sanitizeBeadMetadata(input.metadata),
    updatedAt: typeof input.updatedAt === "number" && Number.isFinite(input.updatedAt) ? input.updatedAt : null,
  };
}

export function toReadyBeadFanoutBead(bead: GasCityBeadDto): ReadyBeadFanoutBead {
  const safe = sanitizeGasCityBeadDto(bead);
  return {
    id: safe.id,
    title: safe.title,
    status: statusForFanout(safe),
    workspaceId: safe.workspaceId,
    parentBeadId: safe.parentBeadId,
    convoyIds: safe.convoyIds,
    metadata: {
      ...(safe.metadata ?? {}),
      ...(safe.workflow?.workflowId ? { "gc.workflow_id": safe.workflow.workflowId, workflow_id: safe.workflow.workflowId } : {}),
      ...(safe.workflow?.rootBeadId ? { "gc.root_bead_id": safe.workflow.rootBeadId } : {}),
      ...(safe.workflow?.formula ? { "gc.formula": safe.workflow.formula } : {}),
      ...(safe.workflow?.target ? { "gc.target": safe.workflow.target } : {}),
      ...(safe.workflow?.status ? { "gc.workflow_status": safe.workflow.status, workflow_status: safe.workflow.status } : {}),
    },
  };
}

function statusForFanout(bead: GasCityBeadDto): string {
  if (bead.status === "ready") return "ready";
  if (bead.readiness === "ready" && bead.status === "open") return "open";
  if (bead.readiness === "terminal") return bead.status === "unknown" ? "closed" : bead.status;
  if (bead.readiness === "blocked") return "blocked";
  return bead.status;
}

function sanitizeWorkflowLinkageInput(input: GasCityWorkflowLinkageWriteInput): GasCityWorkflowLinkageWriteInput {
  return {
    workspaceId: sanitizeProviderId(input.workspaceId),
    beadId: sanitizeProviderId(input.beadId),
    idempotencyKey: sanitizeProviderId(input.idempotencyKey),
    workflow: {
      workflowId: sanitizeProviderId(input.workflow.workflowId ?? ""),
      rootBeadId: sanitizeProviderId(input.workflow.rootBeadId ?? ""),
      formula: sanitizeProviderId(input.workflow.formula ?? ""),
      target: sanitizeProviderId(input.workflow.target ?? ""),
      status: normalizeWorkflowStatus(input.workflow.status ?? "running"),
      updatedAt: typeof input.workflow.updatedAt === "number" && Number.isFinite(input.workflow.updatedAt) ? input.workflow.updatedAt : null,
    },
  };
}

function sanitizeResultNoteInput(input: GasCityWorkflowResultNoteWriteInput): GasCityWorkflowResultNoteWriteInput {
  return {
    workspaceId: sanitizeProviderId(input.workspaceId),
    beadId: sanitizeProviderId(input.beadId),
    noteKey: sanitizeProviderId(input.noteKey),
    summary: sanitizeGasCityProviderText(input.summary, "Workflow result recorded."),
    workflow: input.workflow ? sanitizeWorkflowMetadata(input.workflow) : null,
    idempotencyKey: sanitizeProviderId(input.idempotencyKey),
  };
}

function sameWorkflowLinkageIdentity(left: GasCityWorkflowLinkageWriteInput, right: GasCityWorkflowLinkageWriteInput): boolean {
  return left.workspaceId === right.workspaceId
    && left.beadId === right.beadId
    && left.workflow.workflowId === right.workflow.workflowId
    && left.workflow.rootBeadId === right.workflow.rootBeadId
    && left.workflow.formula === right.workflow.formula
    && left.workflow.target === right.workflow.target;
}

function sameResultNoteIdentity(left: GasCityWorkflowResultNoteWriteInput, right: GasCityWorkflowResultNoteWriteInput): boolean {
  return left.workspaceId === right.workspaceId && left.beadId === right.beadId && left.noteKey === right.noteKey;
}

function cloneBeadDto(bead: GasCityBeadDto): GasCityBeadDto {
  return { ...bead, dependencyBeadIds: [...bead.dependencyBeadIds], convoyIds: [...bead.convoyIds], workflow: bead.workflow ? { ...bead.workflow } : null, metadata: bead.metadata ? { ...bead.metadata } : undefined };
}

function sanitizeWorkflowMetadata(input: GasCityBeadWorkflowMetadata): GasCityBeadWorkflowMetadata {
  return {
    workflowId: input.workflowId == null ? null : sanitizeProviderId(input.workflowId),
    rootBeadId: input.rootBeadId == null ? null : sanitizeProviderId(input.rootBeadId),
    sourceBeadId: input.sourceBeadId == null ? null : sanitizeProviderId(input.sourceBeadId),
    formula: input.formula == null ? null : sanitizeProviderId(input.formula),
    target: input.target == null ? null : sanitizeProviderId(input.target),
    status: input.status == null ? null : normalizeWorkflowStatus(input.status),
    updatedAt: typeof input.updatedAt === "number" && Number.isFinite(input.updatedAt) ? input.updatedAt : null,
  };
}

function sanitizeBeadMetadata(metadata: GasCityOpaqueMetadata | undefined): GasCityOpaqueMetadata | undefined {
  if (!metadata) return undefined;
  const output: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(metadata)) {
    const safeKey = sanitizeProviderId(key);
    if (!safeKey) continue;
    if (typeof value === "string") output[safeKey] = sanitizeGasCityProviderText(value, "");
    else if (typeof value === "number" && Number.isFinite(value)) output[safeKey] = value;
    else if (typeof value === "boolean" || value === null) output[safeKey] = value;
  }
  return output;
}

function normalizeBeadStatus(status: string): GasCityBeadStatus {
  return ["open", "ready", "blocked", "closed", "archived", "removed"].includes(status) ? status as GasCityBeadStatus : "unknown";
}

function normalizeReadiness(readiness: string): GasCityBeadReadiness {
  return ["ready", "not_ready", "blocked", "terminal"].includes(readiness) ? readiness as GasCityBeadReadiness : "unknown";
}

function normalizeWorkflowStatus(status: string): GasCityWorkflowLinkageStatus {
  return ["pending", "running", "waiting", "blocked", "completed", "failed"].includes(status) ? status as GasCityWorkflowLinkageStatus : "unknown";
}

function uniqueSafeIds(values: string[] | undefined): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values ?? []) {
    const safe = sanitizeProviderId(value);
    if (!safe || seen.has(safe)) continue;
    seen.add(safe);
    output.push(safe);
  }
  return output;
}

function sanitizeProviderId(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9_.:-]+/g, "-").slice(0, 160);
}

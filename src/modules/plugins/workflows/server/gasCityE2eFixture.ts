import { readFileSync } from "node:fs";
import {
  sanitizeGasCityBeadDto,
  type GasCityBeadDto,
  type GasCityBeadsByIdInput,
  type GasCityBeadsListInput,
  type GasCityBeadsMutationResult,
  type GasCityBeadsProvider,
  type GasCityWorkflowLinkageWriteInput,
  type GasCityWorkflowResultNoteWriteInput,
} from "./gasCityBeadsProvider";
import { sanitizeGasCityProviderText, type GasCityOpaqueMetadata } from "./gasCityWorkflowProvider";

export type GasCityE2eFixtureEventType =
  | "mark_bead_ready"
  | "record_agent_result_note"
  | "mark_review_changes_requested"
  | "mark_review_approved"
  | "mark_tester_found_bug"
  | "mark_tester_approved"
  | "simulate_provider_unavailable";

export interface GasCityE2eFixtureConfig {
  workspaceId: string;
  providerAvailable?: boolean;
  beads?: GasCityBeadDto[];
}

export interface GasCityE2eFixtureEventInput {
  eventId: string;
  type: GasCityE2eFixtureEventType;
  workspaceId: string;
  beadId?: string | null;
  title?: string | null;
  summary?: string | null;
  metadata?: GasCityOpaqueMetadata | null;
}

export interface GasCityE2eFixtureEventRecord {
  eventId: string;
  type: GasCityE2eFixtureEventType;
  workspaceId: string;
  beadId: string | null;
  summary: string;
  appliedAt: number;
}

export interface GasCityE2eFixtureApplyResult {
  status: "applied" | "already_applied" | "conflict";
  message: string;
  state: GasCityE2eFixtureSnapshot;
}

export interface GasCityE2eFixtureSnapshot {
  fixture: {
    schemaVersion: "gas-city-e2e-fixture.v1";
    providerId: "gas_city_e2e_fixture";
    providerAvailable: boolean;
    workspaceId: string;
    generatedAt: number;
  };
  beads: GasCityBeadDto[];
  events: GasCityE2eFixtureEventRecord[];
  warnings: string[];
}

interface ResultNoteRecord {
  workspaceId: string;
  beadId: string;
  noteKey: string;
  summary: string;
  idempotencyKey: string;
}

const DEFAULT_WORKSPACE_ID = "workspace-e2e";

export class GasCityE2eFixtureStore implements GasCityBeadsProvider {
  readonly providerId = "gas_city_beads" as const;
  readonly label = "Gas City E2E fixture";

  private workspaceId = DEFAULT_WORKSPACE_ID;
  private providerAvailable = true;
  private readonly beads = new Map<string, GasCityBeadDto>();
  private readonly eventFingerprints = new Map<string, string>();
  private readonly events: GasCityE2eFixtureEventRecord[] = [];
  private readonly resultNotes = new Map<string, ResultNoteRecord>();
  private now: () => number;

  constructor(config: GasCityE2eFixtureConfig = { workspaceId: DEFAULT_WORKSPACE_ID }, options: { now?: () => number } = {}) {
    this.now = options.now ?? (() => Date.now());
    this.reset(config);
  }

  reset(config: GasCityE2eFixtureConfig): GasCityE2eFixtureSnapshot {
    this.workspaceId = sanitizeId(config.workspaceId || DEFAULT_WORKSPACE_ID);
    this.providerAvailable = config.providerAvailable !== false;
    this.beads.clear();
    this.eventFingerprints.clear();
    this.events.splice(0, this.events.length);
    this.resultNotes.clear();
    for (const bead of config.beads ?? []) {
      const safe = sanitizeGasCityBeadDto({ ...bead, workspaceId: bead.workspaceId || this.workspaceId });
      if (safe.id) this.beads.set(safe.id, safe);
    }
    return this.snapshot();
  }

  snapshot(): GasCityE2eFixtureSnapshot {
    return {
      fixture: {
        schemaVersion: "gas-city-e2e-fixture.v1",
        providerId: "gas_city_e2e_fixture",
        providerAvailable: this.providerAvailable,
        workspaceId: this.workspaceId,
        generatedAt: this.now(),
      },
      beads: [...this.beads.values()].map(cloneBead),
      events: this.events.map((event) => ({ ...event })),
      warnings: this.providerAvailable ? [] : ["Workflow fixture provider is unavailable."],
    };
  }

  applyEvent(input: GasCityE2eFixtureEventInput): GasCityE2eFixtureApplyResult {
    const event = sanitizeFixtureEvent(input, this.workspaceId, this.now());
    if (!event.eventId) return this.result("conflict", "A stable fixture event id is required.");
    const fingerprint = fixtureEventFingerprint(event, input.metadata ?? null);
    const existing = this.eventFingerprints.get(event.eventId);
    if (existing) {
      if (existing === fingerprint) return this.result("already_applied", "Fixture event is already applied.");
      return this.result("conflict", "Fixture event id was already used for different work.");
    }

    if (event.type === "simulate_provider_unavailable") {
      this.providerAvailable = false;
    } else {
      if (!event.beadId) return this.result("conflict", "A task bead is required for this fixture event.");
      const bead = this.beads.get(event.beadId) ?? defaultBead(event.workspaceId, event.beadId, input.title);
      this.beads.set(event.beadId, applyEventToBead(bead, event, input.metadata ?? null));
    }

    this.eventFingerprints.set(event.eventId, fingerprint);
    this.events.push(event);
    return this.result("applied", "Fixture event applied.");
  }

  async listBeads(input: GasCityBeadsListInput): Promise<GasCityBeadDto[]> {
    if (!this.providerAvailable) return [];
    return [...this.beads.values()].filter((bead) => {
      if (bead.workspaceId !== sanitizeId(input.workspaceId)) return false;
      if (input.parentBeadId && bead.parentBeadId !== input.parentBeadId) return false;
      if (input.convoyId && !bead.convoyIds.includes(input.convoyId)) return false;
      if (input.readiness && input.readiness !== "any" && bead.readiness !== input.readiness) return false;
      return true;
    }).map(cloneBead);
  }

  async getBeadsByIds(input: GasCityBeadsByIdInput): Promise<GasCityBeadDto[]> {
    if (!this.providerAvailable) return [];
    const workspaceId = sanitizeId(input.workspaceId);
    const output: GasCityBeadDto[] = [];
    for (const id of uniqueIds(input.beadIds)) {
      const bead = this.beads.get(id);
      if (bead && bead.workspaceId === workspaceId) output.push(cloneBead(bead));
    }
    return output;
  }

  async upsertWorkflowLinkage(input: GasCityWorkflowLinkageWriteInput): Promise<GasCityBeadsMutationResult> {
    if (!this.providerAvailable) return { status: "unavailable", message: "Workflow fixture provider is unavailable." };
    const bead = this.beads.get(sanitizeId(input.beadId));
    if (!bead || bead.workspaceId !== sanitizeId(input.workspaceId)) return { status: "unavailable", message: "Task bead is unavailable." };
    this.beads.set(bead.id, sanitizeGasCityBeadDto({
      ...bead,
      workflow: {
        workflowId: sanitizeId(input.workflow.workflowId ?? ""),
        rootBeadId: sanitizeId(input.workflow.rootBeadId ?? ""),
        sourceBeadId: bead.id,
        formula: sanitizeId(input.workflow.formula ?? ""),
        target: sanitizeId(input.workflow.target ?? ""),
        status: input.workflow.status ?? "running",
        updatedAt: this.now(),
      },
    }));
    return { status: "created", message: "Workflow linkage recorded." };
  }

  async writeWorkflowResultNote(input: GasCityWorkflowResultNoteWriteInput): Promise<GasCityBeadsMutationResult> {
    if (!this.providerAvailable) return { status: "unavailable", message: "Workflow fixture provider is unavailable." };
    const key = sanitizeId(input.idempotencyKey || input.noteKey);
    if (!key) return { status: "conflict", message: "A stable workflow result note key is required." };
    const note: ResultNoteRecord = {
      workspaceId: sanitizeId(input.workspaceId),
      beadId: sanitizeId(input.beadId),
      noteKey: sanitizeId(input.noteKey),
      summary: sanitizeGasCityProviderText(input.summary, "Workflow result recorded."),
      idempotencyKey: key,
    };
    const existing = this.resultNotes.get(key);
    if (existing) {
      return JSON.stringify(existing) === JSON.stringify(note)
        ? { status: "already_applied", message: "Workflow result note is already recorded." }
        : { status: "conflict", message: "Workflow result note key was already used for different work." };
    }
    const bead = this.beads.get(note.beadId);
    if (!bead || bead.workspaceId !== note.workspaceId) return { status: "unavailable", message: "Task bead is unavailable." };
    this.resultNotes.set(key, note);
    return { status: "created", message: "Workflow result note recorded." };
  }

  private result(status: GasCityE2eFixtureApplyResult["status"], message: string): GasCityE2eFixtureApplyResult {
    return { status, message: sanitizeGasCityProviderText(message, "Fixture event status is unavailable."), state: this.snapshot() };
  }
}

export function loadGasCityE2eFixtureConfigFromFile(filePath: string): GasCityE2eFixtureConfig {
  const parsed = JSON.parse(readFileSync(filePath, "utf8")) as Partial<GasCityE2eFixtureConfig>;
  return {
    workspaceId: typeof parsed.workspaceId === "string" ? parsed.workspaceId : DEFAULT_WORKSPACE_ID,
    providerAvailable: parsed.providerAvailable !== false,
    beads: Array.isArray(parsed.beads) ? parsed.beads as GasCityBeadDto[] : [],
  };
}

function sanitizeFixtureEvent(input: GasCityE2eFixtureEventInput, defaultWorkspaceId: string, now: number): GasCityE2eFixtureEventRecord {
  return {
    eventId: sanitizeId(input.eventId),
    type: normalizeEventType(input.type),
    workspaceId: sanitizeId(input.workspaceId || defaultWorkspaceId),
    beadId: input.beadId == null ? null : sanitizeId(input.beadId),
    summary: sanitizeGasCityProviderText(input.summary, "Fixture event recorded."),
    appliedAt: now,
  };
}

function normalizeEventType(type: string): GasCityE2eFixtureEventType {
  return [
    "mark_bead_ready",
    "record_agent_result_note",
    "mark_review_changes_requested",
    "mark_review_approved",
    "mark_tester_found_bug",
    "mark_tester_approved",
    "simulate_provider_unavailable",
  ].includes(type) ? type as GasCityE2eFixtureEventType : "record_agent_result_note";
}

function applyEventToBead(bead: GasCityBeadDto, event: GasCityE2eFixtureEventRecord, metadata: GasCityOpaqueMetadata | null): GasCityBeadDto {
  const safeMetadata = sanitizeMetadata(metadata ?? {});
  const next: GasCityBeadDto = {
    ...bead,
    title: sanitizeGasCityProviderText(bead.title, bead.id),
    metadata: { ...(bead.metadata ?? {}), ...safeMetadata, "fixture.last_event": event.type },
    updatedAt: event.appliedAt,
  };
  switch (event.type) {
    case "mark_bead_ready":
      return sanitizeGasCityBeadDto({ ...next, status: "ready", readiness: "ready" });
    case "mark_review_changes_requested":
      return sanitizeGasCityBeadDto({ ...next, status: "open", readiness: "not_ready", metadata: { ...(next.metadata ?? {}), "fixture.review": "changes_requested" } });
    case "mark_review_approved":
      return sanitizeGasCityBeadDto({ ...next, status: "ready", readiness: "ready", metadata: { ...(next.metadata ?? {}), "fixture.review": "approved" } });
    case "mark_tester_found_bug":
      return sanitizeGasCityBeadDto({ ...next, status: "blocked", readiness: "blocked", metadata: { ...(next.metadata ?? {}), "fixture.tester": "found_bug" } });
    case "mark_tester_approved":
      return sanitizeGasCityBeadDto({ ...next, status: "closed", readiness: "terminal", metadata: { ...(next.metadata ?? {}), "fixture.tester": "approved" } });
    case "record_agent_result_note":
    default:
      return sanitizeGasCityBeadDto({ ...next, metadata: { ...(next.metadata ?? {}), "fixture.result_summary": event.summary } });
  }
}

function defaultBead(workspaceId: string, beadId: string, title?: string | null): GasCityBeadDto {
  return sanitizeGasCityBeadDto({
    id: beadId,
    title: sanitizeGasCityProviderText(title ?? beadId, beadId),
    status: "open",
    readiness: "not_ready",
    workspaceId,
    parentBeadId: null,
    dependencyBeadIds: [],
    convoyIds: [],
    workflow: null,
    metadata: {},
    updatedAt: null,
  });
}

function fixtureEventFingerprint(event: GasCityE2eFixtureEventRecord, metadata: GasCityOpaqueMetadata | null): string {
  return JSON.stringify({ ...event, appliedAt: 0, metadata: sanitizeMetadata(metadata ?? {}) });
}

function sanitizeMetadata(metadata: GasCityOpaqueMetadata): GasCityOpaqueMetadata {
  const output: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(metadata)) {
    const safeKey = sanitizeId(key);
    if (!safeKey) continue;
    output[safeKey] = typeof value === "string" ? sanitizeGasCityProviderText(value, "") : value;
  }
  return output;
}

function uniqueIds(values: string[]): string[] {
  return [...new Set(values.map(sanitizeId).filter(Boolean))];
}

function sanitizeId(value: string): string {
  return String(value ?? "").trim().replace(/[^A-Za-z0-9_.:-]+/g, "-").slice(0, 160);
}

function cloneBead(bead: GasCityBeadDto): GasCityBeadDto {
  return JSON.parse(JSON.stringify(bead)) as GasCityBeadDto;
}

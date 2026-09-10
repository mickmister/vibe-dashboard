import {
  sanitizeGasCityProviderText,
  type GasCityProviderLaunchResult,
  type GasCityWorkflowProvider,
} from "./gasCityWorkflowProvider";
import { GasCityReadyBeadFanoutPreviewProvider, type ReadyBeadFanoutPreview, type ReadyBeadFanoutPreviewItem, type ReadyBeadFanoutPreviewRequest } from "./gasCityReadyBeadFanoutPreview";

export type ReadyBeadFanoutLaneStatus = "ready" | "clean" | "dirty" | "held" | "unknown" | "missing";
export type ReadyBeadFanoutLaunchItemStatus = "launched" | "already_running" | "skipped" | "blocked" | "failed";

export interface ReadyBeadFanoutLaneSelection {
  laneId: string;
  label?: string | null;
  status: ReadyBeadFanoutLaneStatus;
}

export interface ReadyBeadFanoutLaunchRequest {
  preview: ReadyBeadFanoutPreviewRequest;
  idempotencyKey: string;
  laneByBeadId: Record<string, ReadyBeadFanoutLaneSelection | null | undefined>;
  allowPartial?: boolean;
}

export interface ReadyBeadFanoutLaunchItem {
  beadId: string;
  title: string;
  status: ReadyBeadFanoutLaunchItemStatus;
  reasonCode?: string;
  message: string;
  formula?: string | null;
  lane: { laneId: string; label: string; status: "ready" } | null;
  workflow?: GasCityProviderLaunchResult["workflowRef"] | null;
  diagnosticsRef?: string | null;
}

export interface ReadyBeadFanoutLaunchResult {
  workspaceId: string;
  authoritativeSource: "gas_city_beads";
  advisory: true;
  idempotencyKey: string;
  preview: ReadyBeadFanoutPreview;
  status: "completed" | "partial" | "blocked";
  counts: {
    launched: number;
    alreadyRunning: number;
    skipped: number;
    blocked: number;
    failed: number;
  };
  items: ReadyBeadFanoutLaunchItem[];
  nextAction: string;
  warnings: string[];
  generatedAt: number;
}

export interface GasCityReadyBeadFanoutLauncherOptions {
  previewProvider: GasCityReadyBeadFanoutPreviewProvider;
  gasCityProvider: GasCityWorkflowProvider;
  now?: () => number;
  lockTtlMs?: number;
}

interface CachedFanoutLaunch {
  identity: string;
  result: ReadyBeadFanoutLaunchResult;
}

interface InFlightFanoutLaunch {
  identity: string;
  promise: Promise<ReadyBeadFanoutLaunchResult>;
}

interface WorkspaceLock {
  owner: string;
  expiresAt: number;
}

const DEFAULT_LOCK_TTL_MS = 30_000;

export class GasCityReadyBeadFanoutLauncher {
  private readonly previewProvider: GasCityReadyBeadFanoutPreviewProvider;
  private readonly gasCityProvider: GasCityWorkflowProvider;
  private readonly now: () => number;
  private readonly lockTtlMs: number;
  private readonly launchesByKey = new Map<string, CachedFanoutLaunch>();
  private readonly inFlightByKey = new Map<string, InFlightFanoutLaunch>();
  private readonly workspaceLocks = new Map<string, WorkspaceLock>();

  constructor(options: GasCityReadyBeadFanoutLauncherOptions) {
    this.previewProvider = options.previewProvider;
    this.gasCityProvider = options.gasCityProvider;
    this.now = options.now ?? (() => Date.now());
    this.lockTtlMs = options.lockTtlMs ?? DEFAULT_LOCK_TTL_MS;
  }

  async launchReadyBeads(request: ReadyBeadFanoutLaunchRequest): Promise<ReadyBeadFanoutLaunchResult> {
    const idempotencyKey = sanitizeId(request.idempotencyKey);
    if (!idempotencyKey) return blockedResult(request, "A stable fanout launch key is required.", this.now());
    const identity = launchIdentity(request);
    const cached = this.launchesByKey.get(idempotencyKey);
    if (cached) {
      if (cached.identity !== identity) return blockedResult(request, "This fanout launch key already belongs to different work.", this.now());
      return cloneResult(cached.result);
    }
    const inFlight = this.inFlightByKey.get(idempotencyKey);
    if (inFlight) {
      if (inFlight.identity !== identity) return blockedResult(request, "This fanout launch key already belongs to different work.", this.now());
      return cloneResult(await inFlight.promise);
    }

    const promise = this.performLaunchReadyBeads(request, idempotencyKey, identity);
    this.inFlightByKey.set(idempotencyKey, { identity, promise });
    try {
      return cloneResult(await promise);
    } finally {
      if (this.inFlightByKey.get(idempotencyKey)?.promise === promise) this.inFlightByKey.delete(idempotencyKey);
    }
  }

  private async performLaunchReadyBeads(request: ReadyBeadFanoutLaunchRequest, idempotencyKey: string, identity: string): Promise<ReadyBeadFanoutLaunchResult> {
    const preview = await this.previewProvider.previewReadyBeadFanout(request.preview);
    const lock = this.acquireWorkspaceLock(preview.workspaceId, idempotencyKey);
    if (!lock.ok) {
      return resultFromItems({
        request,
        preview,
        items: preview.items.map((item) => launchItemFromPreview(item, "blocked", "workspace_lock_conflict", "Another ready-task launch is already preparing work for this workspace.")),
        now: this.now(),
      });
    }

    try {
      const items: ReadyBeadFanoutLaunchItem[] = [];
      for (const item of preview.items) {
        if (item.status !== "will_launch") {
          items.push(launchItemFromPreview(item, item.status === "already_running" ? "already_running" : item.status, item.reasonCode, item.reason ?? statusMessage(item.status)));
          continue;
        }
        const lane = normalizeLane(request.laneByBeadId[item.beadId]);
        if (!lane) {
          items.push(launchItemFromPreview(item, "blocked", "lane_missing", "Choose a clean lane before launching this task bead."));
          continue;
        }
        if (lane.status !== "ready") {
          items.push(launchItemFromPreview(item, "blocked", `lane_${lane.status}`, laneBlockedMessage(lane.status)));
          continue;
        }
        const launch = await this.gasCityProvider.launchSourceWorkflow({
          context: request.preview.context,
          sourceBeadId: item.beadId,
          target: preview.target?.id ?? request.preview.target,
          formula: item.formula ?? preview.formula?.id ?? request.preview.formula ?? "",
          idempotencyKey: `${idempotencyKey}:${item.beadId}`,
          nudge: true,
          vars: { laneId: lane.laneId },
        });
        if (launch.status === "accepted") {
          items.push(launchItemFromPreview(item, "launched", undefined, launch.summary, lane, launch));
        } else if (launch.status === "already_running") {
          items.push(launchItemFromPreview(item, "already_running", "already_running", launch.summary, lane, launch));
        } else {
          items.push(launchItemFromPreview(item, "failed", "launch_failed", launch.summary, lane, launch));
        }
      }
      const result = resultFromItems({ request, preview, items, now: this.now() });
      this.launchesByKey.set(idempotencyKey, { identity, result: cloneResult(result) });
      return result;
    } finally {
      this.releaseWorkspaceLock(preview.workspaceId, idempotencyKey);
    }
  }

  private acquireWorkspaceLock(workspaceId: string, owner: string): { ok: true } | { ok: false } {
    const now = this.now();
    const existing = this.workspaceLocks.get(workspaceId);
    if (existing && existing.owner !== owner && existing.expiresAt > now) return { ok: false };
    this.workspaceLocks.set(workspaceId, { owner, expiresAt: now + this.lockTtlMs });
    return { ok: true };
  }

  private releaseWorkspaceLock(workspaceId: string, owner: string): void {
    const existing = this.workspaceLocks.get(workspaceId);
    if (existing?.owner === owner) this.workspaceLocks.delete(workspaceId);
  }
}

function resultFromItems(input: { request: ReadyBeadFanoutLaunchRequest; preview: ReadyBeadFanoutPreview; items: ReadyBeadFanoutLaunchItem[]; now: number }): ReadyBeadFanoutLaunchResult {
  const safeItems = input.items.map(sanitizeLaunchItem);
  const counts = {
    launched: safeItems.filter((item) => item.status === "launched").length,
    alreadyRunning: safeItems.filter((item) => item.status === "already_running").length,
    skipped: safeItems.filter((item) => item.status === "skipped").length,
    blocked: safeItems.filter((item) => item.status === "blocked").length,
    failed: safeItems.filter((item) => item.status === "failed").length,
  };
  const status = counts.failed > 0 || (counts.launched > 0 && counts.blocked + counts.skipped > 0) ? "partial" : counts.launched + counts.alreadyRunning > 0 && counts.blocked + counts.failed === 0 ? "completed" : "blocked";
  return {
    workspaceId: input.preview.workspaceId,
    authoritativeSource: "gas_city_beads",
    advisory: true,
    idempotencyKey: sanitizeId(input.request.idempotencyKey),
    preview: input.preview,
    status,
    counts,
    items: safeItems,
    nextAction: nextActionForLaunch(status, counts),
    warnings: input.preview.warnings.map((warning) => sanitizeGasCityProviderText(warning, "Workflow engine warning.")),
    generatedAt: input.now,
  };
}

function blockedResult(request: ReadyBeadFanoutLaunchRequest, message: string, now: number): ReadyBeadFanoutLaunchResult {
  const workspaceId = sanitizeId(request.preview.context.workspaceId);
  const preview: ReadyBeadFanoutPreview = {
    workspaceId,
    authoritativeSource: "gas_city_beads",
    advisory: true,
    formula: null,
    target: null,
    counts: { ready: 0, willLaunch: 0, skipped: 0, blocked: 0, alreadyRunning: 0, activeBefore: 0, capacity: 0, maxLaunches: 0 },
    items: [],
    nextAction: sanitizeGasCityProviderText(message, "Fanout launch is not available."),
    warnings: [],
    generatedAt: now,
  };
  return resultFromItems({ request, preview, items: [], now });
}

function launchItemFromPreview(
  item: ReadyBeadFanoutPreviewItem,
  status: ReadyBeadFanoutLaunchItemStatus,
  reasonCode?: string,
  message?: string,
  lane?: { laneId: string; label: string; status: "ready" } | null,
  launch?: GasCityProviderLaunchResult,
): ReadyBeadFanoutLaunchItem {
  return {
    beadId: item.beadId,
    title: item.title,
    status,
    reasonCode,
    message: message ?? statusMessage(status),
    formula: item.formula ?? null,
    lane: lane ?? null,
    workflow: launch?.workflowRef ?? null,
    diagnosticsRef: launch?.diagnosticsRef ?? null,
  };
}

function normalizeLane(lane: ReadyBeadFanoutLaneSelection | null | undefined): { laneId: string; label: string; status: "ready" } | { laneId: string; label: string; status: "dirty" | "held" | "unknown" | "missing" } | null {
  if (!lane) return null;
  const laneId = sanitizeId(lane.laneId);
  if (!laneId) return null;
  const rawStatus = lane.status === "clean" ? "ready" : lane.status;
  const status = ["ready", "dirty", "held", "unknown", "missing"].includes(rawStatus) ? rawStatus as "ready" | "dirty" | "held" | "unknown" | "missing" : "unknown";
  return { laneId, label: sanitizeGasCityProviderText(lane.label ?? laneId, laneId), status };
}

function laneBlockedMessage(status: Exclude<ReadyBeadFanoutLaneStatus, "ready" | "clean">): string {
  if (status === "missing") return "Choose a clean lane before launching this task bead.";
  if (status === "dirty") return "Resolve lane changes before launching this task bead.";
  if (status === "held") return "Lane is currently being used by another write operation.";
  return "Refresh lane status before launching this task bead.";
}

function nextActionForLaunch(status: ReadyBeadFanoutLaunchResult["status"], counts: ReadyBeadFanoutLaunchResult["counts"]): string {
  if (status === "completed") return `Started ${counts.launched} task workflow${counts.launched === 1 ? "" : "s"}.`;
  if (status === "partial") return "Review the task launch results before continuing.";
  return "Resolve blocked tasks before launching.";
}

function statusMessage(status: string): string {
  if (status === "already_running") return "Task bead already has an active workflow.";
  if (status === "skipped") return "Task bead was skipped.";
  if (status === "blocked") return "Task bead cannot launch yet.";
  return "Task bead launch status is available.";
}

function sanitizeLaunchItem(item: ReadyBeadFanoutLaunchItem): ReadyBeadFanoutLaunchItem {
  return {
    beadId: sanitizeId(item.beadId),
    title: sanitizeGasCityProviderText(item.title, item.beadId),
    status: item.status,
    reasonCode: item.reasonCode ? sanitizeId(item.reasonCode) : undefined,
    message: sanitizeGasCityProviderText(item.message, "Task launch status is available."),
    formula: item.formula ? sanitizeId(item.formula) : null,
    lane: item.lane ? { laneId: sanitizeId(item.lane.laneId), label: sanitizeGasCityProviderText(item.lane.label, item.lane.laneId), status: "ready" } : null,
    workflow: item.workflow ? { ...item.workflow } : null,
    diagnosticsRef: item.diagnosticsRef ? sanitizeId(item.diagnosticsRef) : null,
  };
}

function launchIdentity(request: ReadyBeadFanoutLaunchRequest): string {
  return JSON.stringify({
    workspaceId: sanitizeId(request.preview.context.workspaceId),
    target: sanitizeId(request.preview.target),
    formula: sanitizeId(request.preview.formula ?? ""),
    source: request.preview.source ?? {},
    limits: request.preview.limits ?? {},
    lanes: Object.entries(request.laneByBeadId).map(([beadId, lane]) => [sanitizeId(beadId), lane ? { laneId: sanitizeId(lane.laneId), status: lane.status } : null]).sort(([a], [b]) => String(a).localeCompare(String(b))),
  });
}

function cloneResult(result: ReadyBeadFanoutLaunchResult): ReadyBeadFanoutLaunchResult {
  return JSON.parse(JSON.stringify(result)) as ReadyBeadFanoutLaunchResult;
}

function sanitizeId(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9_.:-]+/g, "-").slice(0, 160);
}

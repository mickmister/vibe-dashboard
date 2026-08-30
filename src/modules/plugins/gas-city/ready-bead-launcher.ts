export type ReadyBeadStatus =
  | "open"
  | "in_progress"
  | "review"
  | "blocked"
  | "deferred"
  | "closed"
  | "archived"
  | "removed"
  | string;

export interface ReadyBead {
  id: string;
  title: string;
  status: ReadyBeadStatus;
  labels: string[];
  metadata: Record<string, string>;
  parentId?: string | null;
  convoyIds: string[];
}

export interface ReadyBeadLaunchInput {
  workspaceId: string;
  workspacePath?: string;
  target: string;
  formula?: string | null;
  formulaByBeadId?: Record<string, string | null | undefined>;
  parentBeadId?: string | null;
  convoyId?: string | null;
  limit?: number | null;
  maxActive?: number | null;
  vars?: Record<string, string>;
  nudge?: boolean;
}

export type ReadyBeadSkipReason =
  | "convoy_mismatch"
  | "terminal_status"
  | "already_launched"
  | "missing_formula"
  | "capacity_reached"
  | "limit_reached";

export interface ReadyBeadLaunchEntry {
  bead: ReadyBead;
  formula: string;
  stdout: string;
}

export interface ReadyBeadSkippedEntry {
  bead: ReadyBead;
  reason: ReadyBeadSkipReason;
  message: string;
}

export interface ReadyBeadLaunchError {
  bead: ReadyBead;
  formula: string;
  message: string;
}

export interface ReadyBeadLaunchResult {
  workspaceId: string;
  convoyId: string | null;
  lockKey: string;
  activeBefore: number;
  capacity: number;
  selected: ReadyBead[];
  launched: ReadyBeadLaunchEntry[];
  skipped: ReadyBeadSkippedEntry[];
  errors: ReadyBeadLaunchError[];
  failed: ReadyBeadLaunchError[];
}

export type ReadyBeadLauncherResult = ReadyBeadLaunchResult;

export interface ReadyBeadLaunchLock {
  withLock<T>(key: string, fn: () => Promise<T>): Promise<T>;
}

export interface GasCityReadyBeadLauncherDeps {
  lock: ReadyBeadLaunchLock;
  listReadyBeads(input: {
    workspaceId: string;
    workspacePath?: string;
    parentBeadId?: string | null;
    convoyId?: string | null;
  }): Promise<ReadyBead[]>;
  listConvoyMemberBeadIds?(input: {
    workspaceId: string;
    workspacePath?: string;
    cityPath?: string;
    convoyId: string;
  }): Promise<string[]>;
  listLiveSourceWorkflowBeadIds(input: {
    workspaceId: string;
    workspacePath?: string;
    parentBeadId?: string | null;
    convoyId?: string | null;
  }): Promise<string[]>;
  validateFormulaContract?(input: {
    workspaceId: string;
    workspacePath?: string;
    cityPath?: string;
    formula: string;
  }): Promise<{ contract: string | null }>;
  slingSourceWorkflow(input: {
    target: string;
    beadId: string;
    formula: string;
    vars: Record<string, string>;
    nudge: boolean;
  }): Promise<{ stdout: string }>;
}

const DEFAULT_MAX_ACTIVE = 1;
const TERMINAL_STATUSES = new Set(["closed", "archived", "removed"]);

/**
 * Thin VD launch coordinator for released Gas City.
 *
 * This class intentionally stops at the source-bead boundary: it selects ready
 * source beads, applies capacity under a VD lock, and invokes released
 * `gc sling <target> <bead> --on <formula>`. Gas City remains authoritative for
 * workflow creation, routing, checks, retries, and source-workflow singleton
 * state.
 */
export class GasCityReadyBeadLauncher {
  constructor(private readonly deps: GasCityReadyBeadLauncherDeps) {}

  async launchReady(input: ReadyBeadLaunchInput): Promise<ReadyBeadLaunchResult> {
    const workspaceId = cleanRequired(input.workspaceId, "workspaceId");
    const target = cleanRequired(input.target, "target");
    const convoyId = cleanOptional(input.convoyId);
    const lockKey = readyBeadLaunchLockKey(workspaceId);

    return this.deps.lock.withLock(lockKey, async () => {
      let convoyMemberIds: Set<string> | null = null;
      if (convoyId) {
        if (!this.deps.listConvoyMemberBeadIds) {
          throw new Error(
            "Convoy filtering requires released Gas City convoy membership support.",
          );
        }
        convoyMemberIds = new Set(
          await this.deps.listConvoyMemberBeadIds({
            workspaceId,
            workspacePath: input.workspacePath,
            convoyId,
          }),
        );
      }
      const ready = await this.deps.listReadyBeads({
        workspaceId,
        workspacePath: input.workspacePath,
        parentBeadId: input.parentBeadId,
        convoyId,
      });
      const activeSourceBeadIds = new Set(
        await this.deps.listLiveSourceWorkflowBeadIds({
          workspaceId,
          workspacePath: input.workspacePath,
          parentBeadId: input.parentBeadId,
          convoyId,
        }),
      );
      const activeBefore = activeSourceBeadIds.size;
      const maxActive = normalizeMaxActive(input.maxActive);
      const capacity = maxActive === 0 ? Number.MAX_SAFE_INTEGER : Math.max(0, maxActive - activeBefore);
      const launchLimit = normalizeLimit(input.limit);
      const vars = input.vars ?? {};
      const selected: ReadyBead[] = [];
      const launched: ReadyBeadLaunchEntry[] = [];
      const skipped: ReadyBeadSkippedEntry[] = [];
      const errors: ReadyBeadLaunchError[] = [];
      const formulaContractCache = new Map<string, Promise<{ contract: string | null }>>();

      for (const bead of ready) {
        if (convoyMemberIds && !convoyMemberIds.has(bead.id)) {
          skipped.push(skip(bead, "convoy_mismatch", `Bead is not part of convoy ${convoyId}.`));
          continue;
        }
        if (TERMINAL_STATUSES.has(bead.status)) {
          skipped.push(skip(bead, "terminal_status", `Bead status is ${bead.status}.`));
          continue;
        }
        if (activeSourceBeadIds.has(bead.id) || hasLiveGasCitySourceWorkflow(bead)) {
          skipped.push(skip(bead, "already_launched", "Bead already has a live Gas City source workflow."));
          continue;
        }
        if (selected.length >= capacity) {
          skipped.push(skip(bead, "capacity_reached", "Ready-bead launch capacity is exhausted."));
          continue;
        }
        if (selected.length >= launchLimit) {
          skipped.push(skip(bead, "limit_reached", "Ready-bead per-run launch limit is exhausted."));
          continue;
        }
        const formula =
          cleanOptional(input.formulaByBeadId?.[bead.id]) ??
          resolveFormula(bead, input.formula);
        if (!formula) {
          skipped.push(skip(bead, "missing_formula", "No formula was supplied and the bead has no formula metadata override."));
          continue;
        }

        selected.push(bead);
        try {
          const contract = await getFormulaContract(this.deps.validateFormulaContract, formulaContractCache, {
            formula,
            workspaceId,
            workspacePath: input.workspacePath,
          });
          if (contract !== "graph.v2") {
            throw new Error(`Formula ${formula} must be a graph.v2 formula for gc sling --on launches; got ${contract || "unknown"}.`);
          }
          const launch = await this.deps.slingSourceWorkflow({
            target,
            beadId: bead.id,
            formula,
            vars,
            nudge: input.nudge ?? false,
          });
          launched.push({ bead, formula, stdout: launch.stdout });
          activeSourceBeadIds.add(bead.id);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (isSourceWorkflowConflict(message)) {
            skipped.push(skip(bead, "already_launched", message));
            activeSourceBeadIds.add(bead.id);
          } else {
            errors.push({ bead, formula, message });
          }
        }
      }

      return {
        workspaceId,
        convoyId,
        lockKey,
        activeBefore,
        capacity,
        selected,
        launched,
        skipped,
        errors,
        failed: errors,
      };
    });
  }
}

async function getFormulaContract(
  validateFormulaContract: GasCityReadyBeadLauncherDeps["validateFormulaContract"],
  cache: Map<string, Promise<{ contract: string | null }>>,
  input: {
    formula: string;
    workspaceId: string;
    workspacePath?: string;
  },
): Promise<string | null> {
  if (!validateFormulaContract) return "graph.v2";
  let pending = cache.get(input.formula);
  if (!pending) {
    pending = validateFormulaContract(input);
    cache.set(input.formula, pending);
  }
  const result = await pending;
  return result.contract;
}

export interface BdCommandRunner {
  (args: string[], cwd: string): Promise<string>;
}

export class BdReadyBeadProvider {
  constructor(private readonly options: { runBd: BdCommandRunner }) {}

  async listReadyBeads(input: {
    workspacePath?: string;
    parentBeadId?: string | null;
  }): Promise<ReadyBead[]> {
    const cwd = cleanRequired(input.workspacePath ?? "", "workspacePath");
    const args = ["ready", "--json", "--limit", "0"];
    const parent = cleanOptional(input.parentBeadId);
    if (parent) {
      args.push("--parent", parent);
    }
    const stdout = await this.options.runBd(args, cwd);
    return parseBdJsonArrayOutput(stdout).map(toReadyBead);
  }
}

export class BdMetadataLiveSourceWorkflowReader {
  constructor(private readonly options: { runBd: BdCommandRunner }) {}

  async listLiveSourceWorkflowBeadIds(input: {
    workspacePath?: string;
    parentBeadId?: string | null;
  }): Promise<string[]> {
    const cwd = cleanRequired(input.workspacePath ?? "", "workspacePath");
    const ids = new Set<string>();
    for (const key of ["workflow_id", "gc.source_bead_id"]) {
      const args = ["list", "--json", "--all", "--has-metadata-key", key, "--limit", "0"];
      const stdout = await this.options.runBd(args, cwd);
      for (const raw of parseBdJsonArrayOutput(stdout)) {
        const bead = toReadyBead(raw);
        if (!bead.id || TERMINAL_STATUSES.has(bead.status)) {
          continue;
        }
        if (key === "gc.source_bead_id") {
          const sourceBeadId = cleanOptional(bead.metadata["gc.source_bead_id"]);
          if (sourceBeadId) ids.add(sourceBeadId);
        } else if (cleanOptional(bead.metadata.workflow_id)) {
          ids.add(bead.id);
        }
      }
    }
    return [...ids];
  }
}

export type GcCommandRunner = (args: string[], cwd: string) => Promise<string>;

export class GasCityConvoyMemberProvider {
  constructor(private readonly options: { runGc: GcCommandRunner }) {}

  async listConvoyMemberBeadIds(input: {
    cityPath?: string;
    convoyId: string;
  }): Promise<string[]> {
    const cwd = cleanRequired(input.cityPath ?? "", "cityPath");
    const convoyId = cleanRequired(input.convoyId, "convoyId");
    const stdout = await this.options.runGc(["convoy", "status", convoyId, "--json"], cwd);
    const payload = parseGasCityJsonObjectOutput(stdout);
    const children = Array.isArray(payload.children) ? payload.children : [];
    return children
      .map((child) => (isRecord(child) ? stringField(child.id) : ""))
      .filter(Boolean);
  }
}

export class GasCityFormulaContractValidator {
  constructor(private readonly options: { runGc: GcCommandRunner }) {}

  async validateFormulaContract(input: {
    cityPath?: string;
    formula: string;
  }): Promise<{ contract: string | null }> {
    const cwd = cleanRequired(input.cityPath ?? "", "cityPath");
    const formula = cleanRequired(input.formula, "formula");
    const stdout = await this.options.runGc(["formula", "show", formula, "--json"], cwd);
    const payload = parseGasCityJsonObjectOutput(stdout);
    const steps = Array.isArray(payload.steps) ? payload.steps : [];
    for (const step of steps) {
      if (!isRecord(step) || step.is_root !== true || !isRecord(step.metadata)) {
        continue;
      }
      const contract = stringField(step.metadata["gc.formula_contract"]);
      if (contract) return { contract };
    }
    if (isRecord(payload.metadata)) {
      const metadataContract =
        stringField(payload.metadata["gc.formula_contract"]) ||
        stringField(payload.metadata.contract);
      if (metadataContract) return { contract: metadataContract };
    }
    return { contract: null };
  }
}

export interface DirectoryReadyBeadSchedulerLockIo {
  mkdir(path: string, options?: { recursive?: boolean }): Promise<unknown>;
  rm(path: string): Promise<unknown>;
  writeFile(path: string, contents: string): Promise<unknown>;
  readFile(path: string): Promise<string | Buffer>;
  stat(path: string): Promise<unknown>;
  join(...parts: string[]): string;
}

export class DirectoryReadyBeadSchedulerLock implements ReadyBeadLaunchLock {
  constructor(
    private readonly options: {
      io: DirectoryReadyBeadSchedulerLockIo;
      lockRoot: string;
      staleMs?: number;
      retryDelayMs?: number;
      maxWaitMs?: number;
      now?: () => number;
    },
  ) {}

  async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const now = this.options.now ?? Date.now;
    const retryDelayMs = this.options.retryDelayMs ?? 50;
    const maxWaitMs = this.options.maxWaitMs ?? 30_000;
    const startedAt = now();
    const lockDir = this.options.io.join(this.options.lockRoot, encodeLockKey(key));
    await this.options.io.mkdir(this.options.lockRoot, { recursive: true });

    while (true) {
      try {
        await this.options.io.mkdir(lockDir);
        break;
      } catch (error) {
        if (!isErrno(error, "EEXIST")) throw error;
        await this.removeStaleLock(lockDir, now());
        try {
          await this.options.io.mkdir(lockDir);
          break;
        } catch (retryError) {
          if (!isErrno(retryError, "EEXIST")) throw retryError;
        }
        if (now() - startedAt >= maxWaitMs) {
          throw new Error(`Timed out waiting for ready-bead scheduler lock ${key}`);
        }
        await sleep(retryDelayMs);
      }
    }

    try {
      await this.options.io.writeFile(
        this.options.io.join(lockDir, "owner.json"),
        JSON.stringify({ key, pid: process.pid, acquiredAt: new Date(now()).toISOString() }),
      );
      return await fn();
    } finally {
      await this.options.io.rm(lockDir);
    }
  }

  private async removeStaleLock(lockDir: string, nowMs: number): Promise<void> {
    const staleMs = this.options.staleMs;
    if (staleMs == null || staleMs <= 0) return;
    const ownerPath = this.options.io.join(lockDir, "owner.json");
    let acquiredAtMs: number | null = null;
    try {
      const contents = String(await this.options.io.readFile(ownerPath));
      const parsed = JSON.parse(contents) as unknown;
      if (isRecord(parsed) && typeof parsed.acquiredAt === "string") {
        const parsedMs = Date.parse(parsed.acquiredAt);
        if (Number.isFinite(parsedMs)) acquiredAtMs = parsedMs;
      }
    } catch {
      // Fall back to directory mtime below.
    }
    if (acquiredAtMs == null) {
      try {
        const stat = await this.options.io.stat(lockDir);
        if (isRecord(stat) && stat.mtimeMs != null) {
          const mtimeMs = Number(stat.mtimeMs);
          if (Number.isFinite(mtimeMs)) acquiredAtMs = mtimeMs;
        }
      } catch {
        return;
      }
    }
    if (acquiredAtMs != null && nowMs - acquiredAtMs >= staleMs) {
      await this.options.io.rm(lockDir);
    }
  }
}

export function createInMemoryReadyBeadLaunchLock(): ReadyBeadLaunchLock {
  const tails = new Map<string, Promise<void>>();
  return {
    async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
      const previous = tails.get(key) ?? Promise.resolve();
      let release!: () => void;
      const current = new Promise<void>((resolve) => {
        release = resolve;
      });
      const tail = previous.then(() => current, () => current);
      tails.set(key, tail);
      await previous.catch(() => {});
      try {
        return await fn();
      } finally {
        release();
        if (tails.get(key) === tail) {
          tails.delete(key);
        }
      }
    },
  };
}

export function readyBeadLaunchLockKey(
  workspaceId: string,
  _convoyId?: string | null,
): string {
  return `vd.ready-bead-launcher.workspace.${workspaceId}`;
}

export function resolveFormula(
  bead: Pick<ReadyBead, "metadata">,
  fallbackFormula?: string | null,
): string | null {
  return (
    cleanOptional(bead.metadata["vd.gas_city.formula"]) ??
    cleanOptional(bead.metadata["gc.formula"]) ??
    cleanOptional(fallbackFormula)
  );
}

export function hasLiveGasCitySourceWorkflow(
  bead: Pick<ReadyBead, "metadata">,
): boolean {
  return Boolean(cleanOptional(bead.metadata.workflow_id));
}

export function parseBdJsonArrayOutput(stdout: string): unknown[] {
  const start = stdout.indexOf("[");
  const end = stdout.lastIndexOf("]");
  if (start < 0 || end < start) {
    throw new Error("bd command did not return a JSON array");
  }
  const parsed = JSON.parse(stdout.slice(start, end + 1)) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("bd command did not return a JSON array");
  }
  return parsed;
}

export function parseGasCityJsonObjectOutput(stdout: string): Record<string, unknown> {
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start < 0 || end < start) {
    throw new Error("Gas City command did not return a JSON object");
  }
  const parsed = JSON.parse(stdout.slice(start, end + 1)) as unknown;
  if (!isRecord(parsed)) {
    throw new Error("Gas City command did not return a JSON object");
  }
  return parsed;
}

export function toReadyBead(raw: unknown): ReadyBead {
  const record = isRecord(raw) ? raw : {};
  const metadata = normalizeMetadata(record.metadata);
  return {
    id: stringField(record.id),
    title: stringField(record.title),
    status: stringField(record.status) || "open",
    labels: stringArray(record.labels),
    metadata,
    parentId: cleanOptional(stringField(record.parent) || stringField(record.parent_id)),
    convoyIds: normalizeConvoyIds(record, metadata),
  };
}

function normalizeConvoyIds(
  record: Record<string, unknown>,
  metadata: Record<string, string>,
): string[] {
  const fromRecord = [
    ...stringArray(record.convoy_ids),
    ...stringArray(record.convoyIds),
  ];
  const fromMetadata = [
    ...commaSeparated(metadata["vd.gas_city.convoy_id"]),
    ...commaSeparated(metadata["gc.convoy_id"]),
    ...commaSeparated(metadata["gc.convoy_ids"]),
  ];
  return [...new Set([...fromRecord, ...fromMetadata].filter(Boolean))];
}

function skip(
  bead: ReadyBead,
  reason: ReadyBeadSkipReason,
  message: string,
): ReadyBeadSkippedEntry {
  return { bead, reason, message };
}

function isSourceWorkflowConflict(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    (lower.includes("source workflow") || lower.includes("source bead")) &&
    (lower.includes("already") || lower.includes("live workflow") || lower.includes("conflict"))
  );
}

function normalizeMaxActive(value: number | null | undefined): number {
  if (value == null) return DEFAULT_MAX_ACTIVE;
  if (!Number.isFinite(value)) return DEFAULT_MAX_ACTIVE;
  return Math.max(0, Math.floor(value));
}

function normalizeLimit(value: number | null | undefined): number {
  if (value == null || value === 0) return Number.POSITIVE_INFINITY;
  if (!Number.isFinite(value)) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor(value));
}

function cleanRequired(value: string, label: string): string {
  const cleaned = value.trim();
  if (!cleaned) throw new Error(`${label} is required.`);
  return cleaned;
}

function cleanOptional(value: string | null | undefined): string | null {
  const cleaned = value?.trim();
  return cleaned || null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeMetadata(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const result: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === "string") {
      result[key] = raw;
    } else if (raw != null && typeof raw !== "object") {
      result[key] = String(raw);
    }
  }
  return result;
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function commaSeparated(value: string | undefined): string[] {
  return value?.split(",").map((entry) => entry.trim()).filter(Boolean) ?? [];
}

function encodeLockKey(key: string): string {
  return key.replace(/[^A-Za-z0-9_.-]+/g, "_").slice(0, 180) || "default";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isErrno(error: unknown, code: string): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === code,
  );
}

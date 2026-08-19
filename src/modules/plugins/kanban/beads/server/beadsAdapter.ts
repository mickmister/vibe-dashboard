import { execFile } from 'node:child_process';
import { basename } from 'node:path';
import { promisify } from 'node:util';
import type {
  ExternalKanbanBoardViewDto,
  ExternalKanbanCardDto,
  ExternalKanbanColumnDto,
} from '../../boardTypes';

const execFileAsync = promisify(execFile);

export const BEADS_EXPORT_CACHE_TTL_MS = 30_000;
export const BEADS_COMMAND_TIMEOUT_MS = 15_000;

export interface BdCommandResult {
  stdout: string;
  stderr?: string;
}

export type RunBdCommand = (args: string[], options?: { cwd?: string; timeoutMs?: number }) => Promise<BdCommandResult>;

export type BeadsBoardView = ExternalKanbanBoardViewDto<'beads', {
  id: string;
  name: string;
  url: string;
  sourceDirectory: string;
}, {
  source: 'bd-export';
  cache: 'fresh' | 'cached' | 'stale';
  staleReason?: string;
  lastFetchedAt: string;
  statusSource: 'bd-statuses' | 'export';
  hiddenCompletedCount: number;
}>;

export interface FetchBeadsBoardOptions {
  sourceDirectory: string;
  sourceUrl?: string;
  savedViewId?: string;
  rulesVersion?: string;
  repoId?: string;
  showCompleted?: boolean;
  refresh?: boolean;
  now?: () => number;
  runBd?: RunBdCommand;
}

interface CacheEntry {
  fetchedAt: number;
  raw: RawBeadsSnapshot;
}

interface RawBeadsSnapshot {
  beads: ExportedBead[];
  statuses: BeadsStatus[];
  statusSource: 'bd-statuses' | 'export';
}

interface BeadsStatus {
  id: string;
  title: string;
  category?: string;
}

interface ExportedBead {
  id: string;
  title?: string;
  description?: string;
  status?: string;
  priority?: number | string;
  issue_type?: string;
  assignee?: string | null;
  owner?: string | null;
  labels?: string[];
  metadata?: Record<string, unknown>;
  dependency_count?: number;
  dependent_count?: number;
  comment_count?: number;
  created_at?: string;
  updated_at?: string;
  closed_at?: string | null;
}

const cache = new Map<string, CacheEntry>();

export async function fetchBeadsBoardView(options: FetchBeadsBoardOptions): Promise<{ ok: true; boardView: BeadsBoardView } | { ok: false; error: { code: string; message: string; userAction: string } }> {
  const now = options.now ?? Date.now;
  const fetchedAt = now();
  const cacheKey = buildCacheKey(options);
  const existing = cache.get(cacheKey);

  if (!options.refresh && existing && fetchedAt - existing.fetchedAt < BEADS_EXPORT_CACHE_TTL_MS) {
    return { ok: true, boardView: buildBoardView({ raw: existing.raw, options, fetchedAt: existing.fetchedAt, cacheState: 'cached' }) };
  }

  try {
    const raw = await fetchRawBeadsSnapshot(options);
    cache.set(cacheKey, { fetchedAt, raw });
    return { ok: true, boardView: buildBoardView({ raw, options, fetchedAt, cacheState: 'fresh' }) };
  } catch (error) {
    if (existing) {
      return {
        ok: true,
        boardView: buildBoardView({
          raw: existing.raw,
          options,
          fetchedAt: existing.fetchedAt,
          cacheState: 'stale',
          staleReason: error instanceof Error ? error.message : 'Beads export failed.',
        }),
      };
    }
    return {
      ok: false,
      error: {
        code: 'beads_export_failed',
        message: 'Could not load Beads for this Kanban view.',
        userAction: 'Verify this source directory has a Beads database and try again.',
      },
    };
  }
}

export function clearBeadsBoardCache(): void {
  cache.clear();
}

export async function defaultRunBd(args: string[], options: { cwd?: string; timeoutMs?: number } = {}): Promise<BdCommandResult> {
  const result = await execFileAsync('bd', args, {
    cwd: options.cwd,
    timeout: options.timeoutMs ?? BEADS_COMMAND_TIMEOUT_MS,
    maxBuffer: 8 * 1024 * 1024,
  });
  return { stdout: result.stdout, stderr: result.stderr };
}

function buildCacheKey(options: FetchBeadsBoardOptions): string {
  return JSON.stringify({
    sourceDirectory: options.sourceDirectory,
    repoId: options.repoId ?? '',
    savedViewId: options.savedViewId ?? 'default',
    rulesVersion: options.rulesVersion ?? 'default',
  });
}

async function fetchRawBeadsSnapshot(options: FetchBeadsBoardOptions): Promise<RawBeadsSnapshot> {
  const runBd = options.runBd ?? defaultRunBd;
  const [exportResult, statusesResult] = await Promise.all([
    runBd(['-C', options.sourceDirectory, 'export'], { timeoutMs: BEADS_COMMAND_TIMEOUT_MS }),
    fetchBdStatuses(runBd, options.sourceDirectory),
  ]);
  const beads = parseBeadsExport(exportResult.stdout);
  const statuses = statusesResult ?? statusesFromExport(beads);
  return {
    beads,
    statuses: statuses.length > 0 ? statuses : statusesFromExport(beads),
    statusSource: statusesResult && statuses.length > 0 ? 'bd-statuses' : 'export',
  };
}

function buildBoardView({
  raw,
  options,
  fetchedAt,
  cacheState,
  staleReason,
}: {
  raw: RawBeadsSnapshot;
  options: FetchBeadsBoardOptions;
  fetchedAt: number;
  cacheState: 'fresh' | 'cached' | 'stale';
  staleReason?: string;
}): BeadsBoardView {
  const completedStatusIds = new Set(raw.statuses.filter(isCompletedLikeStatus).map((status) => status.id));
  const hiddenCompletedCount = raw.beads.filter((bead) => !options.showCompleted && completedStatusIds.has(normalizeStatusId(bead.status))).length;
  const visibleBeads = raw.beads.filter((bead) => options.showCompleted || !completedStatusIds.has(normalizeStatusId(bead.status)));
  const columns = raw.statuses
    .filter((status) => options.showCompleted || !isCompletedLikeStatus(status))
    .map(statusToColumn);
  const fallbackColumns = columns.length > 0 ? columns : statusesFromExport(visibleBeads).map(statusToColumn);

  return {
    provider: 'beads',
    viewMode: 'board',
    sourceUrl: options.sourceUrl ?? `beads://${options.sourceDirectory}`,
    siteHostname: options.sourceDirectory,
    resource: {
      id: options.sourceDirectory,
      name: basename(options.sourceDirectory) || options.sourceDirectory,
      url: options.sourceDirectory,
      sourceDirectory: options.sourceDirectory,
    },
    board: {
      id: options.savedViewId ?? 'default',
      name: 'Beads workflow',
      type: 'beads-status-board',
    },
    columns: fallbackColumns,
    cards: visibleBeads.map(beadToCard).sort((left, right) => left.rank - right.rank),
    swimlanes: { fidelity: 'none', lanes: [] },
    pagination: {
      pageCount: 1,
      issueCount: visibleBeads.length,
      maxResults: visibleBeads.length,
    },
    diagnostics: {
      source: 'bd-export',
      cache: cacheState,
      staleReason,
      lastFetchedAt: new Date(fetchedAt).toISOString(),
      statusSource: raw.statusSource,
      hiddenCompletedCount,
    },
  };
}

function parseBeadsExport(stdout: string): ExportedBead[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ExportedBead)
    .filter((bead) => typeof bead.id === 'string' && bead.id.length > 0);
}

async function fetchBdStatuses(runBd: RunBdCommand, sourceDirectory: string): Promise<BeadsStatus[] | undefined> {
  const jsonResult = await runBd(['-C', sourceDirectory, 'statuses', '--json'], { timeoutMs: BEADS_COMMAND_TIMEOUT_MS }).catch(() => undefined);
  const jsonStatuses = jsonResult ? parseBdStatusesJson(jsonResult.stdout) : [];
  if (jsonStatuses.length > 0) return jsonStatuses;

  const textResult = await runBd(['-C', sourceDirectory, 'statuses'], { timeoutMs: BEADS_COMMAND_TIMEOUT_MS }).catch(() => undefined);
  const textStatuses = textResult ? parseBdStatuses(textResult.stdout) : [];
  return textStatuses.length > 0 ? textStatuses : undefined;
}

export function parseBdStatusesJson(stdout: string): BeadsStatus[] {
  try {
    const parsed = JSON.parse(stdout) as unknown;
    if (!isPlainObject(parsed)) return [];
    const statuses = [
      ...statusesFromJsonArray(parsed.built_in_statuses),
      ...statusesFromJsonArray(parsed.custom_statuses),
    ];
    return uniqueStatuses(statuses);
  } catch {
    return [];
  }
}

export function parseBdStatuses(stdout: string): BeadsStatus[] {
  const statuses: BeadsStatus[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const match = line.match(/^\s*\S+\s+([A-Za-z0-9_.-]+)\s+\[([^\]]+)\]/u);
    if (!match) continue;
    const statusId = match[1]!;
    statuses.push({
      id: normalizeStatusId(statusId),
      title: humanizeStatus(statusId),
      category: match[2]!.trim(),
    });
  }
  return uniqueStatuses(statuses);
}

function statusesFromExport(beads: ExportedBead[]): BeadsStatus[] {
  const seen = new Set<string>();
  const statuses: BeadsStatus[] = [];
  for (const bead of beads) {
    const id = normalizeStatusId(bead.status);
    if (seen.has(id)) continue;
    seen.add(id);
    statuses.push({ id, title: humanizeStatus(id), category: id === 'closed' ? 'done' : undefined });
  }
  return statuses;
}

function statusToColumn(status: BeadsStatus): ExternalKanbanColumnDto {
  return { id: status.id, title: status.title, statusIds: [status.id] };
}

function beadToCard(bead: ExportedBead, index: number): ExternalKanbanCardDto {
  const statusId = normalizeStatusId(bead.status);
  const dependencyCount = numberOrZero(bead.dependency_count);
  const dependentCount = numberOrZero(bead.dependent_count);
  const metadata = bead.metadata && typeof bead.metadata === 'object' ? bead.metadata : {};
  return {
    id: bead.id,
    key: bead.id,
    title: bead.title ?? bead.id,
    url: `beads://${bead.id}`,
    statusId,
    statusName: humanizeStatus(bead.status ?? statusId),
    columnId: statusId,
    issueType: bead.issue_type,
    priority: bead.priority === undefined ? undefined : String(bead.priority),
    assignee: bead.assignee || bead.owner ? { displayName: String(bead.assignee ?? bead.owner) } : undefined,
    labels: Array.isArray(bead.labels) ? bead.labels.filter((label): label is string => typeof label === 'string') : [],
    rank: index,
    metadata: {
      ...metadata,
      provider: 'beads',
      dependencyCount,
      dependentCount,
      commentCount: numberOrZero(bead.comment_count),
      createdAt: bead.created_at,
      updatedAt: bead.updated_at,
      closedAt: bead.closed_at,
      ageDays: ageDays(bead.created_at),
    },
  };
}

function isCompletedLikeStatus(status: BeadsStatus): boolean {
  const value = `${status.id} ${status.category ?? ''}`.toLocaleLowerCase();
  return /\b(closed|done|resolved|complete|completed)\b/.test(value);
}

function normalizeStatusId(status: string | null | undefined): string {
  return (status?.trim() || 'open').toLocaleLowerCase();
}

function humanizeStatus(status: string): string {
  return status
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toLocaleUpperCase());
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function ageDays(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return undefined;
  return Math.max(0, Math.floor((Date.now() - timestamp) / 86_400_000));
}

function statusesFromJsonArray(value: unknown): BeadsStatus[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isPlainObject(entry) || typeof entry.name !== 'string') return [];
    return [{
      id: normalizeStatusId(entry.name),
      title: humanizeStatus(entry.name),
      category: typeof entry.category === 'string' ? entry.category.trim() : undefined,
    }];
  });
}

function uniqueStatuses(statuses: BeadsStatus[]): BeadsStatus[] {
  const seen = new Set<string>();
  const unique: BeadsStatus[] = [];
  for (const status of statuses) {
    if (!status.id || seen.has(status.id)) continue;
    seen.add(status.id);
    unique.push(status);
  }
  return unique;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype;
}

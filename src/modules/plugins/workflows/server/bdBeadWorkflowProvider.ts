import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { BeadMetadataProvider, BeadReadModel } from './beadMetaWorkflowRuntime';
import type { LiveRoadmapBeadStatus, WorkflowRoadmapLiveProvider } from './workflowRoadmapReadModel';

const execFileAsync = promisify(execFile);

export interface BdBeadWorkflowProviderOptions {
  command?: string;
  cwd?: string;
  timeoutMs?: number;
}

export interface BdWorkflowProviders {
  beadProvider: BeadMetadataProvider;
  roadmapProvider: WorkflowRoadmapLiveProvider;
}

export function createBdWorkflowProviders(options: BdBeadWorkflowProviderOptions = {}): BdWorkflowProviders {
  const client = new BdBeadClient(options);
  return {
    beadProvider: {
      readBeads: async (beadIds) => (await client.readRoadmapBeads(beadIds)).beads.map(mapLiveToBeadReadModel),
      searchBeads: async (input) => client.searchBeads(input),
    },
    roadmapProvider: {
      providerId: 'typed-bd-bead-provider',
      label: 'Live bead provider',
      description: 'Read-only typed bead status provider. It does not expose raw bead commands to the browser.',
      readBeads: async (beadIds, _context) => client.readRoadmapBeads(beadIds),
      listMetaRuns: async () => [],
    },
  };
}

class BdBeadClient {
  private readonly command: string;
  private readonly cwd: string;
  private readonly timeoutMs: number;

  constructor(options: BdBeadWorkflowProviderOptions = {}) {
    this.command = options.command ?? process.env.VD_BD_BIN ?? 'bd';
    this.cwd = options.cwd ?? process.env.VD_BD_CWD ?? process.cwd();
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async readRoadmapBeads(beadIds: string[]): Promise<{ beads: LiveRoadmapBeadStatus[]; partial: boolean; stale: boolean; updatedAt: number | null; warnings: string[] }> {
    const uniqueIds = Array.from(new Set(beadIds.map((id) => id.trim()).filter(Boolean)));
    const beads: LiveRoadmapBeadStatus[] = [];
    const warnings: string[] = [];
    for (const beadId of uniqueIds) {
      try {
        const rows = await this.runJsonArray(['show', beadId, '--json']);
        const bead = rows.find((row) => asString(row.id) === beadId) ?? rows[0];
        if (bead) beads.push(mapBdIssue(bead));
      } catch {
        warnings.push(`Roadmap bead ${beadId} could not be loaded.`);
      }
    }
    return {
      beads,
      partial: beads.length < uniqueIds.length,
      stale: false,
      updatedAt: latestUpdatedAt(beads),
      warnings,
    };
  }

  async searchBeads(input: { workspaceId: string; query?: string; scope: 'current_workspace' | 'no_workspace' | 'other_workspaces'; limit?: number }): Promise<BeadReadModel[]> {
    const rows = await this.runJsonArray(['list', '--json']);
    const query = input.query?.trim().toLowerCase() ?? '';
    const limit = Math.max(1, Math.min(input.limit ?? 25, 100));
    return rows
      .map(mapBdIssue)
      .filter((bead) => matchesQuery(bead, query))
      .filter((bead) => matchesScope(bead, input))
      .slice(0, limit)
      .map(mapLiveToBeadReadModel);
  }

  private async runJsonArray(args: string[]): Promise<Array<Record<string, unknown>>> {
    const { stdout } = await execFileAsync(this.command, args, {
      cwd: this.cwd,
      timeout: this.timeoutMs,
      maxBuffer: 1024 * 1024 * 8,
    });
    const parsed = JSON.parse(stdout) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecord);
  }
}

function mapBdIssue(row: Record<string, unknown>): LiveRoadmapBeadStatus {
  const labels = Array.isArray(row.labels) ? row.labels.filter((label): label is string => typeof label === 'string') : [];
  return {
    beadId: asString(row.id) || 'unknown-bead',
    title: asString(row.title) || null,
    status: mapBdStatus(asString(row.status)),
    summary: asString(row.notes) || asString(row.description) || null,
    workspaceId: asString(row.workspaceId) || asString(row.workspace_id) || null,
    labels,
    updatedAt: Date.parse(asString(row.updated_at) || asString(row.updatedAt) || '') || null,
    url: null,
  };
}

function mapLiveToBeadReadModel(bead: LiveRoadmapBeadStatus): BeadReadModel {
  return {
    beadId: bead.beadId,
    title: bead.title ?? bead.beadId,
    status: bead.status === 'tester' ? 'review' : bead.status,
    workspaceId: bead.workspaceId ?? null,
    accessible: bead.status !== 'removed',
    labels: bead.labels ?? [],
    url: null,
  };
}

function mapBdStatus(status: string): LiveRoadmapBeadStatus['status'] {
  if (status === 'closed') return 'closed';
  if (status === 'in_progress') return 'in_progress';
  if (status === 'review') return 'review';
  if (status === 'tester') return 'tester';
  if (status === 'blocked') return 'blocked';
  if (status === 'archived') return 'archived';
  if (status === 'removed') return 'removed';
  return 'open';
}

function matchesQuery(bead: LiveRoadmapBeadStatus, query: string): boolean {
  if (!query) return true;
  const haystack = [bead.beadId, bead.title, bead.summary, ...(bead.labels ?? [])]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(query);
}

function matchesScope(bead: LiveRoadmapBeadStatus, input: { workspaceId: string; scope: 'current_workspace' | 'no_workspace' | 'other_workspaces' }): boolean {
  if (input.scope === 'no_workspace') return bead.workspaceId == null;
  if (input.scope === 'other_workspaces') return bead.workspaceId != null && bead.workspaceId !== input.workspaceId;
  return bead.workspaceId == null || bead.workspaceId === input.workspaceId;
}

function latestUpdatedAt(beads: LiveRoadmapBeadStatus[]): number | null {
  const values = beads.map((bead) => bead.updatedAt).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return values.length ? Math.max(...values) : null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

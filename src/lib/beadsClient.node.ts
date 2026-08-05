/// <reference types="node" />

import { execFile } from 'node:child_process';
import { access, readdir, realpath } from 'node:fs/promises';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';

import {
  appendBeadsFormResponse,
  assertMetadataFitsDoltTextColumn,
  buildPrettySummary,
  getBeadsForms,
  getSupportedBeadsForms,
  selectBeadsForm,
  withBeadsFormsSummary,
  validateSubmittedValues,
  type BeadLike,
  type BeadsFormDefinition,
  type JsonObject,
} from './beadsFormCore.ts';

const execFileAsync = promisify(execFile);

export type ExecFileLike = (
  file: string,
  args: readonly string[],
  options: { cwd: string; timeout: number; maxBuffer?: number },
) => Promise<{ stdout: string | Buffer; stderr: string | Buffer }>;

export type BeadsClientOptions = {
  bdPath?: string;
  execFile?: ExecFileLike;
  now?: () => Date;
  actor?: string;
  reviewLabel?: string;
};

export type SubmitBeadsFormInput = {
  dir: string;
  beadId: string;
  formId: string;
  values: JsonObject;
};

export type SubmitBeadsFormResult = {
  beadId: string;
  formId: string;
  values: JsonObject;
  prettySummary: string;
  metadata: JsonObject;
  reviewLabel: string;
  warnings: string[];
};

export type BeadsWorkspaceRepo = {
  id: string;
  name: string;
  display_name?: string;
  target_branch?: string;
};

export type BeadsRepoListResult = {
  repo: BeadsWorkspaceRepo;
  dir: string;
  dirExists?: boolean;
  initialized: boolean;
  beads: BeadLike[];
  unscopedCount: number;
  otherWorkspaceCount: number;
  error?: string;
};

export type ListWorkspaceBeadsResult = {
  workspaceId: string;
  repos: BeadsRepoListResult[];
};

export type PendingBeadsFormEntry = {
  repoDir: string;
  repoName: string;
  bead: Pick<BeadLike, 'id' | 'title' | 'description' | 'createdAt' | 'updatedAt'>;
  form: Pick<BeadsFormDefinition, 'id' | 'title' | 'description'> & { responseCount: number };
};

export type PendingBeadsFormQueueResult = {
  reposRoot: string;
  repoLimit: number;
  reposScanned: number;
  entries: PendingBeadsFormEntry[];
  skipped: Array<{ repoDir: string; reason: string }>;
  updateStrategy: {
    mode: 'explicit-refresh';
    rationale: string;
  };
};

export class BeadsClient {
  private readonly bdPath: string;
  private readonly exec: ExecFileLike;
  private readonly now: () => Date;
  private readonly actor: string;
  private readonly reviewLabel: string;

  constructor(options: BeadsClientOptions = {}) {
    this.bdPath = options.bdPath ?? 'bd';
    this.exec = options.execFile ?? ((file, args, opts) => execFileAsync(file, [...args], opts));
    this.now = options.now ?? (() => new Date());
    this.actor = options.actor ?? 'user';
    this.reviewLabel = options.reviewLabel ?? 'needs-agent-review';
  }

  async readBead(dir: string, beadId: string): Promise<BeadLike> {
    try {
      const listed = await this.listBeadsById(dir, beadId);
      const bead = listed.find((candidate) => candidate.id === beadId);
      if (!bead) throw new Error(`Bead not found: ${beadId}`);
      if (isObject(bead.metadata)) return bead;
    } catch (error) {
      if (isBeadNotFoundError(error, beadId)) throw error;
      // Older bd versions or schema-skewed list output can fail here. Fall back
      // to the slower show path so direct bead URLs and submissions still work.
    }
    return this.readBeadByShow(dir, beadId);
  }

  private async readBeadByShow(dir: string, beadId: string): Promise<BeadLike> {
    const { stdout } = await this.exec(this.bdPath, ['--readonly', 'show', beadId, '--json', '--long'], {
      cwd: dir,
      timeout: 30_000,
      maxBuffer: 1024 * 1024 * 5,
    });
    const text = String(stdout);
    const jsonStart = text.indexOf('[');
    const jsonText = jsonStart >= 0 ? text.slice(jsonStart) : text;
    const beads = JSON.parse(jsonText) as BeadLike[];
    const bead = beads.find((candidate) => candidate.id === beadId);
    if (!bead) throw new Error(`Bead not found: ${beadId}`);
    return bead;
  }

  async readForms(dir: string, beadId: string): Promise<{ bead: BeadLike; forms: BeadsFormDefinition[] }> {
    const bead = await this.readBead(dir, beadId);
    return { bead, forms: getBeadsForms(bead.metadata) };
  }

  async listWorkspaceBeads(input: {
    workspaceId: string;
    workspaceDir: string;
    agentWorkingDir?: string | null;
    repos: BeadsWorkspaceRepo[];
    includeOtherWorkspaces?: boolean;
    beadId?: string;
  }): Promise<ListWorkspaceBeadsResult> {
    const repos = await Promise.all(input.repos.map(async (repo) => {
      const { dir, exists } = await resolveWorkspaceRepoDir({
        workspaceDir: input.workspaceDir,
        agentWorkingDir: input.agentWorkingDir,
        repo,
      });
      return this.listRepoBeads({
        dir,
        dirExists: exists,
        repo,
        workspaceId: input.workspaceId,
        includeOtherWorkspaces: input.includeOtherWorkspaces ?? false,
        beadId: input.beadId,
      });
    }));
    return { workspaceId: input.workspaceId, repos };
  }

  async listPendingBeadsFormQueue(input: {
    reposRoot?: string;
    repoLimit?: number;
  } = {}): Promise<PendingBeadsFormQueueResult> {
    const requestedReposRoot = input.reposRoot ?? join(homedir(), 'repos');
    const repoLimit = input.repoLimit ?? 80;
    let repoDirs: string[];
    let reposRoot: string;
    try {
      reposRoot = await realpath(requestedReposRoot);
      repoDirs = (await readdir(reposRoot, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .filter((name) => !name.startsWith('.') && name !== 'node_modules')
        .sort((a, b) => a.localeCompare(b))
        .map((name) => join(reposRoot, name));
    } catch (error) {
      return {
        reposRoot: requestedReposRoot,
        repoLimit,
        reposScanned: 0,
        entries: [],
        skipped: [{ repoDir: requestedReposRoot, reason: error instanceof Error ? error.message : String(error) }],
        updateStrategy: pendingQueueUpdateStrategy(),
      };
    }

    const candidateRepoDirs = (await mapWithConcurrency(repoDirs, 20, async (repoDir) => (
      await hasLocalBeadsDir(repoDir) ? repoDir : undefined
    )))
      .filter((repoDir): repoDir is string => !!repoDir)
      .slice(0, repoLimit);

    const entries: PendingBeadsFormEntry[] = [];
    const skipped: Array<{ repoDir: string; reason: string }> = [];
    const perRepoResults = await mapWithConcurrency(candidateRepoDirs, 5, async (repoDir) => {
      try {
        return { repoDir, entries: await this.listPendingFormsInRepo(repoDir) };
      } catch (error) {
        if (isNoBeadsDatabaseError(error)) {
          return { repoDir, entries: [] };
        }
        return { repoDir, entries: [], reason: error instanceof Error ? error.message : String(error) };
      }
    });
    for (const result of perRepoResults) {
      entries.push(...result.entries);
      if (result.reason) skipped.push({ repoDir: result.repoDir, reason: result.reason });
    }
    entries.sort(comparePendingEntriesMostRecent);

    return {
      reposRoot,
      repoLimit,
      reposScanned: candidateRepoDirs.length,
      entries,
      skipped,
      updateStrategy: pendingQueueUpdateStrategy(),
    };
  }

  private async listPendingFormsInRepo(repoDir: string): Promise<PendingBeadsFormEntry[]> {
    const candidates = new Map<string, BeadLike>();
    const listed = parseBdJsonArray<BeadLike>((await this.exec(this.bdPath, [
      '--readonly',
      'list',
      '--json',
      '--all',
      '--limit',
      '0',
      '--has-metadata-key',
      'beadFormsSummary',
    ], {
      cwd: repoDir,
      timeout: 15_000,
      maxBuffer: 1024 * 1024 * 5,
    })).stdout);
    for (const bead of listed) {
      if (bead.id) candidates.set(bead.id, bead);
    }

    return Array.from(candidates.values()).flatMap((bead) => {
      if (isClosedBead(bead)) return [];
      const forms = getSupportedBeadsForms(bead.metadata)
        .filter((form) => isPendingForm(bead, form));
      return forms.map((form) => ({
        repoDir,
        repoName: basename(repoDir),
        bead: {
          id: bead.id,
          ...(bead.title ? { title: bead.title } : {}),
          ...(bead.description ? { description: bead.description } : {}),
          ...(beadCreatedAt(bead) ? { createdAt: beadCreatedAt(bead) } : {}),
          ...(beadUpdatedAt(bead) ? { updatedAt: beadUpdatedAt(bead) } : {}),
        },
        form: {
          id: form.id,
          title: form.title,
          ...(form.description ? { description: form.description } : {}),
          responseCount: form.responses?.length ?? 0,
        },
      }));
    });
  }

  private async listRepoBeads(input: {
    dir: string;
    dirExists: boolean;
    repo: BeadsWorkspaceRepo;
    workspaceId: string;
    includeOtherWorkspaces: boolean;
    beadId?: string;
  }): Promise<BeadsRepoListResult> {
    if (!input.dirExists) {
      return {
        repo: input.repo,
        dir: input.dir,
        dirExists: false,
        initialized: false,
        beads: [],
        unscopedCount: 0,
        otherWorkspaceCount: 0,
        error: `Repo directory not found: ${input.dir}`,
      };
    }

    try {
      let beads = input.beadId
        ? await this.listBeadsById(input.dir, input.beadId)
        : await this.listFormBearingBeads(input.dir);
      if (input.beadId && beads.some((bead) => bead.id === input.beadId && !isObject(bead.metadata))) {
        const shown = await this.tryReadSingleBead(input.dir, input.beadId);
        if (shown.length > 0) beads = shown;
      }
      const unscopedCount = beads.filter((bead) => !getMetadataString(bead.metadata, 'VK_WORKSPACE_ID')).length;
      const otherWorkspaceCount = beads.filter((bead) => {
        const beadWorkspaceId = getMetadataString(bead.metadata, 'VK_WORKSPACE_ID');
        return !!beadWorkspaceId && beadWorkspaceId !== input.workspaceId;
      }).length;
      return {
        repo: input.repo,
        dir: input.dir,
        dirExists: true,
        initialized: true,
        beads: input.includeOtherWorkspaces
          ? beads
          : beads.filter((bead) => getMetadataString(bead.metadata, 'VK_WORKSPACE_ID') === input.workspaceId),
        unscopedCount,
        otherWorkspaceCount,
      };
    } catch (error) {
      if (isNoBeadsDatabaseError(error)) {
        return {
          repo: input.repo,
          dir: input.dir,
          dirExists: true,
          initialized: false,
          beads: [],
          unscopedCount: 0,
          otherWorkspaceCount: 0,
        };
      }
      return {
        repo: input.repo,
        dir: input.dir,
        dirExists: true,
        initialized: true,
        beads: [],
        unscopedCount: 0,
        otherWorkspaceCount: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async listBeadsById(dir: string, beadId: string): Promise<BeadLike[]> {
    const { stdout } = await this.exec(this.bdPath, ['--readonly', 'list', '--json', '--all', '--limit', '0', '--id', beadId], {
      cwd: dir,
      timeout: 30_000,
      maxBuffer: 1024 * 1024 * 10,
    });
    return parseBdJsonArray<BeadLike>(stdout);
  }

  private async listFormBearingBeads(dir: string): Promise<BeadLike[]> {
    const byId = new Map<string, BeadLike>();
    for (const metadataKey of ['beadForms', 'beadsWeb']) {
      const { stdout } = await this.exec(this.bdPath, [
        '--readonly',
        'list',
        '--json',
        '--all',
        '--limit',
        '0',
        '--has-metadata-key',
        metadataKey,
      ], {
        cwd: dir,
        timeout: 30_000,
        maxBuffer: 1024 * 1024 * 10,
      });
      for (const bead of parseBdJsonArray<BeadLike>(stdout)) {
        if (bead.id) byId.set(bead.id, bead);
      }
    }
    return Array.from(byId.values());
  }

  private async tryReadSingleBead(dir: string, beadId: string): Promise<BeadLike[]> {
    try {
      return [await this.readBeadByShow(dir, beadId)];
    } catch (error) {
      if (isBeadNotFoundError(error, beadId)) return [];
      throw error;
    }
  }

  async submitForm(input: SubmitBeadsFormInput): Promise<SubmitBeadsFormResult> {
    const bead = await this.readBead(input.dir, input.beadId);
    const form = selectBeadsForm(bead.metadata, input.formId);
    if (!form) throw new Error(`Form not found: ${input.formId}`);

    const validationErrors = validateSubmittedValues(form, input.values);
    if (validationErrors.length > 0) throw new Error(validationErrors.join('\n'));

    const prettySummary = buildPrettySummary(form, input.values);
    const metadata = withBeadsFormsSummary(appendBeadsFormResponse(bead.metadata, form.id, {
      submittedBy: this.actor,
      submittedAt: this.now().toISOString(),
      values: input.values,
      prettySummary,
    }));

    await this.updateMetadata(input.dir, input.beadId, metadata);
    const warnings: string[] = [];
    try {
      await this.addLabel(input.dir, input.beadId, this.reviewLabel);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`Form response was saved, but adding label "${this.reviewLabel}" failed: ${message}`);
    }

    return {
      beadId: input.beadId,
      formId: input.formId,
      values: input.values,
      prettySummary,
      metadata,
      reviewLabel: this.reviewLabel,
      warnings,
    };
  }

  async updateMetadata(dir: string, beadId: string, metadata: JsonObject): Promise<void> {
    assertMetadataFitsDoltTextColumn(metadata);
    const tempDir = await mkdtemp(join(tmpdir(), 'beadsform-'));
    const metadataPath = join(tempDir, 'metadata.json');
    try {
      await writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
      await this.exec(this.bdPath, ['update', beadId, '--metadata', `@${metadataPath}`], {
        cwd: dir,
        timeout: 30_000,
        maxBuffer: 1024 * 1024 * 5,
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  async addLabel(dir: string, beadId: string, label: string): Promise<void> {
    await this.exec(this.bdPath, ['update', beadId, '--add-label', label], {
      cwd: dir,
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    });
  }

  async removeLabel(dir: string, beadId: string, label: string): Promise<void> {
    await this.exec(this.bdPath, ['update', beadId, '--remove-label', label], {
      cwd: dir,
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    });
  }
}

function pendingQueueUpdateStrategy(): PendingBeadsFormQueueResult['updateStrategy'] {
  return {
    mode: 'explicit-refresh',
    rationale: 'Use an explicit refresh action for the MVP. bd list --watch is display-oriented, while readonly bounded scans avoid long-lived filesystem/database watchers, unexpected migrations, and cross-repo DB corruption risks.',
  };
}

async function hasLocalBeadsDir(repoDir: string): Promise<boolean> {
  try {
    await access(join(repoDir, '.beads'));
    return true;
  } catch {
    return false;
  }
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index] as T, index);
    }
  });
  await Promise.all(workers);
  return results;
}

function comparePendingEntriesMostRecent(left: PendingBeadsFormEntry, right: PendingBeadsFormEntry): number {
  const leftTime = Date.parse(left.bead.updatedAt ?? left.bead.createdAt ?? '');
  const rightTime = Date.parse(right.bead.updatedAt ?? right.bead.createdAt ?? '');
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) return rightTime - leftTime;
  if (Number.isFinite(leftTime) !== Number.isFinite(rightTime)) return Number.isFinite(rightTime) ? 1 : -1;
  return `${left.repoName}:${left.bead.id}:${left.form.id}`.localeCompare(`${right.repoName}:${right.bead.id}:${right.form.id}`);
}

function beadCreatedAt(bead: BeadLike): string | undefined {
  return bead.createdAt ?? bead.created_at;
}

function beadUpdatedAt(bead: BeadLike): string | undefined {
  return bead.updatedAt ?? bead.updated_at;
}

function isClosedBead(bead: BeadLike): boolean {
  return bead.status?.trim().toLowerCase() === 'closed';
}

function isPendingForm(bead: BeadLike, form: BeadsFormDefinition): boolean {
  const summary = isObject(bead.metadata) && isObject(bead.metadata.beadFormsSummary)
    ? bead.metadata.beadFormsSummary
    : undefined;
  if (summary && Array.isArray(summary.pendingFormIds)) {
    return summary.pendingFormIds.includes(form.id);
  }
  return false;
}

export function createNodeBeadsClient(options?: BeadsClientOptions): BeadsClient {
  return new BeadsClient(options);
}

async function resolveWorkspaceRepoDir(input: {
  workspaceDir: string;
  agentWorkingDir?: string | null;
  repo: BeadsWorkspaceRepo;
}): Promise<{ dir: string; exists: boolean }> {
  const candidates = repoDirCandidates(input);
  for (const dir of candidates) {
    try {
      await access(dir);
      return { dir, exists: true };
    } catch {
      // Try the next documented workspace layout candidate.
    }
  }

  return { dir: candidates[0] ?? join(input.workspaceDir, input.repo.name), exists: false };
}

function repoDirCandidates(input: {
  workspaceDir: string;
  agentWorkingDir?: string | null;
  repo: BeadsWorkspaceRepo;
}): string[] {
  const candidates = [
    join(input.workspaceDir, input.repo.name),
  ];
  const displayOrNameBase = cleanRepoDirBasename(input.repo.display_name ?? input.repo.name);
  if (displayOrNameBase) candidates.push(join(input.workspaceDir, displayOrNameBase));

  const nameBase = cleanRepoDirBasename(input.repo.name);
  if (nameBase) candidates.push(join(input.workspaceDir, nameBase));

  if (input.agentWorkingDir && nameBase && cleanRepoDirBasename(input.agentWorkingDir) === nameBase) {
    candidates.push(input.agentWorkingDir);
  }

  return Array.from(new Set(candidates));
}

function cleanRepoDirBasename(value: string): string {
  return basename(value).replace(/\.git$/, '');
}

function parseBdJsonArray<T>(stdout: string | Buffer): T[] {
  const text = String(stdout);
  const jsonStart = text.indexOf('[');
  if (jsonStart < 0) return [];
  return JSON.parse(text.slice(jsonStart)) as T[];
}

function isObject(value: unknown): value is JsonObject {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function getMetadataString(metadata: unknown, key: string): string | undefined {
  if (!isObject(metadata)) return undefined;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function isNoBeadsDatabaseError(error: unknown): boolean {
  const text = [
    error instanceof Error ? error.message : String(error),
    error && typeof error === 'object' && 'stderr' in error ? String(error.stderr) : '',
    error && typeof error === 'object' && 'stdout' in error ? String(error.stdout) : '',
  ].join('\n');
  return /no beads database found/i.test(text);
}

function isBeadNotFoundError(error: unknown, beadId: string): boolean {
  const text = [
    error instanceof Error ? error.message : String(error),
    error && typeof error === 'object' && 'stderr' in error ? String(error.stderr) : '',
    error && typeof error === 'object' && 'stdout' in error ? String(error.stdout) : '',
  ].join('\n');
  return new RegExp(`\\b${escapeRegExp(beadId)}\\b.*not found|not found.*\\b${escapeRegExp(beadId)}\\b`, 'i').test(text);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/// <reference types="node" />

import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';

import {
  appendBeadsFormResponse,
  buildPrettySummary,
  getBeadsForms,
  selectBeadsForm,
  validateSubmittedValues,
  type BeadLike,
  type BeadsFormDefinition,
  type JsonObject,
} from './beadsFormCore';

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
    const { stdout } = await this.exec(this.bdPath, ['show', beadId, '--json', '--long'], {
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
      });
    }));
    return { workspaceId: input.workspaceId, repos };
  }

  private async listRepoBeads(input: {
    dir: string;
    dirExists: boolean;
    repo: BeadsWorkspaceRepo;
    workspaceId: string;
    includeOtherWorkspaces: boolean;
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
      const { stdout } = await this.exec(this.bdPath, ['list', '--json', '--all', '--limit', '0'], {
        cwd: input.dir,
        timeout: 30_000,
        maxBuffer: 1024 * 1024 * 10,
      });
      const listed = parseBdJsonArray<BeadLike>(stdout);
      const ids = listed.map((bead) => bead.id).filter(Boolean);
      const beads = ids.length > 0
        ? parseBdJsonArray<BeadLike>((await this.exec(this.bdPath, ['show', ...ids, '--json', '--long'], {
          cwd: input.dir,
          timeout: 30_000,
          maxBuffer: 1024 * 1024 * 20,
        })).stdout)
        : [];
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

  async submitForm(input: SubmitBeadsFormInput): Promise<SubmitBeadsFormResult> {
    const bead = await this.readBead(input.dir, input.beadId);
    const form = selectBeadsForm(bead.metadata, input.formId);
    if (!form) throw new Error(`Form not found: ${input.formId}`);

    const validationErrors = validateSubmittedValues(form, input.values);
    if (validationErrors.length > 0) throw new Error(validationErrors.join('\n'));

    const prettySummary = buildPrettySummary(form, input.values);
    const metadata = appendBeadsFormResponse(bead.metadata, form.id, {
      submittedBy: this.actor,
      submittedAt: this.now().toISOString(),
      values: input.values,
      prettySummary,
    });

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

function getMetadataString(metadata: unknown, key: string): string | undefined {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return undefined;
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

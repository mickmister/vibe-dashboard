/// <reference types="node" />

import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

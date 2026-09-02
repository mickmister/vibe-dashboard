/// <reference types="node" />

import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import type { StandardBeadsForm, StoredBeadsForm } from '../../packages/beads-form/src/index.ts';
import { buildBeadsFormsSummary, type JsonObject } from './cli.ts';

const execFileAsync = promisify(execFile);

export type ExecFileLike = (
  file: string,
  args: readonly string[],
  options: { cwd: string; timeout: number; maxBuffer?: number },
) => Promise<{ stdout: string | Buffer; stderr: string | Buffer }>;

export type BeadsFormSandboxRepoSpec = {
  name: string;
  prefix: string;
  branch: string;
  beads: BeadsFormSandboxBeadSpec[];
};

export type BeadsFormSandboxBeadSpec = {
  id: string;
  title: string;
  description: string;
  forms: StoredBeadsForm[];
};

export type BeadsFormSandboxPlan = {
  parentDir: string;
  repos: BeadsFormSandboxRepoSpec[];
  env: {
    BEADS_FORM_PENDING_PARENT_DIR: string;
  };
};

export type ProvisionBeadsFormSandboxReposInput = {
  parentDir?: string;
  reset?: boolean;
  workspaceId?: string;
  workspaceName?: string;
  execFile?: ExecFileLike;
};

type CliOptions = {
  parentDir?: string;
  reset?: boolean;
  workspaceId?: string;
  workspaceName?: string;
};

export function buildBeadsFormSandboxPlan(input: {
  parentDir: string;
  workspaceId?: string;
  workspaceName?: string;
}): BeadsFormSandboxPlan {
  const parentDir = resolve(input.parentDir);
  return {
    parentDir,
    repos: [
      {
        name: 'beads-form-sandbox-alpha',
        prefix: 'bfalpha',
        branch: 'sandbox/beads-form-alpha',
        beads: [
          {
            id: 'bfalpha-pending',
            title: 'Alpha pending BeadsForm',
            description: 'A deterministic pending form for queue and direct-link testing.',
            forms: [sandboxReviewForm('alpha_review', 'Alpha review form')],
          },
          {
            id: 'bfalpha-submitted',
            title: 'Alpha submitted BeadsForm',
            description: 'A deterministic submitted form that should not appear as pending.',
            forms: [{
              ...sandboxReviewForm('alpha_submitted_review', 'Alpha submitted review form'),
              responses: [{
                submittedBy: 'sandbox',
                submittedAt: '2026-08-10T00:00:00.000Z',
                values: {
                  ready: { yes: true, no: false },
                  ready_more_info: 'Seeded completed response.',
                },
              }],
            }],
          },
        ],
      },
      {
        name: 'beads-form-sandbox-beta',
        prefix: 'bfbeta',
        branch: 'sandbox/beads-form-beta',
        beads: [
          {
            id: 'bfbeta-pending',
            title: 'Beta pending BeadsForm',
            description: 'A second deterministic pending form for aggregate and sorting tests.',
            forms: [sandboxReviewForm('beta_review', 'Beta review form')],
          },
        ],
      },
      {
        name: 'beads-form-sandbox-gamma',
        prefix: 'bfgamma',
        branch: 'sandbox/beads-form-gamma',
        beads: [
          {
            id: 'bfgamma-submitted',
            title: 'Gamma submitted-only BeadsForm',
            description: 'A deterministic repo with forms but no pending forms for queue filtering tests.',
            forms: [submittedSandboxReviewForm('gamma_submitted_review', 'Gamma submitted review form')],
          },
        ],
      },
    ],
    env: {
      BEADS_FORM_PENDING_PARENT_DIR: parentDir,
    },
  };
}

export async function provisionBeadsFormSandboxRepos(
  input: ProvisionBeadsFormSandboxReposInput = {},
): Promise<BeadsFormSandboxPlan> {
  const parentDir = resolve(input.parentDir ?? await mkdtemp(join(tmpdir(), 'beads-form-sandbox-repos-')));
  if (input.reset) await resetSandboxParent(parentDir);
  await mkdir(parentDir, { recursive: true });
  const plan = buildBeadsFormSandboxPlan({
    parentDir,
    workspaceId: input.workspaceId,
    workspaceName: input.workspaceName,
  });
  const run = input.execFile ?? defaultExecFile;
  for (const repo of plan.repos) {
    await provisionRepo({ parentDir, repo, workspaceId: input.workspaceId, workspaceName: input.workspaceName, execFile: run });
  }
  return plan;
}

async function provisionRepo(input: {
  parentDir: string;
  repo: BeadsFormSandboxRepoSpec;
  workspaceId?: string;
  workspaceName?: string;
  execFile: ExecFileLike;
}): Promise<void> {
  const repoDir = join(input.parentDir, input.repo.name);
  await mkdir(repoDir, { recursive: true });
  await input.execFile('git', ['init', '--initial-branch', 'main'], { cwd: repoDir, timeout: 30_000 });
  await input.execFile('git', ['checkout', '-B', input.repo.branch], { cwd: repoDir, timeout: 30_000 });
  await input.execFile('bd', [
    'init',
    '--non-interactive',
    '--init-if-missing',
    '--skip-agents',
    '--skip-hooks',
    '--prefix',
    input.repo.prefix,
  ], { cwd: repoDir, timeout: 60_000, maxBuffer: 1024 * 1024 * 5 });
  for (const bead of input.repo.beads) {
    const metadata = metadataForBead({
      forms: bead.forms,
      branch: input.repo.branch,
      workspaceId: input.workspaceId,
      workspaceName: input.workspaceName,
    });
    const metadataPath = join(repoDir, `.beads-form-sandbox-${bead.id}.metadata.json`);
    await writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
    await input.execFile('bd', [
      'create',
      '--id',
      bead.id,
      '--title',
      bead.title,
      '--description',
      bead.description,
      '--metadata',
      `@${metadataPath}`,
      '--priority',
      '2',
      '--type',
      'task',
    ], { cwd: repoDir, timeout: 60_000, maxBuffer: 1024 * 1024 * 5 });
  }
}

function metadataForBead(input: {
  forms: StoredBeadsForm[];
  branch: string;
  workspaceId?: string;
  workspaceName?: string;
}): JsonObject {
  const metadata: JsonObject = {
    VK_BRANCH: input.branch,
    beadForms: {
      forms: input.forms,
    },
    beadFormsSummary: buildBeadsFormsSummary(input.forms as never),
  };
  if (input.workspaceId?.trim()) metadata.VK_WORKSPACE_ID = input.workspaceId.trim();
  if (input.workspaceName?.trim()) metadata.VK_WORKSPACE_NAME = input.workspaceName.trim();
  return metadata;
}

function sandboxReviewForm(id: string, title: string): StandardBeadsForm {
  return {
    format: 'standard',
    id,
    goal: `Answer ${title}.`,
    title,
    description: 'Seeded sandbox form for deterministic BeadsForm queue, direct, and aggregate testing.',
    questions: [{
      type: 'choices',
      id: 'ready',
      title: 'Is this sandbox form ready?',
      description: 'Choose the option that describes the seeded sandbox state.',
      choices: [
        { id: 'yes', label: 'Yes', is_recommended_reason: 'This fixture should be ready immediately after provisioning.' },
        { id: 'no', label: 'No' },
      ],
    }, {
      type: 'textarea',
      id: 'notes',
      title: 'Sandbox notes',
      description: 'Optional notes for validating draft/submit behavior.',
    }],
  };
}

function submittedSandboxReviewForm(id: string, title: string): StoredBeadsForm {
  return {
    ...sandboxReviewForm(id, title),
    responses: [{
      submittedBy: 'sandbox',
      submittedAt: '2026-08-10T00:00:00.000Z',
      values: {
        ready: { yes: true, no: false },
        ready_more_info: 'Seeded completed response.',
      },
    }],
  };
}

async function resetSandboxParent(parentDir: string): Promise<void> {
  const normalized = resolve(parentDir);
  if (!normalized.includes('beads-form-sandbox') && !normalized.includes('.vk-mocked-sandbox')) {
    throw new Error(`Refusing to reset non-sandbox directory: ${normalized}`);
  }
  await rm(normalized, { recursive: true, force: true });
}

async function defaultExecFile(
  file: string,
  args: readonly string[],
  options: { cwd: string; timeout: number; maxBuffer?: number },
): Promise<{ stdout: string | Buffer; stderr: string | Buffer }> {
  return execFileAsync(file, [...args], options);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === '--parent-dir') options.parentDir = requireValue(argv, ++index, arg);
    else if (arg === '--workspace') options.workspaceId = requireValue(argv, ++index, arg);
    else if (arg === '--workspace-name') options.workspaceName = requireValue(argv, ++index, arg);
    else if (arg === '--reset') options.reset = true;
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value) throw new Error(`${flag} requires a value`);
  return value;
}

function printHelp(): void {
  console.log(`Usage:
  npm run beads-form:sandbox-repos -- [--parent-dir <dir>] [--reset] [--workspace <id>] [--workspace-name <name>]

Creates deterministic disposable bead-enabled repos for BeadsForm manual and E2E tests.
Point pending queue reads at the printed BEADS_FORM_PENDING_PARENT_DIR value.`);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const parentDir = options.parentDir ?? join(process.cwd(), '.vk-mocked-sandbox', 'beads-form-sandbox-repos');
  const plan = await provisionBeadsFormSandboxRepos({
    parentDir,
    reset: options.reset,
    workspaceId: options.workspaceId,
    workspaceName: options.workspaceName,
  });
  console.log(JSON.stringify(plan, null, 2));
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

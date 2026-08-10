import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  buildBeadsFormSandboxPlan,
  provisionBeadsFormSandboxRepos,
  type ExecFileLike,
} from './sandbox-repos';

describe('beads-form sandbox repos', () => {
  it('builds a deterministic plan scoped by BEADS_FORM_PENDING_PARENT_DIR', () => {
    const plan = buildBeadsFormSandboxPlan({
      parentDir: '/tmp/beads-form-sandbox-parent',
      workspaceId: 'workspace-1',
      workspaceName: 'Sandbox Workspace',
    });

    expect(plan.env).toEqual({
      BEADS_FORM_PENDING_PARENT_DIR: '/tmp/beads-form-sandbox-parent',
    });
    expect(plan.repos.map((repo) => repo.name)).toEqual([
      'beads-form-sandbox-alpha',
      'beads-form-sandbox-beta',
    ]);
    expect(plan.repos.flatMap((repo) => repo.beads.map((bead) => bead.id))).toEqual([
      'bfalpha-pending',
      'bfalpha-submitted',
      'bfbeta-pending',
    ]);
    expect(plan.repos[0]!.beads[0]!.forms[0]).toMatchObject({
      format: 'standard',
      id: 'alpha_review',
      goal: 'Answer Alpha review form.',
    });
  });

  it('provisions only the requested disposable parent with initialized sample beads', async () => {
    const parentDir = await mkdtemp(join(tmpdir(), 'beads-form-sandbox-parent-'));
    const calls: Array<{ file: string; args: readonly string[]; cwd: string }> = [];
    const exec = vi.fn<ExecFileLike>(async (file, args, options) => {
      calls.push({ file, args, cwd: options.cwd });
      return { stdout: '', stderr: '' };
    });

    try {
      const plan = await provisionBeadsFormSandboxRepos({
        parentDir,
        workspaceId: 'workspace-1',
        workspaceName: 'Sandbox Workspace',
        execFile: exec,
      });

      expect(plan.parentDir).toBe(parentDir);
      expect(calls.some((call) => call.cwd === join(parentDir, 'beads-form-sandbox-alpha'))).toBe(true);
      expect(calls.some((call) => call.cwd === join(parentDir, 'beads-form-sandbox-beta'))).toBe(true);
      expect(calls.every((call) => call.cwd.startsWith(parentDir))).toBe(true);
      expect(calls.filter((call) => call.file === 'bd' && call.args[0] === 'init')).toHaveLength(2);
      expect(calls.filter((call) => call.file === 'bd' && call.args[0] === 'create').map((call) => call.args.slice(0, 3))).toEqual([
        ['create', '--id', 'bfalpha-pending'],
        ['create', '--id', 'bfalpha-submitted'],
        ['create', '--id', 'bfbeta-pending'],
      ]);
      expect(calls.filter((call) => call.file === 'bd' && call.args[0] === 'create').every((call) => (
        call.args.includes('--metadata') && call.args.some((arg) => String(arg).startsWith('@'))
      ))).toBe(true);
    } finally {
      await rm(parentDir, { recursive: true, force: true });
    }
  });

  it('refuses to reset directories that are not clearly sandbox-owned', async () => {
    await expect(provisionBeadsFormSandboxRepos({
      parentDir: '/tmp/not-owned-by-this-harness',
      reset: true,
      execFile: vi.fn<ExecFileLike>(),
    })).rejects.toThrow('Refusing to reset non-sandbox directory');
  });
});

import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { BeadsClient, type ExecFileLike } from './beadsClient.node';

function beadJson(metadata: unknown) {
  return JSON.stringify([{ id: 'beads-web-biu', title: 'Plan', metadata }]);
}

const reviewMetadata = {
  beadForms: {
    forms: [{
      id: 'review',
      title: 'Review',
      html: '<form></form>',
      controls: [{ id: 'comment_control', name: 'comment', type: 'textarea', required: true }],
    }],
  },
};

describe('BeadsClient', () => {
  it('reads a bead with bd show --json --long', async () => {
    const exec = vi.fn<ExecFileLike>(async () => ({ stdout: beadJson({ beadForms: { forms: [] } }), stderr: '' }));
    const client = new BeadsClient({ execFile: exec });

    await expect(client.readBead('/repo', 'beads-web-biu')).resolves.toMatchObject({ id: 'beads-web-biu' });
    expect(exec).toHaveBeenCalledWith('bd', ['show', 'beads-web-biu', '--json', '--long'], expect.objectContaining({ cwd: '/repo' }));
  });

  it('submits a response by re-reading, updating metadata with @file, and adding review label', async () => {
    const calls: Array<{ file: string; args: readonly string[]; cwd: string }> = [];
    const exec = vi.fn<ExecFileLike>(async (file, args, options) => {
      calls.push({ file, args, cwd: options.cwd });
      if (args[0] === 'show') return { stdout: beadJson(reviewMetadata), stderr: '' };
      return { stdout: '', stderr: '' };
    });
    const client = new BeadsClient({ execFile: exec, now: () => new Date('2026-06-29T00:00:00Z') });

    const result = await client.submitForm({ dir: '/repo', beadId: 'beads-web-biu', formId: 'review', values: { comment: 'LGTM' } });

    expect(result.prettySummary).toContain('- comment: LGTM');
    expect(result.warnings).toEqual([]);
    expect(calls.map((call) => call.args.slice(0, 3))).toEqual([
      ['show', 'beads-web-biu', '--json'],
      ['update', 'beads-web-biu', '--metadata'],
      ['update', 'beads-web-biu', '--add-label'],
    ]);
    expect(calls[1]?.args[3]).toMatch(/^@/);
    expect(calls[2]?.args).toContain('needs-agent-review');
  });

  it('returns a warning instead of failing when review label add fails after metadata persistence', async () => {
    const exec = vi.fn<ExecFileLike>(async (_file, args) => {
      if (args[0] === 'show') return { stdout: beadJson(reviewMetadata), stderr: '' };
      if (args.includes('--add-label')) throw new Error('label failed');
      return { stdout: '', stderr: '' };
    });
    const client = new BeadsClient({ execFile: exec, now: () => new Date('2026-06-29T00:00:00Z') });

    const result = await client.submitForm({ dir: '/repo', beadId: 'beads-web-biu', formId: 'review', values: { comment: 'LGTM' } });

    expect(result.warnings).toEqual([
      'Form response was saved, but adding label "needs-agent-review" failed: label failed',
    ]);
  });

  it('lists only current-workspace beads by default across initialized repos', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'beads-workspace-'));
    await mkdir(join(workspaceDir, 'repo-a', '.beads'), { recursive: true });
    await mkdir(join(workspaceDir, 'repo-b'), { recursive: true });
    const exec = vi.fn<ExecFileLike>(async (_file, args, options) => {
      if (options.cwd.endsWith('repo-a') && args[0] === 'list') {
        return { stdout: JSON.stringify([{ id: 'current' }, { id: 'other' }, { id: 'unscoped' }]), stderr: '' };
      }
      if (options.cwd.endsWith('repo-a') && args[0] === 'show') {
        return { stdout: JSON.stringify([
          { id: 'current', title: 'Current', metadata: { VK_WORKSPACE_ID: 'workspace-1' } },
          { id: 'other', title: 'Other', metadata: { VK_WORKSPACE_ID: 'workspace-2' } },
          { id: 'unscoped', title: 'Unscoped', metadata: {} },
        ]), stderr: '' };
      }
      return { stdout: '[]', stderr: '' };
    });
    const client = new BeadsClient({ execFile: exec });

    const result = await client.listWorkspaceBeads({
      workspaceId: 'workspace-1',
      workspaceDir,
      repos: [{ id: 'repo-a', name: 'repo-a' }, { id: 'repo-b', name: 'repo-b' }],
    });

    expect(result.repos[0]).toMatchObject({
      initialized: true,
      unscopedCount: 1,
      otherWorkspaceCount: 1,
    });
    expect(result.repos[0]!.beads.map((bead) => bead.id)).toEqual(['current']);
    expect(result.repos[1]).toMatchObject({ initialized: false, beads: [] });
  });

  it('resolves owner/repo workspace repo names to basename checkout directories', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'beads-workspace-'));
    await mkdir(join(workspaceDir, 'repo-a', '.beads'), { recursive: true });
    const exec = vi.fn<ExecFileLike>(async (_file, args, options) => {
      expect(options.cwd).toBe(join(workspaceDir, 'repo-a'));
      if (args[0] === 'list') return { stdout: JSON.stringify([{ id: 'current' }]), stderr: '' };
      if (args[0] === 'show') {
        return {
          stdout: JSON.stringify([
            { id: 'current', title: 'Current', metadata: { VK_WORKSPACE_ID: 'workspace-1' } },
          ]),
          stderr: '',
        };
      }
      return { stdout: '[]', stderr: '' };
    });
    const client = new BeadsClient({ execFile: exec });

    const result = await client.listWorkspaceBeads({
      workspaceId: 'workspace-1',
      workspaceDir,
      repos: [{ id: 'repo-a', name: 'owner/repo-a', display_name: 'owner/repo-a' }],
    });

    expect(result.repos[0]).toMatchObject({
      dir: join(workspaceDir, 'repo-a'),
      initialized: true,
    });
    expect(result.repos[0]!.error).toBeUndefined();
    expect(result.repos[0]!.beads.map((bead) => bead.id)).toEqual(['current']);
  });

  it('can opt in to showing unscoped and other-workspace beads', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'beads-workspace-'));
    await mkdir(join(workspaceDir, 'repo-a', '.beads'), { recursive: true });
    const exec = vi.fn<ExecFileLike>(async (_file, args) => {
      if (args[0] === 'list') return { stdout: JSON.stringify([{ id: 'current' }, { id: 'other' }, { id: 'unscoped' }]), stderr: '' };
      if (args[0] === 'show') return { stdout: JSON.stringify([
        { id: 'current', title: 'Current', metadata: { VK_WORKSPACE_ID: 'workspace-1' } },
        { id: 'other', title: 'Other', metadata: { VK_WORKSPACE_ID: 'workspace-2' } },
        { id: 'unscoped', title: 'Unscoped', metadata: {} },
      ]), stderr: '' };
      return { stdout: '[]', stderr: '' };
    });
    const client = new BeadsClient({ execFile: exec });

    const result = await client.listWorkspaceBeads({
      workspaceId: 'workspace-1',
      workspaceDir,
      repos: [{ id: 'repo-a', name: 'repo-a' }],
      includeOtherWorkspaces: true,
    });

    expect(result.repos[0]!.beads.map((bead) => bead.id)).toEqual(['current', 'other', 'unscoped']);
  });
});

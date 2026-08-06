import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { BeadsClient, type ExecFileLike } from './beadsClient.node';

function beadJson(metadata: unknown) {
  return JSON.stringify([{ id: 'beads-web-biu', title: 'Plan', metadata }]);
}

function storedForm(id = 'review', title = 'Review', extra: Record<string, unknown> = {}) {
  return {
    format: 'standard' as const,
    id,
    goal: `Answer ${title}.`,
    title,
    questions: [{
      type: 'textarea' as const,
      id: 'comment',
      title: 'Comment',
      description: 'Share a comment.',
      required: true,
    }],
    ...extra,
  };
}

const reviewMetadata = {
  beadForms: {
    forms: [storedForm()],
  },
};

describe('BeadsClient', () => {
  it('reads a bead with targeted bd list metadata before falling back to show', async () => {
    const exec = vi.fn<ExecFileLike>(async () => ({ stdout: beadJson({ beadForms: { forms: [] } }), stderr: '' }));
    const client = new BeadsClient({ execFile: exec });

    await expect(client.readBead('/repo', 'beads-web-biu')).resolves.toMatchObject({ id: 'beads-web-biu' });
    expect(exec).toHaveBeenCalledWith('bd', ['--readonly', 'list', '--json', '--all', '--limit', '0', '--id', 'beads-web-biu'], expect.objectContaining({ cwd: '/repo' }));
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it('falls back to bd show when targeted list lacks metadata', async () => {
    const exec = vi.fn<ExecFileLike>(async (_file, args) => {
      if (args[1] === 'list') return { stdout: JSON.stringify([{ id: 'beads-web-biu', title: 'Plan' }]), stderr: '' };
      return { stdout: beadJson({ beadForms: { forms: [] } }), stderr: '' };
    });
    const client = new BeadsClient({ execFile: exec });

    await expect(client.readBead('/repo', 'beads-web-biu')).resolves.toMatchObject({ id: 'beads-web-biu' });
    expect(exec.mock.calls.map(([, args]) => args)).toEqual([
      ['--readonly', 'list', '--json', '--all', '--limit', '0', '--id', 'beads-web-biu'],
      ['--readonly', 'show', 'beads-web-biu', '--json', '--long'],
    ]);
  });

  it('reads legacy standard forms with stale generated fields and a missing goal', async () => {
    const exec = vi.fn<ExecFileLike>(async () => ({
      stdout: beadJson({
        beadForms: {
          forms: [{
            format: 'standard',
            id: 'legacy_review',
            title: 'Legacy Review',
            questions: [{
              type: 'textarea',
              id: 'comment',
              title: 'Comment',
              description: 'Share a comment.',
            }],
            html: '<form><input name="stale"></form>',
            controls: [{ id: 'stale', name: 'stale', type: 'textarea' }],
          }],
        },
      }),
      stderr: '',
    }));
    const client = new BeadsClient({ execFile: exec });

    const result = await client.readForms('/repo', 'beads-web-biu');

    expect(result.forms[0]).toMatchObject({
      id: 'legacy_review',
      goal: 'Answer Legacy Review.',
      title: 'Legacy Review',
    });
    expect(result.forms[0]!.html).toContain('name="comment"');
    expect(result.forms[0]!.html).not.toContain('name="stale"');
  });

  it('submits a response by re-reading, updating metadata with @file, and adding review label', async () => {
    const calls: Array<{ file: string; args: readonly string[]; cwd: string }> = [];
    const exec = vi.fn<ExecFileLike>(async (file, args, options) => {
      calls.push({ file, args, cwd: options.cwd });
      if (args[0] === '--readonly' && args[1] === 'list') return { stdout: beadJson(reviewMetadata), stderr: '' };
      return { stdout: '', stderr: '' };
    });
    const client = new BeadsClient({ execFile: exec, now: () => new Date('2026-06-29T00:00:00Z') });

    const result = await client.submitForm({ dir: '/repo', beadId: 'beads-web-biu', formId: 'review', values: { comment: 'LGTM' } });

    expect(result.prettySummary).toContain('- comment: LGTM');
    expect(result.warnings).toEqual([]);
    expect(result.metadata.beadFormsSummary).toEqual({
      hasForms: true,
      hasPendingAnswer: false,
      pendingResponseCount: 0,
      formIds: ['review'],
      pendingFormIds: [],
    });
    expect(calls.map((call) => call.args.slice(0, 3))).toEqual([
      ['--readonly', 'list', '--json'],
      ['update', 'beads-web-biu', '--metadata'],
      ['update', 'beads-web-biu', '--add-label'],
    ]);
    expect(calls[1]?.args[3]).toMatch(/^@/);
    expect(calls[2]?.args).toContain('needs-agent-review');
  });

  it('returns a warning instead of failing when review label add fails after metadata persistence', async () => {
    const exec = vi.fn<ExecFileLike>(async (_file, args) => {
      if (args[0] === '--readonly' && args[1] === 'list') return { stdout: beadJson(reviewMetadata), stderr: '' };
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
      if (options.cwd.endsWith('repo-a') && args[0] === '--readonly' && args[1] === 'list') {
        expect(args).toContain('--has-metadata-key');
        if (args.includes('beadsWeb')) return { stdout: '[]', stderr: '' };
        return { stdout: JSON.stringify([
          { id: 'current', title: 'Current', metadata: { VK_WORKSPACE_ID: 'workspace-1', beadForms: { forms: [storedForm()] } } },
          { id: 'other', title: 'Other', metadata: { VK_WORKSPACE_ID: 'workspace-2', beadForms: { forms: [storedForm()] } } },
          { id: 'unscoped', title: 'Unscoped', metadata: { beadForms: { forms: [storedForm()] } } },
        ]), stderr: '' };
      }
      if (options.cwd.endsWith('repo-b') && args[0] === '--readonly' && args[1] === 'list') {
        throw Object.assign(new Error('Command failed: bd list'), { stderr: 'Error: no beads database found' });
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

  it('treats a repo as initialized when bd resolves a database even without a local .beads directory', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'beads-workspace-'));
    await mkdir(join(workspaceDir, 'repo-a'), { recursive: true });
    const exec = vi.fn<ExecFileLike>(async (_file, args, options) => {
      expect(options.cwd).toBe(join(workspaceDir, 'repo-a'));
      if (args[0] === '--readonly' && args[1] === 'list') {
        if (args.includes('beadsWeb')) return { stdout: '[]', stderr: '' };
        return { stdout: JSON.stringify([{ id: 'current', title: 'Current', metadata: { VK_WORKSPACE_ID: 'workspace-1', beadForms: { forms: [storedForm()] } } }]), stderr: '' };
      }
      return { stdout: '[]', stderr: '' };
    });
    const client = new BeadsClient({ execFile: exec });

    const result = await client.listWorkspaceBeads({
      workspaceId: 'workspace-1',
      workspaceDir,
      repos: [{ id: 'repo-a', name: 'repo-a' }],
    });

    expect(result.repos[0]).toMatchObject({
      dir: join(workspaceDir, 'repo-a'),
      initialized: true,
      beads: [{ id: 'current', title: 'Current', metadata: { VK_WORKSPACE_ID: 'workspace-1' } }],
    });
  });

  it('resolves owner/repo workspace repo names to basename checkout directories', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'beads-workspace-'));
    await mkdir(join(workspaceDir, 'repo-a', '.beads'), { recursive: true });
    const exec = vi.fn<ExecFileLike>(async (_file, args, options) => {
      expect(options.cwd).toBe(join(workspaceDir, 'repo-a'));
      if (args[0] === '--readonly' && args[1] === 'list') {
        if (args.includes('beadsWeb')) return { stdout: '[]', stderr: '' };
        return {
          stdout: JSON.stringify([
            { id: 'current', title: 'Current', metadata: { VK_WORKSPACE_ID: 'workspace-1', beadForms: { forms: [storedForm()] } } },
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
      if (args[0] === '--readonly' && args[1] === 'list') return { stdout: args.includes('beadsWeb') ? '[]' : JSON.stringify([
        { id: 'current', title: 'Current', metadata: { VK_WORKSPACE_ID: 'workspace-1', beadForms: { forms: [storedForm()] } } },
        { id: 'other', title: 'Other', metadata: { VK_WORKSPACE_ID: 'workspace-2', beadForms: { forms: [storedForm()] } } },
        { id: 'unscoped', title: 'Unscoped', metadata: { beadForms: { forms: [storedForm()] } } },
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

  it('uses form-bearing list metadata for workspace discovery without bulk showing every bead', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'beads-workspace-'));
    await mkdir(join(workspaceDir, 'repo-a'), { recursive: true });
    const exec = vi.fn<ExecFileLike>(async (_file, args) => {
      if (args[0] === '--readonly' && args[1] === 'show') throw new Error(`unexpected bulk show: ${args.join(' ')}`);
      expect(args).toEqual(['--readonly', 'list', '--json', '--all', '--limit', '0', '--has-metadata-key', args.includes('beadsWeb') ? 'beadsWeb' : 'beadForms']);
      if (args.includes('beadsWeb')) return { stdout: '[]', stderr: '' };
      return { stdout: JSON.stringify([
        { id: 'current', title: 'Current', metadata: { VK_WORKSPACE_ID: 'workspace-1', beadForms: { forms: [storedForm()] } } },
        { id: 'other', title: 'Other', metadata: { VK_WORKSPACE_ID: 'workspace-2', beadForms: { forms: [storedForm()] } } },
      ]), stderr: '' };
    });
    const client = new BeadsClient({ execFile: exec });

    const result = await client.listWorkspaceBeads({
      workspaceId: 'workspace-1',
      workspaceDir,
      repos: [{ id: 'repo-a', name: 'repo-a' }],
    });

    expect(result.repos[0]!.beads.map((bead) => bead.id)).toEqual(['current']);
    expect(exec).toHaveBeenCalledTimes(2);
  });

  it('does not show when selected bead is absent from a repo', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'beads-workspace-'));
    await mkdir(join(workspaceDir, 'repo-a'), { recursive: true });
    await mkdir(join(workspaceDir, 'repo-b'), { recursive: true });
    const exec = vi.fn<ExecFileLike>(async (_file, args, options) => {
      expect(args).not.toContain('--has-metadata-key');
      expect(args).not.toContain('unrelated-1');
      if (args[1] === 'show') throw new Error(`unexpected show for ${options.cwd}: ${args.join(' ')}`);
      if (options.cwd.endsWith('repo-a')) return { stdout: '[]', stderr: '' };
      return { stdout: JSON.stringify([
        { id: 'selected', title: 'Selected', metadata: { VK_WORKSPACE_ID: 'workspace-1', beadForms: { forms: [storedForm()] } } },
      ]), stderr: '' };
    });
    const client = new BeadsClient({ execFile: exec });

    const result = await client.listWorkspaceBeads({
      workspaceId: 'workspace-1',
      workspaceDir,
      repos: [{ id: 'repo-a', name: 'repo-a' }, { id: 'repo-b', name: 'repo-b' }],
      beadId: 'selected',
    });

    expect(result.repos.flatMap((repo) => repo.beads.map((bead) => bead.id))).toEqual(['selected']);
    expect(exec.mock.calls.map(([, args]) => args)).toEqual([
      ['--readonly', 'list', '--json', '--all', '--limit', '0', '--id', 'selected'],
      ['--readonly', 'list', '--json', '--all', '--limit', '0', '--id', 'selected'],
    ]);
    expect(exec.mock.calls.some(([, args]) => args.includes('--has-metadata-key'))).toBe(false);
  });

  it('falls back to one targeted show when selected list metadata is insufficient', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'beads-workspace-'));
    await mkdir(join(workspaceDir, 'repo-a'), { recursive: true });
    const exec = vi.fn<ExecFileLike>(async (_file, args) => {
      if (args[0] === '--readonly' && args[1] === 'list') {
        return { stdout: JSON.stringify([{ id: 'selected', title: 'Selected without metadata' }]), stderr: '' };
      }
      if (args[0] === '--readonly' && args[1] === 'show') {
        return { stdout: JSON.stringify([{ id: 'selected', title: 'Selected', metadata: { VK_WORKSPACE_ID: 'workspace-1', beadForms: { forms: [storedForm()] } } }]), stderr: '' };
      }
      return { stdout: '[]', stderr: '' };
    });
    const client = new BeadsClient({ execFile: exec });

    const result = await client.listWorkspaceBeads({
      workspaceId: 'workspace-1',
      workspaceDir,
      repos: [{ id: 'repo-a', name: 'repo-a' }],
      beadId: 'selected',
    });

    expect(result.repos[0]!.beads[0]).toMatchObject({ id: 'selected', metadata: { VK_WORKSPACE_ID: 'workspace-1' } });
    expect(exec.mock.calls.map(([, args]) => args)).toEqual([
      ['--readonly', 'list', '--json', '--all', '--limit', '0', '--id', 'selected'],
      ['--readonly', 'show', 'selected', '--json', '--long'],
    ]);
  });

  it('does not show when selected list metadata is sufficient to render forms', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'beads-workspace-'));
    await mkdir(join(workspaceDir, 'repo-a'), { recursive: true });
    const exec = vi.fn<ExecFileLike>(async (_file, args) => {
      if (args[1] === 'show') throw new Error(`unexpected show: ${args.join(' ')}`);
      return { stdout: JSON.stringify([
        { id: 'selected', title: 'Selected', metadata: { VK_WORKSPACE_ID: 'workspace-1', beadForms: { forms: [storedForm()] } } },
      ]), stderr: '' };
    });
    const client = new BeadsClient({ execFile: exec });

    const result = await client.listWorkspaceBeads({
      workspaceId: 'workspace-1',
      workspaceDir,
      repos: [{ id: 'repo-a', name: 'repo-a' }],
      beadId: 'selected',
    });

    expect(result.repos[0]!.beads[0]).toMatchObject({ id: 'selected', metadata: { VK_WORKSPACE_ID: 'workspace-1' } });
    expect(exec.mock.calls.map(([, args]) => args)).toEqual([
      ['--readonly', 'list', '--json', '--all', '--limit', '0', '--id', 'selected'],
    ]);
  });

  it('keeps workspace loading partial when one repo fails', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'beads-workspace-'));
    await mkdir(join(workspaceDir, 'repo-a'), { recursive: true });
    await mkdir(join(workspaceDir, 'repo-b'), { recursive: true });
    const exec = vi.fn<ExecFileLike>(async (_file, _args, options) => {
      if (options.cwd.endsWith('repo-a')) {
        if (_args.includes('beadsWeb')) return { stdout: '[]', stderr: '' };
        return { stdout: JSON.stringify([{ id: 'current', metadata: { VK_WORKSPACE_ID: 'workspace-1', beadForms: { forms: [storedForm()] } } }]), stderr: '' };
      }
      throw new Error('schema skew');
    });
    const client = new BeadsClient({ execFile: exec });

    const result = await client.listWorkspaceBeads({
      workspaceId: 'workspace-1',
      workspaceDir,
      repos: [{ id: 'repo-a', name: 'repo-a' }, { id: 'repo-b', name: 'repo-b' }],
    });

    expect(result.repos[0]!.beads.map((bead) => bead.id)).toEqual(['current']);
    expect(result.repos[1]).toMatchObject({ initialized: true, beads: [], error: 'schema skew' });
  });

  it('lists pending bead forms from a bounded ~/repos-style scan without mutating bead databases', async () => {
    const reposRoot = await mkdtemp(join(tmpdir(), 'beads-repos-'));
    await mkdir(join(reposRoot, 'repo-a', '.beads'), { recursive: true });
    await mkdir(join(reposRoot, 'repo-b', '.beads'), { recursive: true });
    await mkdir(join(reposRoot, 'repo-c'), { recursive: true });
    const exec = vi.fn<ExecFileLike>(async (_file, args, options) => {
      expect(args[0]).toBe('--readonly');
      if (options.cwd.endsWith('repo-a') && args[1] === 'list') {
        expect(args).toEqual(['--readonly', 'list', '--json', '--all', '--limit', '0', '--has-metadata-key', 'beadFormsSummary']);
        return { stdout: JSON.stringify([
          { id: 'done', title: 'Done bead', metadata: { beadFormsSummary: { hasForms: true, hasPendingAnswer: false, pendingResponseCount: 0, formIds: ['done_form'], pendingFormIds: [] }, beadForms: { forms: [storedForm('done_form', 'Done')] } } },
          { id: 'pending', title: 'Pending bead', created_at: '2026-08-01T00:00:00Z', metadata: { beadFormsSummary: { hasForms: true, hasPendingAnswer: true, pendingResponseCount: 1, formIds: ['review'], pendingFormIds: ['review'] }, beadForms: { forms: [storedForm()] } } },
          { id: 'closed', title: 'Closed bead', status: 'closed', metadata: { beadFormsSummary: { hasForms: true, hasPendingAnswer: true, pendingResponseCount: 1, formIds: ['closed_form'], pendingFormIds: ['closed_form'] }, beadForms: { forms: [storedForm('closed_form', 'Closed')] } } },
        ]), stderr: '' };
      }
      if (options.cwd.endsWith('repo-b')) {
        throw Object.assign(new Error('Command failed: bd list'), { stderr: 'Error: no beads database found' });
      }
      return { stdout: '[]', stderr: '' };
    });
    const client = new BeadsClient({ execFile: exec });

    const result = await client.listPendingBeadsFormQueue({ reposRoot, repoLimit: 2 });

    expect(result.reposScanned).toBe(2);
    expect(result.repoLimit).toBe(2);
    expect(result.reposRoot).toBe(reposRoot);
    expect(result.entries).toEqual([{
      repoDir: join(reposRoot, 'repo-a'),
      repoName: 'repo-a',
      bead: { id: 'pending', title: 'Pending bead', createdAt: '2026-08-01T00:00:00Z' },
      form: { id: 'review', title: 'Review', responseCount: 0 },
    }]);
    expect(result.skipped).toEqual([]);
    expect(result.updateStrategy.mode).toBe('explicit-refresh');
    expect(exec.mock.calls.some(([, args]) => args.includes('update'))).toBe(false);
    expect(exec.mock.calls.some(([, args]) => args.includes('show'))).toBe(false);
    expect(exec.mock.calls.some(([, args]) => args.includes('beadForms') || args.includes('beadsWeb'))).toBe(false);
    expect(exec.mock.calls.map(([, , options]) => options.cwd).sort()).toEqual([
      join(reposRoot, 'repo-a'),
      join(reposRoot, 'repo-b'),
    ]);
  });

  it('caps pending queue bd checks at five repos at a time and sorts most recent first', async () => {
    const reposRoot = await mkdtemp(join(tmpdir(), 'beads-repos-concurrent-'));
    for (let index = 0; index < 6; index += 1) {
      await mkdir(join(reposRoot, `repo-${index}`, '.beads'), { recursive: true });
    }
    let active = 0;
    let maxActive = 0;
    const exec = vi.fn<ExecFileLike>(async (_file, args, options) => {
      expect(args).toEqual(['--readonly', 'list', '--json', '--all', '--limit', '0', '--has-metadata-key', 'beadFormsSummary']);
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      const repoIndex = Number(options.cwd.match(/repo-(\d+)$/)?.[1] ?? 0);
      return { stdout: JSON.stringify([
        {
          id: `bead-${repoIndex}`,
          title: `Bead ${repoIndex}`,
          updated_at: `2026-08-0${repoIndex + 1}T00:00:00Z`,
          metadata: {
            beadFormsSummary: { hasForms: true, hasPendingAnswer: true, pendingResponseCount: 1, formIds: ['review'], pendingFormIds: ['review'] },
            beadForms: { forms: [storedForm('review', `Review ${repoIndex}`)] },
          },
        },
      ]), stderr: '' };
    });
    const client = new BeadsClient({ execFile: exec });

    const result = await client.listPendingBeadsFormQueue({ reposRoot, repoLimit: 6 });

    expect(maxActive).toBeLessThanOrEqual(5);
    expect(result.entries.map((entry) => entry.bead.id)).toEqual(['bead-5', 'bead-4', 'bead-3', 'bead-2', 'bead-1', 'bead-0']);
  });

  it('skips unsupported raw-html-only pending forms while accepting standard DSL with stale generated fields', async () => {
    const reposRoot = await mkdtemp(join(tmpdir(), 'beads-repos-raw-'));
    await mkdir(join(reposRoot, 'repo-a', '.beads'), { recursive: true });
    const exec = vi.fn<ExecFileLike>(async () => ({ stdout: JSON.stringify([
      {
        id: 'mixed',
        title: 'Mixed',
        metadata: {
          beadFormsSummary: { hasForms: true, hasPendingAnswer: true, pendingResponseCount: 2, formIds: ['raw', 'standard'], pendingFormIds: ['raw', 'standard'] },
          beadForms: { forms: [
            { id: 'raw', title: 'Raw', html: '<form></form>' },
            { ...storedForm('standard', 'Standard'), html: '<form><input name="stale"></form>', controls: [{ id: 'stale', name: 'stale', type: 'textarea' }] },
          ] },
        },
      },
    ]), stderr: '' }));
    const client = new BeadsClient({ execFile: exec });

    const result = await client.listPendingBeadsFormQueue({ reposRoot });

    expect(result.entries.map((entry) => entry.form.id)).toEqual(['standard']);
    expect(result.skipped).toEqual([]);
  });
});

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
});

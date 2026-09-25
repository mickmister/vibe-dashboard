import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BeadsClient,
  clearCompletedBeadsFormSubmitResults,
  draftFormProgressInMetadata,
  getBeadsFormDraft,
  type ExecFileLike,
} from './beadsClient.node';
import { getBeadsForms } from './beadsFormCore';

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
const submissionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('BeadsClient', () => {
  beforeEach(() => clearCompletedBeadsFormSubmitResults());

  it('stores and reads one server draft per workspace, repo, bead, and form without touching responses', () => {
    const metadata = draftFormProgressInMetadata(reviewMetadata, {
      workspaceId: 'workspace-1',
      dir: '/repo',
      beadId: 'beads-web-biu',
      formId: 'review',
      values: { comment: 'draft with `code` | pipe' },
      position: { kind: 'question', index: 2 },
      updatedAt: '2026-09-25T00:00:00.000Z',
    });

    expect(getBeadsFormDraft(metadata, {
      workspaceId: 'workspace-1',
      dir: '/repo',
      beadId: 'beads-web-biu',
      formId: 'review',
    })).toEqual({
      values: { comment: 'draft with `code` | pipe' },
      position: { kind: 'question', index: 2 },
      updatedAt: '2026-09-25T00:00:00.000Z',
    });
    expect(getBeadsFormDraft(metadata, {
      workspaceId: 'workspace-2',
      dir: '/repo',
      beadId: 'beads-web-biu',
      formId: 'review',
    })).toBeUndefined();
    expect(((metadata.beadForms as Record<string, unknown>).forms as Array<Record<string, unknown>>)[0]?.responses).toBeUndefined();
  });

  it('clears a matching server draft when a response is submitted', async () => {
    let metadata: Record<string, unknown> = draftFormProgressInMetadata(reviewMetadata, {
      workspaceId: 'workspace-1',
      dir: '/repo-draft-clear',
      beadId: 'beads-web-biu',
      formId: 'review',
      values: { comment: 'draft' },
      position: { kind: 'review' },
      updatedAt: '2026-09-25T00:00:00.000Z',
    });
    const exec = vi.fn<ExecFileLike>(async (_file, args) => {
      if (args[0] === '--readonly') return { stdout: beadJson(metadata), stderr: '' };
      const metadataArg = args.find((arg) => arg.startsWith('@'));
      if (metadataArg) metadata = JSON.parse(await readFile(metadataArg.slice(1), 'utf8')) as Record<string, unknown>;
      return { stdout: '', stderr: '' };
    });
    const client = new BeadsClient({ execFile: exec, now: () => new Date('2026-09-25T01:00:00.000Z') });

    await client.submitForm({
      workspaceId: 'workspace-1',
      dir: '/repo-draft-clear',
      beadId: 'beads-web-biu',
      formId: 'review',
      submissionId,
      values: { comment: 'submitted' },
    });

    expect(getBeadsFormDraft(metadata, {
      workspaceId: 'workspace-1',
      dir: '/repo-draft-clear',
      beadId: 'beads-web-biu',
      formId: 'review',
    })).toBeUndefined();
    expect(getBeadsForms(metadata)[0]?.responses?.at(-1)?.values).toEqual({
      comment: 'submitted',
      allow_code_file_changes: false,
    });
  });

  it('saves draft progress without appending a response and rejects stale draft overwrites before mutation', async () => {
    let metadata: Record<string, unknown> = { ...reviewMetadata };
    const exec = vi.fn<ExecFileLike>(async (_file, args) => {
      if (args[0] === '--readonly') return { stdout: beadJson(metadata), stderr: '' };
      const metadataArg = args.find((arg) => arg.startsWith('@'));
      if (metadataArg) metadata = JSON.parse(await readFile(metadataArg.slice(1), 'utf8')) as Record<string, unknown>;
      return { stdout: '', stderr: '' };
    });
    const client = new BeadsClient({
      execFile: exec,
      now: () => new Date('2026-09-25T01:00:00.000Z'),
    });

    const saved = await client.saveFormDraft({
      dir: '/repo-draft-save',
      beadId: 'beads-web-biu',
      formId: 'review',
      workspaceId: 'workspace-1',
      values: { comment: 'draft' },
      position: { kind: 'review' },
    });

    expect(saved.draft).toEqual({
      values: { comment: 'draft', allow_code_file_changes: false },
      position: { kind: 'review' },
      updatedAt: '2026-09-25T01:00:00.000Z',
    });
    expect(getBeadsFormDraft(metadata, {
      workspaceId: 'workspace-1',
      dir: '/repo-draft-save',
      beadId: 'beads-web-biu',
      formId: 'review',
    })).toEqual(saved.draft);
    expect(getBeadsForms(metadata)[0]?.responses).toBeUndefined();

    await expect(client.saveFormDraft({
      dir: '/repo-draft-save',
      beadId: 'beads-web-biu',
      formId: 'review',
      workspaceId: 'workspace-1',
      values: { comment: 'stale overwrite' },
      baseUpdatedAt: '2026-09-25T00:59:00.000Z',
    })).rejects.toThrow(/draft changed/i);
    expect(exec.mock.calls.filter(([, args]) => args.includes('--metadata'))).toHaveLength(1);
  });

  it('persists first and notifies exactly the valid creating session without adding the fallback label', async () => {
    const order: string[] = [];
    const sessionId = '2e56418d-2829-4e2f-aab7-105c5aab41dc';
    const exec = vi.fn<ExecFileLike>(async (_file, args) => {
      if (args[0] === '--readonly') return { stdout: beadJson({ ...reviewMetadata, VK_SESSION_ID: sessionId }), stderr: '' };
      order.push(args.includes('--metadata') ? 'persist' : 'label');
      return { stdout: '', stderr: '' };
    });
    const notifySession = vi.fn(async (targetSessionId: string, message: string) => {
      order.push('notify');
      expect(targetSessionId).toBe(sessionId);
      expect(message).toContain('beads-web-biu');
      expect(message).toContain('"questions"');
      expect(message).toContain('<beadsFormSubmission>');
    });
    const client = new BeadsClient({ execFile: exec, notifySession });

    const result = await client.submitForm({ dir: '/repo', beadId: 'beads-web-biu', formId: 'review', submissionId, values: { comment: 'LGTM' } });

    expect(order).toEqual(['persist', 'notify']);
    expect(notifySession).toHaveBeenCalledTimes(1);
    expect(result.warnings).toEqual([]);
  });

  it.each([
    ['absent', undefined],
    ['invalid', 'session; unsafe'],
  ])('uses the review-label fallback for %s creating-session metadata', async (_case, sessionId) => {
    const notifySession = vi.fn(async (_sessionId: string, _message: string) => undefined);
    const exec = vi.fn<ExecFileLike>(async (_file, args) => {
      if (args[0] === '--readonly') {
        return { stdout: beadJson({ ...reviewMetadata, ...(sessionId ? { VK_SESSION_ID: sessionId } : {}) }), stderr: '' };
      }
      return { stdout: '', stderr: '' };
    });
    const client = new BeadsClient({ execFile: exec, notifySession });

    const result = await client.submitForm({ dir: '/repo', beadId: 'beads-web-biu', formId: 'review', submissionId, values: { comment: 'LGTM' } });

    expect(notifySession).not.toHaveBeenCalled();
    expect(exec.mock.calls.some(([, args]) => args.includes('--add-label'))).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it('returns saved success with a visible no-resubmit warning and fallback label when notification fails', async () => {
    const order: string[] = [];
    const exec = vi.fn<ExecFileLike>(async (_file, args) => {
      if (args[0] === '--readonly') return { stdout: beadJson({ ...reviewMetadata, VK_SESSION_ID: '2e56418d-2829-4e2f-aab7-105c5aab41dc' }), stderr: '' };
      order.push(args.includes('--metadata') ? 'persist' : 'label');
      return { stdout: '', stderr: '' };
    });
    const client = new BeadsClient({
      execFile: exec,
      notifySession: async () => {
        order.push('notify');
        throw new Error('session offline');
      },
    });

    const input = { dir: '/repo-warning-replay', beadId: 'beads-web-biu', formId: 'review', submissionId, values: { comment: 'LGTM' } };
    const result = await client.submitForm(input);
    const retry = await client.submitForm(input);

    expect(order).toEqual(['persist', 'notify', 'label']);
    expect(result.values).toEqual({ comment: 'LGTM', allow_code_file_changes: false });
    expect(result.warnings.join(' ')).toContain('response was saved');
    expect(result.warnings.join(' ')).toContain('do not submit again');
    expect(retry).toEqual(result);
  });

  it('replays timeout warnings to queued same-id callers without another write, send, or fallback', async () => {
    vi.useFakeTimers();
    const calls = { persist: 0, notify: 0, fallback: 0 };
    let markNotifyStarted!: () => void;
    const notifyStarted = new Promise<void>((resolve) => { markNotifyStarted = resolve; });
    const exec = vi.fn<ExecFileLike>(async (_file, args) => {
      if (args[0] === '--readonly') return { stdout: beadJson({ ...reviewMetadata, VK_SESSION_ID: '2e56418d-2829-4e2f-aab7-105c5aab41dc' }), stderr: '' };
      if (args.includes('--metadata')) calls.persist += 1;
      if (args.includes('--add-label')) calls.fallback += 1;
      return { stdout: '', stderr: '' };
    });
    const client = new BeadsClient({
      execFile: exec,
      notifySession: async () => {
        calls.notify += 1;
        markNotifyStarted();
        await new Promise((_, reject) => setTimeout(() => reject(new Error('notification timed out')), 100));
      },
    });
    const input = { dir: '/repo-timeout-replay', beadId: 'beads-web-biu', formId: 'review', submissionId, values: { comment: 'LGTM' } };
    const results = Promise.all([client.submitForm(input), client.submitForm(input)]);
    await notifyStarted;
    await vi.advanceTimersByTimeAsync(100);
    const [first, second] = await results;

    expect(second).toEqual(first);
    expect(first.warnings.join(' ')).toContain('do not submit again');
    expect(calls).toEqual({ persist: 1, notify: 1, fallback: 1 });
    vi.useRealTimers();
  });

  it('routes independent aggregate-source submissions to each source creator exactly once', async () => {
    const sessionsByDir: Record<string, string> = {
      '/repo-a': '11111111-1111-4111-8111-111111111111',
      '/repo-b': '22222222-2222-4222-8222-222222222222',
    };
    const metadataByDir: Record<string, Record<string, unknown>> = Object.fromEntries(
      Object.entries(sessionsByDir).map(([dir, session]) => [dir, { ...reviewMetadata, VK_SESSION_ID: session }]),
    );
    const exec = vi.fn<ExecFileLike>(async (_file, args, options) => {
      if (args[0] === '--readonly') {
        return { stdout: beadJson(metadataByDir[options.cwd]), stderr: '' };
      }
      const metadataArg = args.find((arg) => arg.startsWith('@'));
      if (metadataArg) {
        metadataByDir[options.cwd] = JSON.parse(await readFile(metadataArg.slice(1), 'utf8')) as Record<string, unknown>;
      }
      return { stdout: '', stderr: '' };
    });
    const notifySession = vi.fn(async (_sessionId: string, _message: string) => undefined);
    const client = new BeadsClient({ execFile: exec, notifySession });

    const sourceA = { dir: '/repo-a', beadId: 'beads-web-biu', formId: 'review', submissionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', values: { comment: 'A' } };
    const sourceB = { dir: '/repo-b', beadId: 'beads-web-biu', formId: 'review', submissionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', values: { comment: 'B' } };
    await client.submitForm(sourceA);
    await client.submitForm(sourceA);
    await client.submitForm(sourceB);
    await client.submitForm(sourceB);

    expect(notifySession.mock.calls.map(([sessionId]) => sessionId)).toEqual([
      sessionsByDir['/repo-a'],
      sessionsByDir['/repo-b'],
    ]);
  });

  it('deduplicates a lost-response retry by durable submissionId and allows a different id', async () => {
    let metadata: Record<string, unknown> = { ...reviewMetadata, VK_SESSION_ID: '2e56418d-2829-4e2f-aab7-105c5aab41dc' };
    let persistCount = 0;
    const exec = vi.fn<ExecFileLike>(async (_file, args) => {
      if (args[0] === '--readonly') return { stdout: beadJson(metadata), stderr: '' };
      const metadataArg = args.find((arg) => arg.startsWith('@'));
      if (metadataArg) {
        metadata = JSON.parse(await readFile(metadataArg.slice(1), 'utf8')) as Record<string, unknown>;
        persistCount += 1;
      }
      return { stdout: '', stderr: '' };
    });
    const notifySession = vi.fn(async (_sessionId: string, _message: string) => undefined);
    const client = new BeadsClient({ execFile: exec, notifySession });

    const input = { dir: '/repo', beadId: 'beads-web-biu', formId: 'review', submissionId, values: { comment: 'first' } };
    const first = await client.submitForm(input);
    const retry = await client.submitForm({ ...input, values: { comment: 'retry must not replace saved data' } });
    await client.submitForm({ ...input, submissionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', values: { comment: 'second' } });

    expect(retry).toMatchObject({ submittedAt: first.submittedAt, values: first.values, submissionId });
    expect(persistCount).toBe(2);
    expect(notifySession).toHaveBeenCalledTimes(2);
    const responses = ((metadata.beadFormResponses as { responsesByFormId: Record<string, unknown[]> }).responsesByFormId.review);
    expect(responses).toHaveLength(2);
  });

  it('serializes concurrent same-id retries into one persistence and one notification', async () => {
    let metadata: Record<string, unknown> = { ...reviewMetadata, VK_SESSION_ID: '2e56418d-2829-4e2f-aab7-105c5aab41dc' };
    let updates = 0;
    const exec = vi.fn<ExecFileLike>(async (_file, args) => {
      if (args[0] === '--readonly') return { stdout: beadJson(metadata), stderr: '' };
      const metadataArg = args.find((arg) => arg.startsWith('@'));
      if (metadataArg) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        metadata = JSON.parse(await readFile(metadataArg.slice(1), 'utf8')) as Record<string, unknown>;
        updates += 1;
      }
      return { stdout: '', stderr: '' };
    });
    const notifySession = vi.fn(async () => undefined);
    const client = new BeadsClient({ execFile: exec, notifySession });
    const input = { dir: '/repo-concurrent-same', beadId: 'beads-web-biu', formId: 'review', submissionId, values: { comment: 'once' } };

    const [first, second] = await Promise.all([client.submitForm(input), client.submitForm(input)]);

    expect(second).toMatchObject({ submissionId, values: first.values, submittedAt: first.submittedAt });
    expect(updates).toBe(1);
    expect(notifySession).toHaveBeenCalledTimes(1);
    expect((metadata.beadFormResponses as { responsesByFormId: { review: unknown[] } }).responsesByFormId.review).toHaveLength(1);
  });

  it('serializes concurrent different ids without losing either response', async () => {
    let metadata: Record<string, unknown> = { ...reviewMetadata, VK_SESSION_ID: '2e56418d-2829-4e2f-aab7-105c5aab41dc' };
    const exec = vi.fn<ExecFileLike>(async (_file, args) => {
      if (args[0] === '--readonly') return { stdout: beadJson(metadata), stderr: '' };
      const metadataArg = args.find((arg) => arg.startsWith('@'));
      if (metadataArg) metadata = JSON.parse(await readFile(metadataArg.slice(1), 'utf8')) as Record<string, unknown>;
      return { stdout: '', stderr: '' };
    });
    const notifySession = vi.fn(async () => undefined);
    const client = new BeadsClient({ execFile: exec, notifySession });

    await Promise.all([
      client.submitForm({ dir: '/repo-concurrent-different', beadId: 'beads-web-biu', formId: 'review', submissionId: '11111111-1111-4111-8111-111111111111', values: { comment: 'one' } }),
      client.submitForm({ dir: '/repo-concurrent-different', beadId: 'beads-web-biu', formId: 'review', submissionId: '22222222-2222-4222-8222-222222222222', values: { comment: 'two' } }),
    ]);

    const responses = (metadata.beadFormResponses as { responsesByFormId: { review: Array<{ values: { comment: string } }> } }).responsesByFormId.review;
    expect(responses.map((response) => response.values.comment)).toEqual(['one', 'two']);
    expect(notifySession).toHaveBeenCalledTimes(2);
  });

  it('releases the keyed lock after persistence and notification failures', async () => {
    let metadata: Record<string, unknown> = { ...reviewMetadata, VK_SESSION_ID: '2e56418d-2829-4e2f-aab7-105c5aab41dc' };
    let failPersistence = true;
    const exec = vi.fn<ExecFileLike>(async (_file, args) => {
      if (args[0] === '--readonly') return { stdout: beadJson(metadata), stderr: '' };
      const metadataArg = args.find((arg) => arg.startsWith('@'));
      if (metadataArg && failPersistence) { failPersistence = false; throw new Error('disk failed'); }
      if (metadataArg) metadata = JSON.parse(await readFile(metadataArg.slice(1), 'utf8')) as Record<string, unknown>;
      return { stdout: '', stderr: '' };
    });
    let failNotification = true;
    const notifySession = vi.fn(async () => {
      if (failNotification) { failNotification = false; throw new Error('notify timeout'); }
    });
    const client = new BeadsClient({ execFile: exec, notifySession });

    await expect(client.submitForm({ dir: '/repo-lock-cleanup', beadId: 'beads-web-biu', formId: 'review', submissionId: '11111111-1111-4111-8111-111111111111', values: { comment: 'fails' } })).rejects.toThrow('disk failed');
    const warned = await client.submitForm({ dir: '/repo-lock-cleanup', beadId: 'beads-web-biu', formId: 'review', submissionId: '11111111-1111-4111-8111-111111111111', values: { comment: 'saved with warning' } });
    expect(warned.warnings.join(' ')).toContain('do not submit again');
    await expect(client.submitForm({ dir: '/repo-lock-cleanup', beadId: 'beads-web-biu', formId: 'review', submissionId: '33333333-3333-4333-8333-333333333333', values: { comment: 'later' } })).resolves.toMatchObject({ submissionId: '33333333-3333-4333-8333-333333333333' });
  });

  it('rejects malformed or oversized submission ids before reading or mutating the bead', async () => {
    const exec = vi.fn<ExecFileLike>();
    const client = new BeadsClient({ execFile: exec });
    await expect(client.submitForm({
      dir: '/repo', beadId: 'beads-web-biu', formId: 'review', submissionId: 'unsafe; id', values: {},
    })).rejects.toThrow('expected a UUID');
    expect(exec).not.toHaveBeenCalled();
  });
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
    const client = new BeadsClient({
      execFile: exec,
      now: () => new Date('2026-06-29T00:00:00Z'),
      actor: 'reviewer',
    });

    const result = await client.submitForm({ dir: '/repo', beadId: 'beads-web-biu', formId: 'review', submissionId, values: { comment: 'LGTM' } });

    expect(result.submittedAt).toBe('2026-06-29T00:00:00.000Z');
    expect(result.submittedBy).toBe('reviewer');
    expect(result.prettySummary).toContain('- comment: LGTM');
    expect(result.warnings).toEqual([]);
    expect(result.metadata.beadFormResponses).toMatchObject({
      responsesByFormId: {
        review: [{
          submittedAt: '2026-06-29T00:00:00.000Z',
          submittedBy: 'reviewer',
          values: { comment: 'LGTM' },
        }],
      },
    });
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

    const result = await client.submitForm({ dir: '/repo', beadId: 'beads-web-biu', formId: 'review', submissionId, values: { comment: 'LGTM' } });

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

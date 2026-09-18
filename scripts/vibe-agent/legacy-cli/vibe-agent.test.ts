import { describe, expect, it } from 'vitest';
import {
  formatFullSummaryText,
  getAdvanceableFullSummaryProcessIds,
  mapWithConcurrency,
  parseFullSummaryArgs,
  resolveCallbackSourceProcessId,
  startRegisteredCallbackRunner,
  uniqueActiveProcessId,
} from './vibe-agent.js';

const callbackPayload = {
  callbackId: 'callback', registryPath: '/tmp/callbacks.json', command: 'ci', outputFile: '/tmp/output',
  sessionId: 'session', cwd: '/tmp',
};

describe('uniqueActiveProcessId', () => {
  it('correlates only a uniquely active invoking process', () => {
    expect(uniqueActiveProcessId([{ id: 'one', status: 'running', completed_at: null }])).toBe('one');
    expect(uniqueActiveProcessId([{ id: 'one', status: 'running', completed_at: null }, { id: 'two', status: 'running', completed_at: null }])).toBeNull();
    expect(uniqueActiveProcessId([{ id: 'done', status: 'completed', completed_at: '2026-09-18T00:00:00Z' }])).toBeNull();
  });
});

describe('resolveCallbackSourceProcessId', () => {
  it('retries transient lookup failure and resolves a unique process', async () => {
    let calls = 0;
    const result = await resolveCallbackSourceProcessId('session', {
      async getProcesses() { if (++calls === 1) throw new Error('temporary'); return [{ id: 'source', status: 'running', completed_at: null }]; },
      async delay() {},
    });
    expect(result).toBe('source');
    expect(calls).toBe(2);
  });

  it('falls back to an uncorrelated callback after bounded lookup failures', async () => {
    let calls = 0;
    const result = await resolveCallbackSourceProcessId('session', {
      async getProcesses() { calls++; throw new Error('offline'); }, async delay() {},
    });
    expect(result).toBeNull();
    expect(calls).toBe(3);
  });
});

describe('startRegisteredCallbackRunner', () => {
  it('keeps registry failure fatal and does not spawn', () => {
    let spawned = false;
    expect(() => startRegisteredCallbackRunner(callbackPayload, null, {
      create() { throw new Error('registry unavailable'); }, update() { throw new Error('unexpected'); }, fail() { throw new Error('unexpected'); },
      spawn() { spawned = true; throw new Error('unexpected'); },
    })).toThrow('registry unavailable');
    expect(spawned).toBe(false);
  });

  it('records synchronous spawn failure', () => {
    const failures: string[] = [];
    expect(() => startRegisteredCallbackRunner(callbackPayload, 'source', {
      create: (() => ({})) as any, update: (() => ({})) as any,
      fail: ((_path: string, _id: string, error: Error) => { failures.push(error.message); return {} as any; }) as any,
      spawn() { throw new Error('spawn failed'); },
    })).toThrow('spawn failed');
    expect(failures).toEqual(['spawn failed']);
  });

  it('persists PID and records asynchronous spawn failure', () => {
    const updates: unknown[] = []; const failures: string[] = []; let errorListener: ((error: Error) => void) | undefined;
    startRegisteredCallbackRunner(callbackPayload, 'source', {
      create: (() => ({})) as any,
      update: ((_path: string, _id: string, update: unknown) => { updates.push(update); return {} as any; }) as any,
      fail: ((_path: string, _id: string, error: Error) => { failures.push(error.message); return {} as any; }) as any,
      spawn: () => ({ pid: 123, unref() {}, once(_event, listener) { errorListener = listener; } }),
    });
    expect(updates).toEqual([{ runnerPid: 123 }]);
    errorListener?.(new Error('later failure'));
    expect(failures).toEqual(['later failure']);
  });
});

describe('parseFullSummaryArgs', () => {
  it('uses bounded defaults for large workspaces', () => {
    expect(parseFullSummaryArgs([])).toMatchObject({
      limitTurns: 100,
      limitSessions: 25,
      conversationTimeoutMs: 30_000,
    });
  });

  it('parses conversation timeout duration flags', () => {
    expect(parseFullSummaryArgs(['--conversation-timeout', '45s']).conversationTimeoutMs).toBe(45_000);
    expect(parseFullSummaryArgs(['--conversation-timeout-ms=12000']).conversationTimeoutMs).toBe(12_000);
  });
});

describe('getAdvanceableFullSummaryProcessIds', () => {
  it('excludes turns with failed conversation fetches from pager advancement', () => {
    expect(getAdvanceableFullSummaryProcessIds([
      { process: { id: 'successful-process' }, conversationFetchError: null },
      {
        process: { id: 'timed-out-process' },
        conversationFetchError: 'Timed out waiting for process timed-out-process after 30000ms',
      },
    ])).toEqual(['successful-process']);
  });
});

describe('mapWithConcurrency', () => {
  it('preserves input order while limiting active work', async () => {
    let active = 0;
    let maxActive = 0;
    const results = await mapWithConcurrency([3, 2, 1, 0], 2, async (value) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, value));
      active -= 1;
      return value * 2;
    });

    expect(results).toEqual([6, 4, 2, 0]);
    expect(maxActive).toBeLessThanOrEqual(2);
  });
});

describe('formatFullSummaryText', () => {
  it('includes recoverable conversation fetch errors in text output', () => {
    const output = formatFullSummaryText({
      workspace_id: 'workspace-1',
      workspace_name: null,
      reader_session_id: 'reader-1',
      excluded_current_session_id: null,
      excluded_session_ids: [],
      guardrails: {
        total_matching_sessions: 1,
        sessions_returned: 1,
        turns_returned: 1,
        limited: false,
        message: null,
      },
      turns: [{
        session: {
          id: 'session-1',
          executor: 'CODEX',
          role: 'impl',
          name: null,
          created_at: '2026-01-01T00:00:00.000Z',
        },
        process: {
          id: 'process-1',
          status: 'completed',
          created_at: '2026-01-01T00:00:01.000Z',
          completed_at: '2026-01-01T00:00:02.000Z',
          run_reason: 'manual',
        },
        initialUserPrompt: 'hello',
        agentPreResponse: null,
        toolCalls: { reads: 0, writes: 0, webSearches: 0, other: 0, total: 0 },
        agentResponse: null,
        conversationFetchError: 'Timed out waiting for process process-1 after 30000ms',
        gitCommits: [],
        gitCommitSummaryNote: 'Skipped',
        gitRepositoryPath: null,
      }],
    });

    expect(output).toContain('<conversation_fetch_error>Timed out waiting for process process-1 after 30000ms</conversation_fetch_error>');
  });
});

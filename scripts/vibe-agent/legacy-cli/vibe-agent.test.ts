import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  deliverCallbackCompletion,
  formatFullSummaryText,
  getAdvanceableFullSummaryProcessIds,
  isDeterministicPreAcceptFollowUpError,
  mapWithConcurrency,
  parseFullSummaryArgs,
  parseSendArgs,
  resolveCallbackSourceProcessId,
  startRegisteredCallbackRunner,
  uniqueActiveProcessId,
} from './vibe-agent.js';

const callbackPayload = {
  callbackId: 'callback', registryPath: '/tmp/callbacks.json', command: 'ci', outputFile: '/tmp/output',
  sessionId: 'session', cwd: '/tmp',
};
afterEach(() => vi.useRealTimers());

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

  it('times out never-settling attempts and ignores late settlement', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const pending: Array<(value: any) => void> = [];
    const resultPromise = resolveCallbackSourceProcessId('session', {
      getProcesses() { calls++; return new Promise(resolve => pending.push(resolve)); },
      delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); },
    }, 3, 100, 2_000);
    await vi.advanceTimersByTimeAsync(6_200);
    const result = await resultPromise;
    expect(result).toBeNull();
    expect(calls).toBe(3);
    expect(vi.getTimerCount()).toBe(0);
    pending.forEach(resolve => resolve([{ id: 'late', status: 'running' }]));
    await Promise.resolve();
    expect(result).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });
});

describe('deliverCallbackCompletion', () => {
  const completed = { exitCode: 0, signal: null, timedOut: false, finishedAt: new Date('2026-09-18T00:00:00Z'), message: 'done', exitSummary: 'exit code 0' } as const;
  function dependencies(input: { sendError?: Error; updateError?: Error } = {}) {
    const updates: any[] = []; const logs: string[] = [];
    return { updates, logs, value: {
      async waitForIdle() {}, async getSession() { return { id: 'session', executor: 'CODEX' } as any; },
      async sendMessage() { if (input.sendError) throw input.sendError; return { id: 'completion' } as any; },
      update(_path: string, _id: string, update: any) { if (input.updateError) throw input.updateError; updates.push(update); return {} as any; },
      append(_file: string, text: string) { logs.push(text); },
    }};
  }

  it.each([
    [completed, 'completed', null],
    [{ ...completed, exitCode: 2, exitSummary: 'exit code 2' }, 'failed', 'exit code 2'],
    [{ ...completed, timedOut: true, exitSummary: 'timed out after 5ms' }, 'timed-out', 'timed out after 5ms'],
  ])('records command completion lifecycle %#', async (result, status, error) => {
    const deps = dependencies();
    await deliverCallbackCompletion(callbackPayload, result, deps.value as any);
    expect(deps.updates).toEqual([expect.objectContaining({ status, error, completionProcessId: 'completion' })]);
  });

  it('records delivery failure', async () => {
    const deps = dependencies({ sendError: new Error('delivery offline') });
    await deliverCallbackCompletion(callbackPayload, completed, deps.value as any);
    expect(deps.updates).toEqual([expect.objectContaining({ status: 'failed', error: 'delivery offline' })]);
    expect(deps.logs.join('')).toContain('delivery offline');
  });

  it('surfaces registry update failure in the callback output', async () => {
    const deps = dependencies({ updateError: new Error('registry readonly') });
    await deliverCallbackCompletion(callbackPayload, completed, deps.value as any);
    expect(deps.logs.join('')).toContain('callback registry update failed after completion delivery: registry readonly');
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

describe('parseSendArgs', () => {
  it('routes responses by default and keeps --respond as an alias', () => {
    expect(parseSendArgs(['review', 'please check'])).toMatchObject({ respond: false, fireAndForget: false });
    expect(parseSendArgs(['--respond', 'review', 'please check'])).toMatchObject({ respond: true, fireAndForget: false });
  });

  it('supports explicit fire-and-forget sends', () => {
    expect(parseSendArgs(['--fire-and-forget', 'review', 'FYI'])).toMatchObject({ fireAndForget: true });
  });
});

describe('isDeterministicPreAcceptFollowUpError', () => {
  it('classifies validation and HTTP rejection errors as pre-accept failures', () => {
    expect(isDeterministicPreAcceptFollowUpError(new Error('Validation error: unexpected follow-up'))).toBe(true);
    expect(isDeterministicPreAcceptFollowUpError(new Error('Not found: http://vk/api/sessions/missing'))).toBe(true);
    expect(isDeterministicPreAcceptFollowUpError(new Error('HTTP 503: scripted rejection'))).toBe(true);
  });

  it('leaves dropped network responses uncertain for daemon reconciliation', () => {
    expect(isDeterministicPreAcceptFollowUpError(new Error('fetch failed'))).toBe(false);
    expect(isDeterministicPreAcceptFollowUpError(new Error('socket hang up'))).toBe(false);
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

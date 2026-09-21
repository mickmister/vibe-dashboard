import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConversationEntry, ExecutionProcess, SendMessageBody, Session } from '../types.js';
import {
  abortableDelay, acquireLock, createAutoNudgeClient, loadAutoNudgeConfig, readAutoNudgeState, runAutoNudgeCycle, runWithOwnerLock, writeAutoNudgeState,
  type AutoNudgeClient, type AutoNudgeOptions,
} from './auto-nudge.js';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));
const iso = (minutes: number) => `2026-09-18T00:${String(minutes).padStart(2, '0')}:00.000Z`;
const proc = (id: string, sessionId: string, status: ExecutionProcess['status'], minute: number): ExecutionProcess => ({
  id, session_id: sessionId, status, created_at: iso(minute), started_at: iso(minute), updated_at: iso(minute),
  completed_at: status === 'running' ? null : iso(minute), exit_code: status === 'completed' ? 0 : 1,
  dropped: false, run_reason: 'codingagent', executor_action: { typ: { prompt: 'work' } },
});
const session = (id: string, name: string): Session => ({
  id, name, workspace_id: 'w1', executor: 'CODEX', created_at: iso(0), updated_at: iso(5),
});
const msg = (text: string): ConversationEntry => ({ content: { entry_type: { type: 'assistant_message' }, content: text } });
const tool: ConversationEntry = { content: { entry_type: { type: 'tool_use' }, content: 'tool' } };

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'auto-nudge-')); dirs.push(dir);
  const options: AutoNudgeOptions = {
    config: { version: 1, discord: { enabled: false }, workspaces: [{ workspaceId: 'w1', overseerSessionId: 'overseer' }] },
    statePath: join(dir, 'state.json'), callbackRegistryPath: join(dir, 'callbacks.json'),
    now: () => new Date(iso(10)), unacknowledgedAfterMs: 60_000, operationTimeoutMs: 1_000,
    responseTimeoutMs: 1_000, concurrency: 2, dryRun: false,
  };
  return { dir, options };
}

function fake(input: { processes: Record<string, ExecutionProcess[]>; entries?: Record<string, ConversationEntry[]>; response?: string }) {
  const sent: Array<{ sessionId: string; body: SendMessageBody }> = [];
  const client: AutoNudgeClient = {
    async getSessions() { return [session('overseer', 'overseer'), session('impl', 'impl')]; },
    async getSessionProcesses(id) { return input.processes[id] ?? []; },
    async fetchConversation(id) { return id === 'checkpoint' ? [msg(input.response ?? 'Continuing')] : input.entries?.[id] ?? []; },
    async sendMessage(id, body) { sent.push({ sessionId: id, body }); return proc(id === 'overseer' ? 'checkpoint' : `sent-${sent.length}`, id, 'running', 10); },
    async getExecutionProcess(id) { return proc(id, 'overseer', 'completed', 10); },
  };
  return { client, sent };
}

describe('auto nudge', () => {
  it('validates config and rejects duplicate workspaces', () => {
    const { dir } = setup(); const path = join(dir, 'config.json');
    writeFileSync(path, JSON.stringify({ version: 1, workspaces: [{ workspaceId: 'w', overseerSessionId: 'o' }, { workspaceId: 'w', overseerSessionId: 'x' }] }));
    expect(() => loadAutoNudgeConfig(path)).toThrow(/duplicate workspaceId/);
  });

  it('nudges an idle teammate terminal turn without a final response exactly once', async () => {
    const { options } = setup();
    const p = proc('failed', 'impl', 'failed', 8);
    const { client, sent } = fake({ processes: { impl: [p], overseer: [] }, entries: { failed: [tool] } });
    await runAutoNudgeCycle(client, options);
    await runAutoNudgeCycle(client, options);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ sessionId: 'impl', body: { prompt: 'Please continue' } });
  });

  it('keeps dry-run read-only and sends exactly once on the following real cycle', async () => {
    const { options } = setup();
    const p = proc('failed', 'impl', 'failed', 8);
    const { client, sent } = fake({ processes: { impl: [p], overseer: [] }, entries: { failed: [tool] } });
    options.dryRun = true;
    expect((await runAutoNudgeCycle(client, options)).teammateNudges).toBe(1);
    expect(existsSync(options.statePath)).toBe(false);
    options.dryRun = false;
    await runAutoNudgeCycle(client, options);
    await runAutoNudgeCycle(client, options);
    expect(sent).toHaveLength(1);
  });

  it('sends nothing while any workspace teammate is active', async () => {
    const { options } = setup();
    const failed = proc('failed', 'impl', 'failed', 8);
    const active = proc('active', 'review', 'running', 9);
    const { client, sent } = fake({ processes: { impl: [failed], review: [active], overseer: [] }, entries: { failed: [tool] } });
    client.getSessions = async () => [session('overseer', 'overseer'), session('impl', 'impl'), session('review', 'review')];
    await runAutoNudgeCycle(client, options);
    expect(sent).toEqual([]);
  });

  it('executes at most one deterministic recovery for two failed sessions', async () => {
    const { options } = setup();
    const older = proc('older', 'impl', 'failed', 7); const newer = proc('newer', 'review', 'failed', 8);
    const { client, sent } = fake({ processes: { impl: [older], review: [newer], overseer: [] }, entries: { older: [tool], newer: [tool] } });
    client.getSessions = async () => [session('overseer', 'overseer'), session('impl', 'impl'), session('review', 'review')];
    await runAutoNudgeCycle(client, options);
    expect(sent).toEqual([expect.objectContaining({ sessionId: 'review' })]);
  });

  it('treats newer teammate progress as acknowledgement before checkpointing', async () => {
    const { options } = setup();
    const completed = proc('complete', 'impl', 'completed', 5);
    const newer = proc('reviewed', 'review', 'completed', 7);
    const { client, sent } = fake({ processes: { impl: [completed], review: [newer], overseer: [] }, entries: { complete: [msg('Finished')], reviewed: [msg('Reviewed')] } });
    client.getSessions = async () => [session('overseer', 'overseer'), session('impl', 'impl'), session('review', 'review')];
    await runAutoNudgeCycle(client, options);
    expect(sent).toHaveLength(1);
    const state = readAutoNudgeState(options.statePath);
    expect(state.triggers.complete).toBeUndefined();
    expect(state.triggers.reviewed).toBeDefined();
  });

  it('creates a checkpoint for an old teammate completion and closes only that trigger on DONE', async () => {
    const { options } = setup();
    const complete = proc('complete-1', 'impl', 'completed', 5);
    const { client, sent } = fake({ processes: { impl: [complete], overseer: [] }, entries: { 'complete-1': [msg('Finished')] }, response: ' DONE ' });
    await runAutoNudgeCycle(client, options);
    expect(sent[0]?.sessionId).toBe('overseer');
    expect(readAutoNudgeState(options.statePath).triggers['complete-1']?.status).toBe('done');

    const next = proc('complete-2', 'impl', 'completed', 7);
    const nextClient = fake({ processes: { impl: [next, complete], overseer: [] }, entries: { 'complete-2': [msg('More work')], 'complete-1': [msg('Finished')] } });
    await runAutoNudgeCycle(nextClient.client, options);
    expect(nextClient.sent[0]?.sessionId).toBe('overseer');
  });

  it('keeps a non-DONE checkpoint open without a causally newer teammate process', async () => {
    const { options } = setup();
    const complete = proc('complete', 'impl', 'completed', 5);
    const { client } = fake({ processes: { impl: [complete], overseer: [] }, entries: { complete: [msg('Finished')] }, response: 'I will continue' });
    await runAutoNudgeCycle(client, options);
    expect(readAutoNudgeState(options.statePath).triggers.complete?.status).toBe('observed');
  });

  it('accepts delegation only from a new post-checkpoint process ID', async () => {
    const { options } = setup();
    const complete = proc('complete', 'impl', 'completed', 5);
    const delegated = proc('delegated', 'impl', 'completed', 11);
    const { client } = fake({ processes: { impl: [complete], overseer: [] }, entries: { complete: [msg('Finished')] }, response: 'Continuing' });
    let reads = 0;
    client.getSessionProcesses = async id => id === 'impl' ? (++reads > 1 ? [delegated, complete] : [complete]) : [];
    await runAutoNudgeCycle(client, options);
    expect(readAutoNudgeState(options.statePath).triggers.complete?.status).toBe('delegated');
  });

  it('does not nudge while an authoritative callback is running', async () => {
    const { options } = setup();
    writeFileSync(options.callbackRegistryPath, JSON.stringify({ version: 2, callbacks: [{ id: 'cb', sessionId: 'impl', command: 'ci', status: 'running', startedAt: iso(1), timeoutMs: null, finishedAt: null, completionProcessId: null, runnerPid: process.pid, sourceProcessId: 'complete', triggerProcessId: 'complete', error: null }] }));
    const complete = proc('complete', 'impl', 'completed', 5);
    const { client, sent } = fake({ processes: { impl: [complete], overseer: [] }, entries: { complete: [msg('Waiting')] } });
    await runAutoNudgeCycle(client, options);
    expect(sent).toEqual([]);
    expect(readAutoNudgeState(options.statePath).triggers.complete?.status).toBe('waiting-callback');
  });

  it('takes no later workspace action while a correlated callback is running', async () => {
    const { options } = setup();
    const callbackSource = proc('callback-source', 'impl', 'completed', 9);
    const otherCompletion = proc('other-complete', 'other', 'completed', 8);
    writeFileSync(options.callbackRegistryPath, JSON.stringify({ version: 2, callbacks: [{ id: 'cb', sessionId: 'impl', command: 'ci', status: 'running', startedAt: iso(9), timeoutMs: null, finishedAt: null, completionProcessId: null, runnerPid: process.pid, sourceProcessId: 'callback-source', triggerProcessId: 'callback-source', error: null }] }));
    const sent: string[] = [];
    const client: AutoNudgeClient = {
      async getSessions() { return [session('overseer', 'overseer'), session('impl', 'impl'), session('other', 'other')]; },
      async getSessionProcesses(id) { return id === 'impl' ? [callbackSource] : id === 'other' ? [otherCompletion] : []; },
      async fetchConversation() { return [msg('Finished')]; }, async getExecutionProcess() { throw new Error('unexpected'); },
      async sendMessage(id) { sent.push(id); return proc('sent', id, 'running', 10); },
    };
    await runAutoNudgeCycle(client, options);
    expect(sent).toEqual([]);
    expect(readAutoNudgeState(options.statePath).triggers['callback-source']?.status).toBe('waiting-callback');
  });

  it('ignores an unrelated session callback', async () => {
    const { options } = setup();
    writeFileSync(options.callbackRegistryPath, JSON.stringify({ version: 2, callbacks: [{ id: 'cb', sessionId: 'impl', command: 'ci', status: 'running', startedAt: iso(1), timeoutMs: null, finishedAt: null, completionProcessId: null, runnerPid: process.pid, sourceProcessId: 'other', triggerProcessId: 'other', error: null }] }));
    const complete = proc('complete', 'impl', 'completed', 5);
    const { client, sent } = fake({ processes: { impl: [complete], overseer: [] }, entries: { complete: [msg('Finished')] }, response: 'DONE' });
    await runAutoNudgeCycle(client, options);
    expect(sent).toHaveLength(1);
  });

  it('retries durable Discord outbox items until delivery succeeds', async () => {
    const { options } = setup();
    const state = readAutoNudgeState(options.statePath);
    state.outbox.event = { id: 'event', workspaceId: 'w1', content: 'alert', createdAt: iso(1), deliveredAt: null, attempts: 0 };
    writeAutoNudgeState(options.statePath, state);
    let attempts = 0;
    options.config.discord = { enabled: true };
    options.discordWebhookUrl = 'https://discord.invalid';
    options.deliverDiscord = async () => { attempts++; if (attempts === 1) throw new Error('down'); };
    const { client } = fake({ processes: { impl: [], overseer: [] } });
    await runAutoNudgeCycle(client, options);
    await runAutoNudgeCycle(client, options);
    expect(readAutoNudgeState(options.statePath).outbox.event.deliveredAt).not.toBeNull();
  });

  it('fails closed for malformed and wrong-version state', () => {
    const { options } = setup();
    writeFileSync(options.statePath, '{broken');
    expect(() => readAutoNudgeState(options.statePath)).toThrow(/Invalid auto-nudge state JSON/);
    writeFileSync(options.statePath, JSON.stringify({ version: 2, nudgedProcessIds: [], triggers: {}, outbox: {} }));
    expect(() => readAutoNudgeState(options.statePath)).toThrow(/Invalid auto-nudge state schema/);
    writeFileSync(options.statePath, JSON.stringify({ version: 1, nudgedProcessIds: [42], triggers: {}, outbox: {} }));
    expect(() => readAutoNudgeState(options.statePath)).toThrow(/Invalid auto-nudge state schema/);
  });

  it('times out a hung workspace operation without sending', async () => {
    const { options } = setup(); options.operationTimeoutMs = 5;
    const { client, sent } = fake({ processes: {} });
    client.getSessions = async () => new Promise(() => {});
    const result = await runAutoNudgeCycle(client, options);
    expect(result.errors[0]).toMatch(/get sessions timed out/);
    expect(sent).toEqual([]);
  });

  it('persists a retryable failure when the correlated response wait times out', async () => {
    const { options } = setup();
    const complete = proc('complete', 'impl', 'completed', 5);
    const { client } = fake({ processes: { impl: [complete], overseer: [] }, entries: { complete: [msg('Finished')] } });
    options.responseTimeoutMs = 5; options.checkpointPollMs = 1;
    client.getExecutionProcess = async id => proc(id, 'overseer', 'running', 10);
    await runAutoNudgeCycle(client, options);
    expect(readAutoNudgeState(options.statePath).triggers.complete).toMatchObject({ status: 'checkpoint-sent', checkpointProcessId: 'checkpoint' });
  });

  it.each([
    ['completed', 'DONE', 'done', 'persisted'],
    ['failed', '', 'retryable-failure', null],
    ['killed', '', 'retryable-failure', null],
  ] as const)('reconciles a persisted %s checkpoint without resending', async (status, response, expectedStatus, expectedId) => {
    const { options } = setup();
    const complete = proc('complete', 'impl', 'completed', 5);
    const state = readAutoNudgeState(options.statePath);
    state.triggers.complete = { processId: 'complete', workspaceId: 'w1', sessionId: 'impl', observedAt: iso(6), status: 'checkpoint-sent', checkpointProcessId: 'persisted', baselineProcessIds: ['complete'], updatedAt: iso(6), error: null };
    writeAutoNudgeState(options.statePath, state);
    const { client, sent } = fake({ processes: { impl: [complete], overseer: [] }, entries: { complete: [msg('Finished')], persisted: response ? [msg(response)] : [] } });
    client.getExecutionProcess = async () => proc('persisted', 'overseer', status, 8);
    await runAutoNudgeCycle(client, options);
    expect(sent).toEqual([]);
    expect(readAutoNudgeState(options.statePath).triggers.complete).toMatchObject({ status: expectedStatus, checkpointProcessId: expectedId });
  });

  it('resumes polling a persisted running checkpoint instead of resending', async () => {
    const { options } = setup(); options.checkpointPollMs = 1;
    const complete = proc('complete', 'impl', 'completed', 5);
    const state = readAutoNudgeState(options.statePath);
    state.triggers.complete = { processId: 'complete', workspaceId: 'w1', sessionId: 'impl', observedAt: iso(6), status: 'checkpoint-sent', checkpointProcessId: 'persisted', baselineProcessIds: ['complete'], updatedAt: iso(6), error: null };
    writeAutoNudgeState(options.statePath, state);
    const { client, sent } = fake({ processes: { impl: [complete], overseer: [proc('persisted', 'overseer', 'running', 8)] }, entries: { complete: [msg('Finished')], persisted: [msg('DONE')] } });
    let reads = 0;
    client.getExecutionProcess = async () => proc('persisted', 'overseer', ++reads === 1 ? 'running' : 'completed', 8);
    await runAutoNudgeCycle(client, options);
    expect(sent).toEqual([]);
    expect(reads).toBe(2);
    expect(readAutoNudgeState(options.statePath).triggers.complete?.status).toBe('done');
  });

  it('fails closed when a persisted checkpoint is missing', async () => {
    const { options } = setup(); const complete = proc('complete', 'impl', 'completed', 5);
    const state = readAutoNudgeState(options.statePath);
    state.triggers.complete = { processId: 'complete', workspaceId: 'w1', sessionId: 'impl', observedAt: iso(6), status: 'checkpoint-sent', checkpointProcessId: 'missing', baselineProcessIds: ['complete'], updatedAt: iso(6), error: null };
    writeAutoNudgeState(options.statePath, state);
    const { client, sent } = fake({ processes: { impl: [complete], overseer: [] }, entries: { complete: [msg('Finished')] } });
    client.getExecutionProcess = async () => { throw new Error('Not found'); };
    await runAutoNudgeCycle(client, options);
    expect(sent).toEqual([]);
    expect(readAutoNudgeState(options.statePath).triggers.complete).toMatchObject({ status: 'checkpoint-sent', checkpointProcessId: 'missing', error: 'Not found' });
  });

  it('converts a null-ID checkpoint to durable indeterminate state and never resends', async () => {
    const { options } = setup(); const complete = proc('complete', 'impl', 'completed', 5);
    const state = readAutoNudgeState(options.statePath);
    state.triggers.complete = { processId: 'complete', workspaceId: 'w1', sessionId: 'impl', observedAt: iso(6), status: 'checkpoint-sent', checkpointProcessId: null, baselineProcessIds: ['complete'], updatedAt: iso(6), error: null };
    writeAutoNudgeState(options.statePath, state);
    const { client, sent } = fake({ processes: { impl: [complete], overseer: [] }, entries: { complete: [msg('Finished')] } });
    const first = await runAutoNudgeCycle(client, options);
    const second = await runAutoNudgeCycle(client, options);
    expect(sent).toEqual([]);
    expect(first.errors[0]).toMatch(/indeterminate.*manual recovery/);
    expect(second.errors[0]).toMatch(/indeterminate.*manual recovery/);
    expect(readAutoNudgeState(options.statePath).triggers.complete).toMatchObject({
      status: 'checkpoint-indeterminate', checkpointProcessId: null,
      error: expect.stringMatching(/automatic resend is disabled/),
    });
  });

  it('persists checkpoint identity before a wait failure', async () => {
    const { options } = setup(); const complete = proc('complete', 'impl', 'completed', 5);
    const { client } = fake({ processes: { impl: [complete], overseer: [] }, entries: { complete: [msg('Finished')] } });
    client.getExecutionProcess = async () => { throw new Error('connection lost'); };
    await runAutoNudgeCycle(client, options);
    expect(readAutoNudgeState(options.statePath).triggers.complete).toMatchObject({ status: 'checkpoint-sent', checkpointProcessId: 'checkpoint' });
  });

  it('bounds concurrent workspace inspection', async () => {
    const { options } = setup();
    options.config.workspaces = ['w1', 'w2', 'w3'].map(workspaceId => ({ workspaceId, overseerSessionId: `overseer-${workspaceId}` }));
    options.concurrency = 2;
    let active = 0; let maximum = 0;
    const client: AutoNudgeClient = {
      async getSessions(workspaceId) { active++; maximum = Math.max(maximum, active); await new Promise(resolve => setTimeout(resolve, 5)); active--; return [session(`overseer-${workspaceId}`, 'overseer')]; },
      async getSessionProcesses() { return []; }, async fetchConversation() { return []; },
      async getExecutionProcess() { throw new Error('unexpected'); }, async sendMessage() { throw new Error('unexpected'); },
    };
    expect((await runAutoNudgeCycle(client, options)).workspaces).toBe(3);
    expect(maximum).toBe(2);
  });

  it('enforces owner lock contention and recovers a stale owner', () => {
    const { dir } = setup(); const lock = join(dir, 'owner.lock');
    const release = acquireLock(lock);
    expect(() => acquireLock(lock)).toThrow(/another auto-nudge owner/);
    release();
    const staleLock = join(dir, 'stale.lock');
    mkdirSync(staleLock); writeFileSync(join(staleLock, 'pid'), '2147483647');
    expect(() => acquireLock(staleLock)()).not.toThrow();
  });

  it('uses the existing REST client for exact process send/status and keeps logs separate', async () => {
    const sentProcess = proc('checkpoint', 'overseer', 'running', 8);
    const terminalProcess = proc('checkpoint', 'overseer', 'completed', 9);
    let observedTimeout: number | undefined;
    const adapter = createAutoNudgeClient({
      async getSessions() { return []; }, async getSessionProcesses() { return []; },
      async sendMessage() { return sentProcess; },
      async fetchConversation(_id, timeout) { observedTimeout = timeout; return [msg('DONE')]; },
      async getExecutionProcess(id) { expect(id).toBe('checkpoint'); return terminalProcess; },
    });
    expect((await adapter.sendMessage('overseer', {} as SendMessageBody)).id).toBe('checkpoint');
    expect(await adapter.getExecutionProcess('checkpoint')).toBe(terminalProcess);
    await adapter.fetchConversation('checkpoint', 100);
    expect(observedTimeout).toBe(100);
  });

  it('keeps checkpoint dry-run state and outbox byte-for-byte unchanged', async () => {
    const { options } = setup(); options.dryRun = true;
    const state = readAutoNudgeState(options.statePath);
    state.outbox.event = { id: 'event', workspaceId: 'w1', content: 'alert', createdAt: iso(1), deliveredAt: null, attempts: 0 };
    writeAutoNudgeState(options.statePath, state);
    const before = readFileSync(options.statePath, 'utf8');
    const complete = proc('complete', 'impl', 'completed', 5);
    const { client, sent } = fake({ processes: { impl: [complete], overseer: [] }, entries: { complete: [msg('Finished')] } });
    expect((await runAutoNudgeCycle(client, options)).checkpoints).toBe(1);
    expect(readFileSync(options.statePath, 'utf8')).toBe(before);
    expect(sent).toEqual([]);
  });

  it('aborts poll delay promptly and releases the owner lock', async () => {
    vi.useFakeTimers();
    const { dir } = setup(); const lock = join(dir, 'owner.lock'); const controller = new AbortController();
    const running = runWithOwnerLock(lock, async () => abortableDelay(300_000, controller.signal));
    expect(existsSync(lock)).toBe(true);
    controller.abort();
    await expect(running).rejects.toThrow('Cancelled');
    expect(existsSync(lock)).toBe(false);
    vi.useRealTimers();
  });
});

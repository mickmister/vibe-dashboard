import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ConversationEntry, ExecutionProcess, SendMessageBody, Session } from '../types.js';
import {
  acquireLock, createAutoNudgeClient, loadAutoNudgeConfig, readAutoNudgeState, runAutoNudgeCycle, writeAutoNudgeState,
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
    async fetchConversation(id) { return input.entries?.[id] ?? []; },
    async sendMessage(id, body) { sent.push({ sessionId: id, body }); return proc(`sent-${sent.length}`, id, 'running', 10); },
    async sendAndWaitForFinalResponse(id, body) { sent.push({ sessionId: id, body }); return { process: proc('checkpoint', id, 'completed', 10), response: input.response ?? 'Continuing' }; },
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

  it('treats newer teammate progress as acknowledgement before checkpointing', async () => {
    const { options } = setup();
    const completed = proc('complete', 'impl', 'completed', 5);
    const newer = proc('reviewed', 'review', 'completed', 7);
    const { client, sent } = fake({ processes: { impl: [completed], review: [newer], overseer: [] }, entries: { complete: [msg('Finished')], reviewed: [msg('Reviewed')] } });
    client.getSessions = async () => [session('overseer', 'overseer'), session('impl', 'impl'), session('review', 'review')];
    await runAutoNudgeCycle(client, options);
    expect(sent).toHaveLength(1);
    const state = readAutoNudgeState(options.statePath);
    expect(state.triggers.complete?.status).toBe('delegated');
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
    client.sendAndWaitForFinalResponse = async () => { throw new Error('response timed out'); };
    await runAutoNudgeCycle(client, options);
    expect(readAutoNudgeState(options.statePath).triggers.complete).toMatchObject({ status: 'retryable-failure', error: 'response timed out' });
  });

  it('bounds concurrent workspace inspection', async () => {
    const { options } = setup();
    options.config.workspaces = ['w1', 'w2', 'w3'].map(workspaceId => ({ workspaceId, overseerSessionId: `overseer-${workspaceId}` }));
    options.concurrency = 2;
    let active = 0; let maximum = 0;
    const client: AutoNudgeClient = {
      async getSessions(workspaceId) { active++; maximum = Math.max(maximum, active); await new Promise(resolve => setTimeout(resolve, 5)); active--; return [session(`overseer-${workspaceId}`, 'overseer')]; },
      async getSessionProcesses() { return []; }, async fetchConversation() { return []; },
      async sendMessage() { throw new Error('unexpected'); }, async sendAndWaitForFinalResponse() { throw new Error('unexpected'); },
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

  it('correlates the real-client adapter to the exact terminal process and supports cancellation', async () => {
    const sentProcess = proc('checkpoint', 'overseer', 'running', 8);
    const terminalProcess = proc('checkpoint', 'overseer', 'completed', 9);
    let observedSignal: AbortSignal | undefined;
    let observedTimeout: number | undefined;
    const adapter = createAutoNudgeClient({
      async getSessions() { return []; }, async getSessionProcesses() { return []; },
      async sendMessage() { return sentProcess; },
      async fetchConversation(_id, timeout, signal) { observedTimeout = timeout; observedSignal = signal; return [msg('DONE')]; },
      async getExecutionProcess(id) { expect(id).toBe('checkpoint'); return terminalProcess; },
    });
    const controller = new AbortController();
    const result = await adapter.sendAndWaitForFinalResponse('overseer', {} as SendMessageBody, 100, controller.signal);
    expect(result).toEqual({ process: terminalProcess, response: 'DONE' });
    expect(observedSignal).toBe(controller.signal);
    expect(observedTimeout).toBe(100);
  });

  it('cancels a controlled real-client response wait during shutdown', async () => {
    const adapter = createAutoNudgeClient({
      async getSessions() { return []; }, async getSessionProcesses() { return []; },
      async sendMessage() { return proc('checkpoint', 'overseer', 'running', 8); },
      async fetchConversation(_id, _timeout, signal) {
        if (signal?.aborted) throw new Error('cancelled');
        return new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
      },
      async getExecutionProcess() { throw new Error('must not reach terminal lookup'); },
    });
    const controller = new AbortController();
    const waiting = adapter.sendAndWaitForFinalResponse('overseer', {} as SendMessageBody, 100, controller.signal);
    controller.abort();
    await expect(waiting).rejects.toThrow('cancelled');
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
});

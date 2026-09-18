import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ConversationEntry, ExecutionProcess, SendMessageBody, Session } from '../types.js';
import {
  loadAutoNudgeConfig, readAutoNudgeState, runAutoNudgeCycle, writeAutoNudgeState,
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

  it('does not nudge while an authoritative callback is running', async () => {
    const { options } = setup();
    writeFileSync(options.callbackRegistryPath, JSON.stringify({ version: 1, callbacks: [{ id: 'cb', sessionId: 'impl', command: 'ci', status: 'running', startedAt: iso(1), timeoutMs: null, finishedAt: null, completionProcessId: null, runnerPid: process.pid, error: null }] }));
    const complete = proc('complete', 'impl', 'completed', 5);
    const { client, sent } = fake({ processes: { impl: [complete], overseer: [] }, entries: { complete: [msg('Waiting')] } });
    await runAutoNudgeCycle(client, options);
    expect(sent).toEqual([]);
    expect(readAutoNudgeState(options.statePath).triggers.complete?.status).toBe('waiting-callback');
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
});

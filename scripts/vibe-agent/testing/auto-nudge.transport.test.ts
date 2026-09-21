import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { VibeClient } from '../core/client.js';
import { createAutoNudgeClient, readAutoNudgeState, runAutoNudgeCycle, writeAutoNudgeState, type AutoNudgeOptions } from '../nudge/auto-nudge.js';
import { createCallback } from '../nudge/callback-registry.js';
import { FakeDiscordServer } from './fake-discord-server.js';
import { FakeVkServer, type FakeVkProcess, type FakeVkScenario } from './fake-vk-server.js';

const now = '2026-09-21T00:10:00.000Z'; const old = '2026-09-21T00:00:00.000Z';
const process = (id: string, sessionId: string, status: string, final?: string): FakeVkProcess => ({
  id, session_id: sessionId, status, created_at: old, updated_at: old, completed_at: status === 'running' ? null : old,
  run_reason: 'codingagent', dropped: false,
  conversation: final == null ? [{ content: { entry_type: { type: 'tool_use' }, content: 'work' } }] : [{ content: { entry_type: { type: 'assistant_message' }, content: final } }],
});
function base(processes: FakeVkProcess[]): FakeVkScenario { return {
  workspaces: [{ id: 'workspace' }], sessions: [
    { id: 'impl', workspace_id: 'workspace', name: 'impl', executor: 'CODEX', created_at: old, updated_at: old, processes },
    { id: 'overseer', workspace_id: 'workspace', name: 'overseer', executor: 'CODEX', created_at: old, updated_at: old, processes: [] },
  ], followUps: [],
}; }
const dirs: string[] = []; const vkServers: FakeVkServer[] = []; const discordServers: FakeDiscordServer[] = [];
afterEach(async () => { dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })); await Promise.all(vkServers.splice(0).map(item => item.stop())); await Promise.all(discordServers.splice(0).map(item => item.stop())); });
async function setup(scenario: FakeVkScenario) {
  const server = await new FakeVkServer(scenario).start(); vkServers.push(server);
  const dir = mkdtempSync(join(tmpdir(), 'auto-nudge-transport-')); dirs.push(dir);
  const options: AutoNudgeOptions = { config: { version: 1, discord: { enabled: false }, workspaces: [{ workspaceId: 'workspace', overseerSessionId: 'overseer' }] }, statePath: join(dir, 'state.json'), callbackRegistryPath: join(dir, 'callbacks.json'), now: () => new Date(now), unacknowledgedAfterMs: 60_000, operationTimeoutMs: 500, responseTimeoutMs: 1_000, checkpointPollMs: 5, concurrency: 2, dryRun: false };
  return { server, options, client: createAutoNudgeClient(new VibeClient(server.baseUrl)) };
}

describe('auto-nudge across real VK transport', () => {
  it('sends one continuation for a terminal teammate turn across repeated cycles', async () => {
    const scenario = base([process('failed', 'impl', 'failed')]); scenario.followUps = [{ sessionId: 'impl', process: process('continued', 'impl', 'running') }];
    const { server, options, client } = await setup(scenario);
    await runAutoNudgeCycle(client, options); await runAutoNudgeCycle(client, options);
    expect(server.journal.filter(item => item.type === 'follow-up-accepted')).toHaveLength(1);
    expect(readAutoNudgeState(options.statePath).nudgedProcessIds).toEqual(['failed']);
  });

  it('suppresses action while work is active', async () => {
    const { server, options, client } = await setup(base([process('active', 'impl', 'running')]));
    await runAutoNudgeCycle(client, options);
    expect(server.journal.filter(item => item.type === 'follow-up-accepted')).toHaveLength(0);
  });

  it('checkpoints and closes the trigger on exact DONE', async () => {
    const scenario = base([process('complete', 'impl', 'completed', 'Finished')]);
    const checkpoint = process('checkpoint', 'overseer', 'running', 'DONE'); checkpoint.statusSequence = ['completed'];
    scenario.followUps = [{ sessionId: 'overseer', process: checkpoint }];
    const { options, client } = await setup(scenario);
    await runAutoNudgeCycle(client, options);
    expect(readAutoNudgeState(options.statePath).triggers.complete).toMatchObject({ status: 'done', checkpointProcessId: 'checkpoint' });
  });

  it('restarts from persisted checkpoint identity without another follow-up', async () => {
    const scenario = base([process('complete', 'impl', 'completed', 'Finished')]);
    const checkpoint = process('checkpoint', 'overseer', 'completed', 'DONE'); scenario.sessions[1].processes.push(checkpoint);
    const { server, options, client } = await setup(scenario);
    const state = readAutoNudgeState(options.statePath); state.triggers.complete = { processId: 'complete', workspaceId: 'workspace', sessionId: 'impl', observedAt: old, status: 'checkpoint-sent', checkpointProcessId: 'checkpoint', baselineProcessIds: ['complete'], updatedAt: old, error: null }; writeAutoNudgeState(options.statePath, state);
    await runAutoNudgeCycle(client, options);
    expect(server.journal.filter(item => item.type === 'follow-up-accepted')).toHaveLength(0);
    expect(readAutoNudgeState(options.statePath).triggers.complete.status).toBe('done');
  });

  it('suppresses checkpointing while a correlated callback is running', async () => {
    const { server, options, client } = await setup(base([process('complete', 'impl', 'completed', 'Finished')]));
    createCallback(options.callbackRegistryPath, { id: 'callback', sessionId: 'impl', command: 'ci', startedAt: now, sourceProcessId: 'complete', triggerProcessId: 'complete' });
    await runAutoNudgeCycle(client, options);
    expect(server.journal.filter(item => item.type === 'follow-up-accepted')).toHaveLength(0);
    expect(readAutoNudgeState(options.statePath).triggers.complete.status).toBe('waiting-callback');
  });

  it('retries a durable Discord delivery after restart without losing the event', async () => {
    const discord = await new FakeDiscordServer(1).start(); discordServers.push(discord);
    const { options, client } = await setup(base([])); options.config.discord = { enabled: true }; options.discordWebhookUrl = discord.url;
    const state = readAutoNudgeState(options.statePath); state.outbox.alert = { id: 'alert', workspaceId: 'workspace', content: 'quota event', createdAt: old, deliveredAt: null, attempts: 0 }; writeAutoNudgeState(options.statePath, state);
    expect((await runAutoNudgeCycle(client, options)).errors).toHaveLength(1);
    expect((await runAutoNudgeCycle(client, options)).discordDeliveries).toBe(1);
    expect(discord.deliveries).toEqual([{ content: 'quota event' }, { content: 'quota event' }]);
    expect(readAutoNudgeState(options.statePath).outbox.alert).toMatchObject({ attempts: 2, deliveredAt: now });
  });
});

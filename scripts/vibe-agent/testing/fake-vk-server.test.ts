import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { VibeClient } from '../core/client.js';
import type { SendMessageBody } from '../types.js';
import { FakeVkServer, type FakeVkProcess, type FakeVkScenario } from './fake-vk-server.js';

const now = '2026-09-21T00:00:00.000Z';
const process = (id: string, sessionId = 'impl', status = 'completed'): FakeVkProcess => ({
  id, session_id: sessionId, status, created_at: now, updated_at: now,
  completed_at: status === 'running' ? null : now, run_reason: 'codingagent', dropped: false,
  conversation: [{ content: { entry_type: { type: 'assistant_message' }, content: 'DONE' } }],
});
const scenario = (): FakeVkScenario => ({
  workspaces: [{ id: 'workspace' }],
  sessions: [
    { id: 'impl', workspace_id: 'workspace', name: 'impl', executor: 'CODEX', created_at: now, updated_at: now, processes: [process('turn')] },
    { id: 'overseer', workspace_id: 'workspace', name: 'overseer', executor: 'CODEX', created_at: now, updated_at: now, processes: [] },
  ],
  followUps: [{ sessionId: 'overseer', process: process('checkpoint', 'overseer', 'running') }],
});
const body: SendMessageBody = { prompt: 'checkpoint', executor_config: { executor: 'CODEX' }, retry_process_id: null, force_when_dirty: null, perform_git_reset: null };
const servers: FakeVkServer[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(server => server.stop())); });
async function start(value = scenario()) { const server = await new FakeVkServer(value).start(); servers.push(server); return { server, client: new VibeClient(server.baseUrl) }; }

describe('real VibeClient against fake VK transport', () => {
  it('uses exact REST contracts and records accepted follow-up correlation', async () => {
    const { server, client } = await start();
    expect(await client.getAllWorkspaces()).toEqual([{ id: 'workspace' }]);
    expect((await client.getSessions('workspace')).map(item => item.id)).toEqual(['impl', 'overseer']);
    expect((await client.sendMessage('overseer', body)).id).toBe('checkpoint');
    expect((await client.getExecutionProcess('checkpoint')).status).toBe('running');
    expect(server.journal.find(item => item.type === 'follow-up-validated')).toMatchObject({
      method: 'POST', path: '/api/sessions/overseer/follow-up',
      metadata: {
        sessionId: 'overseer', contentType: 'application/json',
        bodySha256: createHash('sha256').update(JSON.stringify(body)).digest('hex'),
        promptLength: body.prompt.length, executor: 'CODEX',
      },
    });
    const accepted = server.journal.find(item => item.type === 'follow-up-accepted')!;
    expect(accepted.correlationId).toBe('checkpoint');
    expect(server.journal.map(item => item.sequence)).toEqual(server.journal.map((_item, index) => index + 1));
  });

  it('streams process snapshots and normalized logs over real WebSockets', async () => {
    const { client } = await start();
    expect((await client.getSessionProcesses('impl')).map(item => item.id)).toEqual(['turn']);
    const entries = await client.fetchConversation('turn', 1_000);
    expect(entries[0]).toMatchObject({ content: { content: 'DONE' } });
  });

  it('distinguishes server acceptance from a dropped follow-up response', async () => {
    const value = scenario(); value.faults = [{ id: 'drop', operation: 'follow-up', targetId: 'overseer', kind: 'drop-after-accept' }];
    const { server, client } = await start(value);
    await expect(client.sendMessage('overseer', body)).rejects.toThrow();
    expect(server.journal.map(item => item.type)).toContain('follow-up-accepted');
    expect(server.journal.map(item => item.type)).toContain('response-dropped');
    expect((await client.getExecutionProcess('checkpoint')).id).toBe('checkpoint');
    server.assertAllDeclarationsUsed();
  });

  it('covers missing, rejected and never-completing REST operations', async () => {
    const value = scenario(); value.faults = [
      { id: 'missing', operation: 'process-get', targetId: 'missing', kind: 'missing' },
      { id: 'reject', operation: 'process-get', targetId: 'rejected', kind: 'reject' },
      { id: 'never', operation: 'process-get', targetId: 'never', kind: 'never-complete' },
    ];
    const { server, client } = await start(value);
    await expect(client.getExecutionProcess('missing')).rejects.toThrow(/Not found/);
    await expect(client.getExecutionProcess('rejected')).rejects.toThrow(/HTTP 503/);
    const controller = new AbortController(); const pending = fetch(`${server.baseUrl}/api/execution-processes/never`, { signal: controller.signal });
    await new Promise(resolve => setTimeout(resolve, 10)); controller.abort();
    await expect(pending).rejects.toThrow(); server.assertAllDeclarationsUsed();
  });

  it('fails safely for malformed log data and closes before Ready', async () => {
    for (const kind of ['malformed-json', 'invalid-patch', 'ws-close'] as const) {
      const value = scenario(); value.faults = [{ id: kind, operation: 'logs-ws', targetId: 'turn', kind }];
      const { server, client } = await start(value);
      await expect(client.fetchConversation('turn', 100)).rejects.toThrow();
      server.assertAllDeclarationsUsed();
      servers.splice(servers.indexOf(server), 1); await server.stop();
    }
  });

  it('supports deterministic barriers and delay/disconnect faults', async () => {
    const value = scenario(); value.barriers = [{ id: 'poll-gate', operation: 'process-get', targetId: 'turn' }];
    value.faults = [{ id: 'delay', operation: 'process-get', targetId: 'turn', kind: 'delay', delayMs: 5 }];
    const { server, client } = await start(value); const waiting = client.getExecutionProcess('turn');
    await new Promise(resolve => setTimeout(resolve, 5)); server.releaseBarrier('poll-gate');
    await expect(waiting).resolves.toMatchObject({ id: 'turn' }); server.assertAllDeclarationsUsed();
    const disconnected = scenario(); disconnected.faults = [{ id: 'disconnect', operation: 'process-get', targetId: 'turn', kind: 'disconnect' }];
    const next = await start(disconnected); await expect(next.client.getExecutionProcess('turn')).rejects.toThrow(); next.server.assertAllDeclarationsUsed();
  });

  it('rejects invalid and unused scenario declarations', async () => {
    const duplicate = scenario(); duplicate.faults = [{ id: 'same', operation: 'logs-ws', kind: 'ws-close' }, { id: 'same', operation: 'logs-ws', kind: 'ws-close' }];
    expect(() => new FakeVkServer(duplicate)).toThrow(/duplicate fault id/);
    const value = scenario(); value.faults = [{ id: 'unused', operation: 'logs-ws', kind: 'ws-close' }];
    const { server } = await start(value); expect(() => server.assertAllDeclarationsUsed()).toThrow(/unused/);
  });
});

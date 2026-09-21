import { expect, test } from 'playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VibeClient } from '../../../../scripts/vibe-agent/core/client.js';
import { createAutoNudgeClient, readAutoNudgeState, runAutoNudgeCycle, writeAutoNudgeState, type AutoNudgeOptions } from '../../../../scripts/vibe-agent/nudge/auto-nudge.js';
import { createCallback } from '../../../../scripts/vibe-agent/nudge/callback-registry.js';
import type { ExecutionProcess, SendMessageBody, Session } from '../../../../scripts/vibe-agent/types.js';

const sandboxUrl = process.env.VK_MOCKED_SANDBOX_URL ?? 'http://localhost:50005';
const client = new VibeClient(sandboxUrl);
const body = (prompt: string, session: Session): SendMessageBody => ({ prompt, executor_config: { executor: session.executor }, retry_process_id: null, force_when_dirty: null, perform_git_reset: null });
async function terminal(processId: string): Promise<ExecutionProcess> {
  for (let attempt = 0; attempt < 80; attempt++) {
    const process = await client.getExecutionProcess(processId); if (process.status !== 'running') return process;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`QA process ${processId} did not become terminal`);
}
async function context() {
  const workspace = (await client.getAllWorkspaces()).find(item => item.name === 'Basic Seeded VK Craft') ?? (await client.getAllWorkspaces())[0];
  if (!workspace) throw new Error('QA sandbox has no seeded workspace');
  const existing = (await client.getSessions(workspace.id))[0]; if (!existing) throw new Error('QA workspace has no seeded session');
  const overseer = await client.createSession({ workspace_id: workspace.id, executor: 'CODEX', name: `auto-nudge-overseer-${Date.now()}` });
  const dir = await mkdtemp(join(tmpdir(), 'auto-nudge-qa-'));
  const options: AutoNudgeOptions = { config: { version: 1, workspaces: [{ workspaceId: workspace.id, overseerSessionId: overseer.id }] }, statePath: join(dir, 'state.json'), callbackRegistryPath: join(dir, 'callbacks.json'), now: () => new Date(), unacknowledgedAfterMs: 0, operationTimeoutMs: 5_000, responseTimeoutMs: 30_000, checkpointPollMs: 100, concurrency: 2, dryRun: false };
  return { workspace, teammate: existing, overseer, dir, options };
}

test.describe.serial('auto-nudge compatibility with real VK QA-mode contracts', () => {
  test('active QA work is visible through the real snapshot stream and suppresses monitor action', async () => {
    test.setTimeout(60_000); const value = await context();
    try {
      const active = await client.sendMessage(value.teammate.id, body(`auto-nudge active guard ${Date.now()}`, value.teammate));
      expect((await client.getSessionProcesses(value.teammate.id)).some(item => item.id === active.id && item.status === 'running')).toBe(true);
      const result = await runAutoNudgeCycle(createAutoNudgeClient(client), value.options);
      expect(result.teammateNudges + result.checkpoints).toBe(0);
      expect(await client.getSessionProcesses(value.overseer.id)).toHaveLength(0);
      await terminal(active.id);
    } finally { await rm(value.dir, { recursive: true, force: true }); }
  });

  test('persisted checkpoint restart reconciles an exact real QA process without resending', async () => {
    test.setTimeout(60_000); const value = await context();
    try {
      const checkpoint = await client.sendMessage(value.overseer.id, body(`auto-nudge restart reconciliation ${Date.now()}`, value.overseer)); await terminal(checkpoint.id);
      const state = readAutoNudgeState(value.options.statePath); state.triggers[checkpoint.id] = { processId: checkpoint.id, workspaceId: value.workspace.id, sessionId: value.teammate.id, observedAt: checkpoint.created_at, status: 'checkpoint-sent', checkpointProcessId: checkpoint.id, baselineProcessIds: [], updatedAt: checkpoint.updated_at, error: null }; writeAutoNudgeState(value.options.statePath, state);
      const before = (await client.getSessionProcesses(value.overseer.id)).length;
      await runAutoNudgeCycle(createAutoNudgeClient(client), value.options);
      expect((await client.getSessionProcesses(value.overseer.id)).length).toBe(before);
      expect(readAutoNudgeState(value.options.statePath).triggers[checkpoint.id]?.checkpointProcessId).toBeNull();
    } finally { await rm(value.dir, { recursive: true, force: true }); }
  });

  test('a correlated durable callback suppresses checkpointing against real VK session/process contracts', async () => {
    test.setTimeout(60_000); const value = await context();
    try {
      const source = await client.sendMessage(value.teammate.id, body(`auto-nudge callback source ${Date.now()}`, value.teammate)); await terminal(source.id);
      createCallback(value.options.callbackRegistryPath, { id: 'qa-callback', sessionId: value.teammate.id, command: 'qa', startedAt: new Date().toISOString(), sourceProcessId: source.id, triggerProcessId: source.id });
      const result = await runAutoNudgeCycle(createAutoNudgeClient(client), value.options);
      expect(result.checkpoints).toBe(0); expect(await client.getSessionProcesses(value.overseer.id)).toHaveLength(0);
      expect(readAutoNudgeState(value.options.statePath).triggers[source.id]?.status).toBe('waiting-callback');
    } finally { await rm(value.dir, { recursive: true, force: true }); }
  });
});

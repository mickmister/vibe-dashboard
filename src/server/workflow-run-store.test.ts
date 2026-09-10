import { afterEach, describe, expect, it } from 'vitest';
import { createWorkflowRegistry, runWorkflow } from '@vibe-dashboard/workflow-core';
import { initVdDb, type VdDbHandle } from './database';
import { DbWorkflowRunRecorder } from './workflow-run-recorder';
import { DbWorkflowRunReader } from './workflow-run-store';

const handles: VdDbHandle[] = [];

afterEach(async () => {
  for (const handle of handles.splice(0)) {
    await handle.db.destroy();
    handle.sqlite.close();
  }
});

async function createSeededReader() {
  const handle = await initVdDb({ path: ':memory:' });
  handles.push(handle);
  const recorder = new DbWorkflowRunRecorder({ db: handle.db });
  const reader = new DbWorkflowRunReader({ db: handle.db });
  const registry = createWorkflowRegistry();
  registry.register({
    id: 'alpha',
    trigger: 'manual',
    run: (ctx, input) => {
      const typed = input as { queueItemId?: string; workspaceId?: string; fail?: boolean };
      ctx.log('alpha_step', 'alpha log', 'info', { token: 'ghp_do-not-store', queueItemId: typed.queueItemId });
      if (typed.fail) throw new Error('alpha failed');
      return {
        outcome: 'message_queued',
        workspaceId: typed.workspaceId ?? 'ws-a',
        sessionId: 'session-a',
        queueItemId: typed.queueItemId ?? 'queue-a',
      };
    },
  });
  registry.register({
    id: 'beta',
    trigger: 'github.workflow_run',
    run: () => ({ outcome: 'ignored' }),
  });

  await runWorkflow(registry, 'alpha', { queueItemId: 'queue-1', workspaceId: 'ws-1' }, {
    createRunId: () => 'run_1',
    now: (() => { let t = 100; return () => t++; })(),
    recorder,
  });
  await runWorkflow(registry, 'beta', {}, {
    createRunId: () => 'run_2',
    now: (() => { let t = 200; return () => t++; })(),
    recorder,
  });
  await runWorkflow(registry, 'alpha', { fail: true, queueItemId: 'queue-3', workspaceId: 'ws-3' }, {
    createRunId: () => 'run_3',
    now: (() => { let t = 300; return () => t++; })(),
    recorder,
  });

  return { reader };
}

describe('DbWorkflowRunReader', () => {
  it('lists runs newest first with pagination metadata', async () => {
    const { reader } = await createSeededReader();

    const firstPage = await reader.listRuns({ limit: 2 });
    expect(firstPage.runs.map((run) => run.runId)).toEqual(['run_3', 'run_2']);
    expect(firstPage).toMatchObject({ limit: 2, offset: 0, hasMore: true });

    const secondPage = await reader.listRuns({ limit: 2, offset: 2 });
    expect(secondPage.runs.map((run) => run.runId)).toEqual(['run_1']);
    expect(secondPage.hasMore).toBe(false);
  });

  it('filters by workflow status and VK references', async () => {
    const { reader } = await createSeededReader();

    await expect(reader.listRuns({ workflowId: 'alpha' })).resolves.toMatchObject({
      runs: [{ runId: 'run_3' }, { runId: 'run_1' }],
    });
    await expect(reader.listRuns({ status: 'failed' })).resolves.toMatchObject({
      runs: [{ runId: 'run_3' }],
    });
    await expect(reader.listRuns({ vkWorkspaceId: 'ws-1', vkQueueItemId: 'queue-1' })).resolves.toMatchObject({
      runs: [{ runId: 'run_1' }],
    });
  });

  it('gets runs and events with parsed redacted JSON', async () => {
    const { reader } = await createSeededReader();

    const run = await reader.getRun('run_1');
    expect(run).toMatchObject({
      runId: 'run_1',
      input: { queueItemId: 'queue-1', workspaceId: 'ws-1' },
      output: { queueItemId: 'queue-1' },
      vkQueueItemId: 'queue-1',
    });

    const events = await reader.listRunEvents('run_1', { limit: 2 });
    expect(events).toMatchObject({ limit: 2, offset: 0, hasMore: true });
    expect(events?.events.map((event) => event.eventType)).toEqual(['run_started', 'step_log']);
    expect(events?.events[1]?.data).toEqual({ token: '[REDACTED]', queueItemId: 'queue-1' });
  });

  it('returns null for missing runs and missing run events', async () => {
    const { reader } = await createSeededReader();

    await expect(reader.getRun('missing')).resolves.toBeNull();
    await expect(reader.listRunEvents('missing')).resolves.toBeNull();
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { createWorkflowRegistry, runWorkflow } from '@vibe-dashboard/workflow-core';
import { initVdDb, type VdDbHandle } from './database';
import {
  buildPersistedEvents,
  DbWorkflowRunRecorder,
  redactSecrets,
} from './workflow-run-recorder';

const handles: VdDbHandle[] = [];

afterEach(async () => {
  for (const handle of handles.splice(0)) {
    await handle.db.destroy();
    handle.sqlite.close();
  }
});

async function createHandle(): Promise<VdDbHandle> {
  const handle = await initVdDb({ path: ':memory:' });
  handles.push(handle);
  return handle;
}

describe('DbWorkflowRunRecorder', () => {
  it('persists successful workflow runs with bounded lifecycle and step events', async () => {
    const handle = await createHandle();
    const registry = createWorkflowRegistry();
    registry.register({
      id: 'ok',
      trigger: 'manual',
      run: (ctx, input) => {
        ctx.log('step_1', 'queued message', 'info', { queueItemId: 'queue-123' });
        return { outcome: 'message_queued', workspaceId: 'ws-1', sessionId: 'session-1', queueItemId: 'queue-123', echo: input };
      },
    });

    await runWorkflow(registry, 'ok', { value: 'hello' }, {
      createRunId: () => 'run_ok',
      now: (() => {
        let time = 100;
        return () => time++;
      })(),
      recorder: new DbWorkflowRunRecorder({ db: handle.db }),
    });

    const run = await handle.db.selectFrom('WorkflowRun').selectAll().where('runId', '=', 'run_ok').executeTakeFirstOrThrow();
    expect(run).toMatchObject({
      runId: 'run_ok',
      workflowId: 'ok',
      trigger: 'manual',
      status: 'completed',
      startedAt: 100,
      completedAt: 102,
      durationMs: 2,
      vkWorkspaceId: 'ws-1',
      vkSessionId: 'session-1',
      vkQueueItemId: 'queue-123',
      vkExecutionProcessId: null,
    });
    expect(JSON.parse(run.inputJson)).toEqual({ value: 'hello' });
    expect(JSON.parse(run.outputJson ?? '{}')).toMatchObject({ queueItemId: 'queue-123' });

    const events = await handle.db.selectFrom('WorkflowRunEvent').selectAll().where('runId', '=', 'run_ok').orderBy('eventIndex').execute();
    expect(events.map((event) => event.eventType)).toEqual(['run_started', 'step_log', 'run_completed']);
    expect(events[1]).toMatchObject({ stepId: 'step_1', message: 'queued message' });
  });

  it('persists failed workflow runs with redacted input and error metadata', async () => {
    const handle = await createHandle();
    const registry = createWorkflowRegistry();
    registry.register({
      id: 'fail',
      trigger: 'manual',
      run: (ctx) => {
        ctx.log('before_fail', 'will fail', 'warn', { authorization: 'Bearer should-not-store' });
        throw new Error('boom');
      },
    });

    await runWorkflow(registry, 'fail', { githubToken: 'ghp_shouldnotstore', nested: { signature: 'sha256=abcdef1234567890' } }, {
      createRunId: () => 'run_fail',
      now: (() => {
        let time = 200;
        return () => time++;
      })(),
      recorder: new DbWorkflowRunRecorder({ db: handle.db }),
    });

    const run = await handle.db.selectFrom('WorkflowRun').selectAll().where('runId', '=', 'run_fail').executeTakeFirstOrThrow();
    expect(run.status).toBe('failed');
    expect(JSON.parse(run.inputJson)).toEqual({ githubToken: '[REDACTED]', nested: { signature: '[REDACTED]' } });
    expect(JSON.parse(run.errorJson ?? '{}')).toMatchObject({ name: 'Error', message: 'boom' });

    const stepEvent = await handle.db.selectFrom('WorkflowRunEvent').selectAll().where('runId', '=', 'run_fail').where('eventType', '=', 'step_log').executeTakeFirstOrThrow();
    expect(JSON.parse(stepEvent.dataJson ?? '{}')).toEqual({ authorization: '[REDACTED]' });
  });

  it('persists GitHub CI queued item references from workflow output', async () => {
    const handle = await createHandle();
    const registry = createWorkflowRegistry();
    registry.register({
      id: 'github-ci-failure',
      trigger: 'github.workflow_run',
      run: (ctx) => {
        ctx.log('queue_follow_up', 'Queued CI failure prompt', 'info', { queueItemId: 'queue-ci-1' });
        return {
          outcome: 'message_queued',
          workspaceId: 'ws-ci',
          sessionId: 'session-ci',
          queueItemId: 'queue-ci-1',
          queuedCount: 3,
          repoFullName: 'owner/repo',
          branch: 'main',
        };
      },
    });

    await runWorkflow(registry, 'github-ci-failure', { event: 'workflow_run', payload: { token: 'secret-token' } }, {
      createRunId: () => 'run_ci',
      recorder: new DbWorkflowRunRecorder({ db: handle.db }),
      now: (() => {
        let time = 300;
        return () => time++;
      })(),
    });

    const run = await handle.db.selectFrom('WorkflowRun').selectAll().where('runId', '=', 'run_ci').executeTakeFirstOrThrow();
    expect(run).toMatchObject({ vkWorkspaceId: 'ws-ci', vkSessionId: 'session-ci', vkQueueItemId: 'queue-ci-1' });
  });

  it('caps persisted events and includes a truncation marker', () => {
    const run = {
      runId: 'run_many',
      workflowId: 'many',
      trigger: 'manual',
      status: 'completed' as const,
      input: {},
      output: {},
      logs: Array.from({ length: 10 }, (_, index) => ({
        stepId: `step_${index}`,
        level: 'info' as const,
        message: `event ${index}`,
        timestamp: index + 1,
      })),
      startedAt: 0,
      completedAt: 20,
      durationMs: 20,
    };

    const events = buildPersistedEvents(run, 5);
    expect(events).toHaveLength(5);
    expect(events.map((event) => event.eventType)).toEqual(['run_started', 'step_log', 'step_log', 'truncated', 'run_completed']);
    expect(events[3]).toMatchObject({ eventType: 'truncated', data: { eventCap: 5, omittedEvents: 8 } });
  });

  it('redacts obvious token and signature fields recursively', () => {
    expect(redactSecrets({ token: 'abc', nested: [{ xHubSignature256: 'sha256=abcdef1234567890' }], value: 'safe' })).toEqual({
      token: '[REDACTED]',
      nested: [{ xHubSignature256: '[REDACTED]' }],
      value: 'safe',
    });
  });
});

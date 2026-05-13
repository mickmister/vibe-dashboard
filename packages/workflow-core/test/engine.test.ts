import { describe, expect, it } from 'vitest';
import {
  createWorkflowRegistry,
  runWorkflow,
  WorkflowNotFoundError,
  type WorkflowDefinition,
  type WorkflowRecorder,
} from '../src/index';

describe('workflow-core engine', () => {
  it('registers and runs a workflow with lifecycle metadata and logs', async () => {
    const registry = createWorkflowRegistry();
    const events: string[] = [];
    const recorder: WorkflowRecorder = {
      onRunStarted: async (run) => {
        events.push(`start:${run.workflowId}:${run.status}`);
      },
      onRunCompleted: async (run) => {
        events.push(`complete:${run.workflowId}:${run.status}`);
      },
    };

    const workflow: WorkflowDefinition<{ name: string }, { greeting: string }> = {
      id: 'hello',
      trigger: 'manual',
      run: async (ctx, input) => {
        ctx.log('compose', `Greeting ${input.name}`);
        return { greeting: `Hello ${input.name}` };
      },
    };

    registry.register(workflow);

    const result = await runWorkflow(registry, 'hello', { name: 'Ada' }, {
      recorder,
      now: (() => {
        let value = 1000;
        return () => value++;
      })(),
      createRunId: () => 'run_1',
    });

    expect(result).toMatchObject({
      runId: 'run_1',
      workflowId: 'hello',
      trigger: 'manual',
      status: 'completed',
      input: { name: 'Ada' },
      output: { greeting: 'Hello Ada' },
      startedAt: 1000,
      completedAt: 1002,
      durationMs: 2,
    });
    expect(result.logs).toEqual([
      { stepId: 'compose', level: 'info', message: 'Greeting Ada', timestamp: 1001 },
    ]);
    expect(events).toEqual(['start:hello:running', 'complete:hello:completed']);
  });

  it('normalizes workflow failures and records failed runs', async () => {
    const registry = createWorkflowRegistry();
    const completedStatuses: string[] = [];
    registry.register({
      id: 'explode',
      trigger: 'manual',
      run: async (ctx) => {
        ctx.log('explode', 'about to throw', 'warn');
        throw new TypeError('boom');
      },
    });

    const result = await runWorkflow(registry, 'explode', {}, {
      now: (() => {
        let value = 2000;
        return () => value++;
      })(),
      createRunId: () => 'run_failed',
      recorder: {
        onRunCompleted: async (run) => {
          completedStatuses.push(run.status);
        },
      },
    });

    expect(result.status).toBe('failed');
    expect(result.error).toMatchObject({
      name: 'TypeError',
      message: 'boom',
    });
    expect(result.output).toBeUndefined();
    expect(result.logs).toEqual([
      { stepId: 'explode', level: 'warn', message: 'about to throw', timestamp: 2001 },
    ]);
    expect(completedStatuses).toEqual(['failed']);
  });

  it('throws a typed error before starting a run when workflow is missing', async () => {
    const registry = createWorkflowRegistry();

    await expect(runWorkflow(registry, 'missing', {})).rejects.toBeInstanceOf(
      WorkflowNotFoundError,
    );
  });

  it('rejects duplicate workflow registrations', () => {
    const registry = createWorkflowRegistry();
    const workflow = {
      id: 'same',
      trigger: 'manual',
      run: async () => ({ ok: true }),
    } satisfies WorkflowDefinition<unknown, { ok: boolean }>;

    registry.register(workflow);

    expect(() => registry.register(workflow)).toThrow(
      /already registered/i,
    );
  });
});

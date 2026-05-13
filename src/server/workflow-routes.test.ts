import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { createWorkflowRegistry, type WorkflowDefinition } from '@vibe-kanban/workflow-core';
import { registerWorkflowRoutes } from './workflow-routes';

describe('registerWorkflowRoutes', () => {
  it('returns health and registered workflows', async () => {
    const registry = createWorkflowRegistry();
    registry.register({
      id: 'example',
      trigger: 'manual',
      run: async () => ({ ok: true }),
    });
    const app = new Hono();
    registerWorkflowRoutes(app, { registry });

    await expectJson(app, '/dashboard/api/workflows/health', 200, { ok: true });
    await expectJson(app, '/dashboard/api/workflows', 200, {
      workflows: [{ id: 'example', trigger: 'manual' }],
    });
  });

  it('runs workflows by id and returns the workflow run record', async () => {
    const registry = createWorkflowRegistry();
    const workflow = {
      id: 'echo',
      trigger: 'manual',
      run: async (ctx, input) => {
        ctx.log('echo', 'echoing input');
        return input;
      },
    } satisfies WorkflowDefinition<{ value: string }, { value: string }>;
    registry.register(workflow);
    const app = new Hono();
    registerWorkflowRoutes(app, {
      registry,
      runOptions: {
        createRunId: () => 'run_route',
        now: (() => {
          let value = 10;
          return () => value++;
        })(),
      },
    });

    const response = await app.request('/dashboard/api/workflows/echo/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 'hello' }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      run: {
        runId: 'run_route',
        workflowId: 'echo',
        status: 'completed',
        input: { value: 'hello' },
        output: { value: 'hello' },
      },
    });
  });



  it('runs the GitHub CI failure workflow from the GitHub webhook route', async () => {
    const registry = createWorkflowRegistry();
    registry.register({
      id: 'github-ci-failure',
      trigger: 'github.workflow_run',
      run: async (_ctx, input) => input,
    });
    const app = new Hono();
    registerWorkflowRoutes(app, {
      registry,
      runOptions: {
        createRunId: () => 'run_webhook',
        now: () => 50,
      },
    });

    const response = await app.request('/dashboard/api/webhooks/github', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Event': 'workflow_run',
      },
      body: JSON.stringify({ workflow_run: { conclusion: 'failure' } }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      run: {
        runId: 'run_webhook',
        workflowId: 'github-ci-failure',
        status: 'completed',
        input: {
          event: 'workflow_run',
          payload: { workflow_run: { conclusion: 'failure' } },
        },
      },
    });
  });

  it('returns 404 for unknown workflows and 500 for failed workflows', async () => {
    const registry = createWorkflowRegistry();
    registry.register({
      id: 'fail',
      trigger: 'manual',
      run: async () => {
        throw new Error('workflow exploded');
      },
    });
    const app = new Hono();
    registerWorkflowRoutes(app, { registry });

    const missing = await app.request('/dashboard/api/workflows/missing/run', { method: 'POST' });
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toMatchObject({ error: 'Workflow not found: missing' });

    const failed = await app.request('/dashboard/api/workflows/fail/run', { method: 'POST' });
    expect(failed.status).toBe(500);
    await expect(failed.json()).resolves.toMatchObject({
      run: {
        workflowId: 'fail',
        status: 'failed',
        error: { message: 'workflow exploded' },
      },
    });
  });
});

async function expectJson(
  app: Hono,
  path: string,
  status: number,
  expected: unknown,
): Promise<void> {
  const response = await app.request(path);
  expect(response.status).toBe(status);
  await expect(response.json()).resolves.toEqual(expected);
}

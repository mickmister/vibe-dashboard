import { createHmac } from 'node:crypto';
import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWorkflowRegistry, type WorkflowDefinition } from '@vibe-dashboard/workflow-core';
import { registerWorkflowRoutes } from './workflow-routes';

describe('registerWorkflowRoutes', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

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
      githubWebhookSecret: 'secret',
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
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const registry = createWorkflowRegistry();
    registry.register({
      id: 'github-ci-failure',
      trigger: 'github.workflow_run',
      run: async (_ctx, input) => ({ outcome: 'message_sent', input }),
    });
    const app = new Hono();
    registerWorkflowRoutes(app, {
      registry,
      githubWebhookSecret: 'secret',
      repoAliasCache: {
        get: () => [{ name: 'local-repo', aliases: ['owner/repo'] }],
        set: () => {},
      },
      runOptions: {
        createRunId: () => 'run_webhook',
        now: () => 50,
      },
    });

    const body = JSON.stringify({ workflow_run: { conclusion: 'failure' } });
    const response = await app.request('/dashboard/api/webhooks/github', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Event': 'workflow_run',
        'X-GitHub-Delivery': 'delivery-123',
        'X-Hub-Signature-256': signBody(body, 'secret'),
      },
      body,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      outcome: 'message_sent',
      run: {
        runId: 'run_webhook',
        workflowId: 'github-ci-failure',
        status: 'completed',
        output: {
          outcome: 'message_sent',
          input: {
            event: 'workflow_run',
            payload: { workflow_run: { conclusion: 'failure' } },
            repoAliases: [{ name: 'local-repo', aliases: ['owner/repo'] }],
          },
        },
      },
    });
    expect(infoSpy).toHaveBeenCalledWith('GitHub webhook received', {
      delivery: 'delivery-123',
      event: 'workflow_run',
      action: undefined,
      workflowRunStatus: undefined,
      workflowRunConclusion: 'failure',
      workflowRunHtmlUrl: undefined,
    });
    expect(infoSpy).toHaveBeenCalledWith('GitHub webhook workflow completed', {
      delivery: 'delivery-123',
      event: 'workflow_run',
      outcome: 'message_sent',
      status: 'completed',
      runId: 'run_webhook',
    });
  });



  it('enforces GitHub webhook signatures before running workflows', async () => {
    const registry = createWorkflowRegistry();
    registry.register({
      id: 'github-ci-failure',
      trigger: 'github.workflow_run',
      run: async () => ({ outcome: 'should_not_run' }),
    });
    const app = new Hono();
    registerWorkflowRoutes(app, { registry, githubWebhookSecret: 'secret' });

    const missing = await app.request('/dashboard/api/webhooks/github', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-GitHub-Event': 'workflow_run' },
      body: '{}',
    });
    expect(missing.status).toBe(401);
    await expect(missing.json()).resolves.toEqual({ error: 'github_signature_missing' });

    const invalid = await app.request('/dashboard/api/webhooks/github', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Event': 'workflow_run',
        'X-Hub-Signature-256': 'sha256=deadbeef',
      },
      body: '{}',
    });
    expect(invalid.status).toBe(401);
    await expect(invalid.json()).resolves.toEqual({ error: 'github_signature_invalid' });
  });

  it('fails closed when GitHub webhook secret is not configured', async () => {
    const registry = createWorkflowRegistry();
    registry.register({
      id: 'github-ci-failure',
      trigger: 'github.workflow_run',
      run: async () => ({ outcome: 'should_not_run' }),
    });
    const app = new Hono();
    registerWorkflowRoutes(app, { registry, githubWebhookSecret: '' });
    const body = '{}';

    const response = await app.request('/dashboard/api/webhooks/github', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Event': 'workflow_run',
        'X-Hub-Signature-256': signBody(body, 'secret'),
      },
      body,
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'github_webhook_secret_not_configured',
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

function signBody(body: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

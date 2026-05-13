import type { Hono } from 'hono';
import {
  runWorkflow,
  WorkflowNotFoundError,
  type RunWorkflowOptions,
  type WorkflowRegistry,
} from '@vibe-kanban/workflow-core';

export interface RegisterWorkflowRoutesOptions {
  registry: WorkflowRegistry;
  runOptions?: RunWorkflowOptions;
}

export function registerWorkflowRoutes(
  hono: Hono,
  options: RegisterWorkflowRoutesOptions,
): void {
  hono.get('/dashboard/api/workflows/health', (c) => c.json({ ok: true }));

  hono.get('/dashboard/api/workflows', (c) => {
    return c.json({
      workflows: options.registry.list().map((workflow) => ({
        id: workflow.id,
        trigger: workflow.trigger,
      })),
    });
  });


  hono.post('/dashboard/api/webhooks/github', async (c) => {
    try {
      const event = c.req.header('X-GitHub-Event') || '';
      const payload = await readJsonBody(c.req.raw);
      const run = await runWorkflow(
        options.registry,
        'github-ci-failure',
        { event, payload },
        options.runOptions,
      );
      const status = run.status === 'failed' ? 500 : 200;
      return c.json({ run }, status);
    } catch (error) {
      if (error instanceof WorkflowNotFoundError) {
        return c.json({ error: error.message }, 404);
      }

      console.error('GitHub webhook workflow route failed', error);
      return c.json({ error: 'Internal GitHub webhook workflow route error' }, 500);
    }
  });

  hono.post('/dashboard/api/workflows/:workflowId/run', async (c) => {
    const { workflowId } = c.req.param();
    try {
      const input = await readJsonBody(c.req.raw);
      const run = await runWorkflow(
        options.registry,
        workflowId,
        input,
        options.runOptions,
      );
      const status = run.status === 'failed' ? 500 : 200;
      return c.json({ run }, status);
    } catch (error) {
      if (error instanceof WorkflowNotFoundError) {
        return c.json({ error: error.message }, 404);
      }

      console.error('Workflow route failed', error);
      return c.json({ error: 'Internal workflow route error' }, 500);
    }
  });
}

async function readJsonBody(request: Request): Promise<unknown> {
  const raw = await request.text();
  if (!raw.trim()) return {};
  return JSON.parse(raw) as unknown;
}

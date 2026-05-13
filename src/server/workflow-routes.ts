import type { Hono } from 'hono';
import {
  runWorkflow,
  WorkflowNotFoundError,
  type RunWorkflowOptions,
  type WorkflowRegistry,
} from '@vibe-kanban/workflow-core';
import { verifyGitHubWebhookSignature } from './github-signature';

export interface RegisterWorkflowRoutesOptions {
  registry: WorkflowRegistry;
  runOptions?: RunWorkflowOptions;
  githubWebhookSecret?: string;
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
      const rawBody = await c.req.raw.text();
      const signatureResult = verifyGitHubWebhookSignature({
        body: rawBody,
        secret: options.githubWebhookSecret ?? process.env.GITHUB_WEBHOOK_SECRET,
        signature: c.req.header('X-Hub-Signature-256'),
      });
      if (!signatureResult.ok) {
        return c.json({ error: signatureResult.error }, signatureResult.status);
      }
      const payload = parseJsonBody(rawBody);
      const run = await runWorkflow(
        options.registry,
        'github-ci-failure',
        { event, payload },
        options.runOptions,
      );
      const status = run.status === 'failed' ? 500 : 200;
      return c.json({ outcome: getRunOutcome(run.output), run }, status);
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
  return parseJsonBody(await request.text());
}

function parseJsonBody(raw: string): unknown {
  if (!raw.trim()) return {};
  return JSON.parse(raw) as unknown;
}

function getRunOutcome(output: unknown): unknown {
  if (output && typeof output === 'object' && 'outcome' in output) {
    return (output as { outcome: unknown }).outcome;
  }
  return undefined;
}

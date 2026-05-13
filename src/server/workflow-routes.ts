import type { Handler, Hono } from 'hono';
import { RegExpRouter } from 'hono/router/reg-exp-router';
import { SmartRouter } from 'hono/router/smart-router';
import { TrieRouter } from 'hono/router/trie-router';
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
      const delivery = c.req.header('X-GitHub-Delivery') || '';
      const payloadSummary = summarizeGitHubWebhookPayload(payload);
      console.info('GitHub webhook received', {
        delivery,
        event,
        ...payloadSummary,
      });
      const run = await runWorkflow(
        options.registry,
        'github-ci-failure',
        { event, payload },
        options.runOptions,
      );
      const outcome = getRunOutcome(run.output);
      console.info('GitHub webhook workflow completed', {
        delivery,
        event,
        outcome,
        status: run.status,
        runId: run.runId,
      });
      const status = run.status === 'failed' ? 500 : 200;
      return c.json({ outcome, run }, status);
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

  prioritizeWorkflowRoutes(hono);
}

export function prioritizeWorkflowRoutes(hono: Hono): void {
  prioritizeRoutes(hono, (route) => route.path.startsWith('/dashboard/api/'));
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

function summarizeGitHubWebhookPayload(payload: unknown): Record<string, unknown> {
  const record = asRecord(payload);
  const workflowRun = asRecord(record?.workflow_run);
  return {
    action: asString(record?.action),
    workflowRunStatus: asString(workflowRun?.status),
    workflowRunConclusion: asString(workflowRun?.conclusion),
    workflowRunHtmlUrl: asString(workflowRun?.html_url),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

interface HonoRoute {
  basePath: string;
  path: string;
  method: string;
  handler: Handler;
}

interface MutableHonoRoutes {
  routes: HonoRoute[];
  router: {
    add: (method: string, path: string, handlerData: [Handler, HonoRoute]) => void;
  };
}

function prioritizeRoutes(hono: Hono, shouldPrioritize: (route: HonoRoute) => boolean): void {
  const mutableHono = hono as unknown as MutableHonoRoutes;
  const routes = mutableHono.routes;
  const prioritizedRoutes = routes.filter(shouldPrioritize);
  if (prioritizedRoutes.length === 0) return;

  const firstPrioritizedRouteIndex = routes.findIndex(shouldPrioritize);
  const fallbackRouteIndex = routes.findIndex((route, index) => {
    return index < firstPrioritizedRouteIndex && isBlockingFallbackRoute(route);
  });
  if (fallbackRouteIndex === -1) return;

  const otherRoutes = routes.filter((route) => !shouldPrioritize(route));
  const orderedRoutes = [
    ...otherRoutes.slice(0, fallbackRouteIndex),
    ...prioritizedRoutes,
    ...otherRoutes.slice(fallbackRouteIndex),
  ];

  mutableHono.routes = orderedRoutes;
  mutableHono.router = new SmartRouter({
    routers: [new RegExpRouter(), new TrieRouter()],
  });

  for (const route of orderedRoutes) {
    mutableHono.router.add(route.method, route.path, [route.handler, route]);
  }
}

function isBlockingFallbackRoute(route: HonoRoute): boolean {
  if (route.method !== 'ALL') return false;
  if (route.path !== '/' && route.path !== '/*') return false;

  // Springboard registers a global CORS middleware before the SPA fallbacks. It
  // calls next(), so it should stay ahead of API routes. The SPA fallbacks do
  // not call next(), so API routes registered later must be moved before them.
  return route.handler.name !== 'cors2';
}

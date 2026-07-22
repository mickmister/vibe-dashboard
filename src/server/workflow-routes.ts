import type { Hono } from 'hono';
import {
  runWorkflow,
  WorkflowNotFoundError,
  type RunWorkflowOptions,
  type WorkflowRecorder,
  type WorkflowRegistry,
} from '@vibe-dashboard/workflow-core';
import { verifyGitHubWebhookSignature } from './github-signature';
import type { CachedRepoAlias } from '../workflows/github-ci';

export interface RegisterWorkflowRoutesOptions {
  registry: WorkflowRegistry;
  runOptions?: RunWorkflowOptions;
  workflowRunRecorder?: WorkflowRecorder;
  githubWebhookSecret?: string;
  repoAliasCache?: RepoAliasCache;
}

export interface RepoAliasCache {
  get: () => CachedRepoAlias[] | Promise<CachedRepoAlias[]>;
  set: (repos: CachedRepoAlias[]) => void | Promise<void>;
  refresh?: () => CachedRepoAlias[] | Promise<CachedRepoAlias[]>;
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
      const run = await runGitHubCiFailureWorkflow({
        event,
        payload,
        options,
        delivery,
      });
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
        getRunOptions(options),
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

async function runGitHubCiFailureWorkflow(args: {
  event: string;
  payload: unknown;
  options: RegisterWorkflowRoutesOptions;
  delivery: string;
}) {
  const firstRun = await runWorkflow(
    args.options.registry,
    'github-ci-failure',
    {
      event: args.event,
      payload: args.payload,
      repoAliases: await getCachedRepoAliases(args.options.repoAliasCache),
    },
    getRunOptions(args.options),
  );

  if (getRunOutcome(firstRun.output) !== 'no_matching_workspace') {
    return firstRun;
  }

  const refreshedRepoAliases = await refreshCachedRepoAliases(args.options.repoAliasCache);
  if (!refreshedRepoAliases) {
    return firstRun;
  }

  console.info('Retrying GitHub webhook workflow after refreshing repo aliases', {
    delivery: args.delivery,
    event: args.event,
  });

  return runWorkflow(
    args.options.registry,
    'github-ci-failure',
    {
      event: args.event,
      payload: args.payload,
      repoAliases: refreshedRepoAliases,
    },
    getRunOptions(args.options),
  );
}

function getRunOptions(options: RegisterWorkflowRoutesOptions): RunWorkflowOptions | undefined {
  if (!options.workflowRunRecorder) return options.runOptions;
  return {
    ...options.runOptions,
    recorder: composeWorkflowRecorders(
      options.runOptions?.recorder,
      options.workflowRunRecorder,
    ),
  };
}

function composeWorkflowRecorders(
  first: WorkflowRecorder | undefined,
  second: WorkflowRecorder,
): WorkflowRecorder {
  if (!first) return second;
  return {
    onRunStarted: async (run) => {
      await first.onRunStarted?.(run);
      await second.onRunStarted?.(run);
    },
    onRunCompleted: async (run) => {
      await first.onRunCompleted?.(run);
      await second.onRunCompleted?.(run);
    },
  };
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

async function getCachedRepoAliases(
  cache: RepoAliasCache | undefined,
): Promise<CachedRepoAlias[]> {
  if (!cache) return [];
  try {
    const repos = await cache.get();
    return repos.map(normalizeCachedRepoAlias);
  } catch (error) {
    console.warn('Failed to read Git repo alias cache', error);
    return [];
  }
}

async function refreshCachedRepoAliases(
  cache: RepoAliasCache | undefined,
): Promise<CachedRepoAlias[] | null> {
  if (!cache?.refresh) return null;
  try {
    const repos = await cache.refresh();
    return repos.map(normalizeCachedRepoAlias);
  } catch (error) {
    console.warn('Failed to refresh Git repo alias cache', error);
    return null;
  }
}

function normalizeCachedRepoAlias(repo: CachedRepoAlias): CachedRepoAlias {
  return {
    name: repo.name,
    aliases: [...new Set(repo.aliases)],
  };
}

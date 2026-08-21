import type { Hono } from 'hono';
import {
  runWorkflow,
  WorkflowNotFoundError,
  type RunWorkflowOptions,
  type WorkflowRegistry,
} from '@vibe-dashboard/workflow-core';
import { verifyGitHubWebhookSignature } from './github-signature';
import type { CachedRepoAlias } from '../workflows/github-ci';
import {
  GithubIssueWorkspaceMapStore,
  type GithubIssueIdentity,
} from './github-issue-workspace-map';
import {
  ensureGithubRepoRegistered,
  GithubRepoProvisioningError,
  type EnsureGithubRepoOptions,
} from './github-repo-provisioning';
import {
  findBranchesContainingCommit,
  GitBranchLookupError,
  type FindBranchesContainingCommitOptions,
} from './git-branches';
import { VibeKanbanServerClient } from './vk-client';

export interface RegisterWorkflowRoutesOptions {
  registry: WorkflowRegistry;
  runOptions?: RunWorkflowOptions;
  githubWebhookSecret?: string;
  repoAliasCache?: RepoAliasCache;
  githubRepoProvisioning?: EnsureGithubRepoOptions;
  githubBranchLookup?: FindBranchesContainingCommitOptions & {
    vkClient?: Pick<VibeKanbanServerClient, 'getRepos'>;
  };
  githubIssueWorkspaceMap?: GithubIssueWorkspaceMapStore;
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

  const issueWorkspaceMap =
    options.githubIssueWorkspaceMap ?? new GithubIssueWorkspaceMapStore();

  hono.get(
    '/dashboard/api/github/issue-workspaces/:owner/:repo/:number',
    async (c) => {
      const identity = parseIssueIdentityParams(c.req.param());
      if (!identity) {
        return c.json(
          {
            error: 'A valid GitHub issue owner, repo, and number are required',
          },
          400,
        );
      }

      const mapping = await issueWorkspaceMap.get(identity);
      return c.json({ mapping });
    },
  );

  hono.put(
    '/dashboard/api/github/issue-workspaces/:owner/:repo/:number',
    async (c) => {
      const identity = parseIssueIdentityParams(c.req.param());
      if (!identity) {
        return c.json(
          {
            error: 'A valid GitHub issue owner, repo, and number are required',
          },
          400,
        );
      }

      const body = asRecord(await readJsonBody(c.req.raw));
      const workspaceId = asString(body?.workspaceId);
      const branch = asString(body?.branch);
      if (!(workspaceId && branch)) {
        return c.json({ error: 'workspaceId and branch are required' }, 400);
      }

      const mapping = await issueWorkspaceMap.upsert({
        identity,
        workspaceId,
        branch,
      });
      return c.json({ mapping });
    },
  );

  hono.delete(
    '/dashboard/api/github/issue-workspaces/:owner/:repo/:number',
    async (c) => {
      const identity = parseIssueIdentityParams(c.req.param());
      if (!identity) {
        return c.json(
          {
            error: 'A valid GitHub issue owner, repo, and number are required',
          },
          400,
        );
      }

      const deleted = await issueWorkspaceMap.delete(identity);
      return c.json({ deleted });
    },
  );

  hono.get(
    '/dashboard/api/github/repos/:repoId/branches-containing/:commit',
    async (c) => {
      try {
        const repoId = c.req.param('repoId');
        const commit = c.req.param('commit');
        const vkClient =
          options.githubBranchLookup?.vkClient ?? new VibeKanbanServerClient();
        const repos = await vkClient.getRepos();
        const repo = repos.find((entry) => entry.id === repoId);
        if (!repo) {
          return c.json(
            { error: `VK repository ${repoId} was not found.` },
            404,
          );
        }

        const branches = await findBranchesContainingCommit(repo.path, commit, {
          execFile: options.githubBranchLookup?.execFile,
        });
        return c.json({ branches });
      } catch (error) {
        if (error instanceof GitBranchLookupError) {
          return c.json(
            { error: error.message },
            error.status === 400 ? 400 : 500,
          );
        }
        console.error('GitHub branch lookup route failed', error);
        return c.json(
          { error: 'Internal GitHub branch lookup route error' },
          500,
        );
      }
    },
  );

  hono.post('/dashboard/api/github/ensure-repo', async (c) => {
    try {
      const body = await readJsonBody(c.req.raw);
      const repoUrl = asString(asRecord(body)?.repoUrl);
      if (!repoUrl) {
        return c.json({ error: 'repoUrl is required' }, 400);
      }

      const result = await ensureGithubRepoRegistered(
        { repoUrl },
        options.githubRepoProvisioning,
      );
      return c.json({
        repo: result.repo,
        path: result.path,
        cloned: result.cloned,
        refreshed: result.refreshed,
        registered: result.registered,
      });
    } catch (error) {
      if (error instanceof GithubRepoProvisioningError) {
        const status = error.status === 400 ? 400 : 500;
        return c.json({ error: error.message }, status);
      }
      console.error('GitHub repo provisioning route failed', error);
      return c.json(
        { error: 'Internal GitHub repo provisioning route error' },
        500,
      );
    }
  });

  hono.post('/dashboard/api/webhooks/github', async (c) => {
    try {
      const event = c.req.header('X-GitHub-Event') || '';
      const rawBody = await c.req.raw.text();
      const signatureResult = verifyGitHubWebhookSignature({
        body: rawBody,
        secret:
          options.githubWebhookSecret ?? process.env.GITHUB_WEBHOOK_SECRET,
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
      return c.json(
        { error: 'Internal GitHub webhook workflow route error' },
        500,
      );
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
    args.options.runOptions,
  );

  if (getRunOutcome(firstRun.output) !== 'no_matching_workspace') {
    return firstRun;
  }

  const refreshedRepoAliases = await refreshCachedRepoAliases(
    args.options.repoAliasCache,
  );
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
    args.options.runOptions,
  );
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
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function parseIssueIdentityParams(params: {
  owner?: string;
  repo?: string;
  number?: string;
}): GithubIssueIdentity | null {
  const owner = params.owner?.trim().toLowerCase();
  const repo = params.repo
    ?.trim()
    .replace(/\.git$/i, '')
    .toLowerCase();
  const number = Number(params.number);

  if (!(owner && repo && Number.isInteger(number) && number > 0)) {
    return null;
  }

  return {
    owner,
    repo,
    number,
    normalizedIssueUrl: `https://github.com/${owner}/${repo}/issues/${number}`,
  };
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

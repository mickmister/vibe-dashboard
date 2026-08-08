import type { Hono } from 'hono';
import {
  runWorkflow,
  WorkflowNotFoundError,
  type RunWorkflowOptions,
  type WorkflowRecorder,
  type WorkflowRegistry,
} from '@vibe-dashboard/workflow-core';
import { verifyGitHubWebhookSignature } from './github-signature';
import {
  parsePositiveInteger,
  parseWorkflowRunStatus,
  type WorkflowRunReader,
} from './workflow-run-store';
import {
  parseWorkflowInstanceStatus,
  parseWorkflowTriggerStatus,
  type DbWorkflowOrchestrationStore,
} from './workflow-orchestration-store';
import type { CachedRepoAlias } from '../workflows/github-ci';
import type { WorkflowActivityScanner, WorkflowSchedulerBudgetPolicy } from './workflow-session-scanner';
import type { WorkflowRoleSessionResolver } from './role-session-resolver';
import type { DeclarativeWorkflowRuntime } from '../workflows/declarative/runtime';
import { BUILT_IN_DECLARATIVE_WORKFLOW_DEFINITIONS, getBuiltInDeclarativeWorkflowDefinition } from '../workflows/declarative/builtins';
import type { DeclarativeWorkflowDefinition } from '../workflows/declarative/definitions';
import { normalizeDeclarativeWorkflowDefinition } from '../workflows/declarative/definitions';
import type { DbDeclarativeWorkflowDefinitionStore } from './declarative-workflow-definition-store';
import type { DbWorkflowWebhookProvisioningStore } from './workflow-webhook-provisioning-store';
import {
  parseVkWorkflowWebhookPayload,
  verifyVkWebhookSignature,
  WorkflowWebhookPayloadError,
  WorkflowWebhookSignatureError,
  type DbWorkflowWebhookInboxStore,
  type WorkflowWebhookWakeup,
} from './workflow-webhook-inbox';

export interface RegisterWorkflowRoutesOptions {
  registry: WorkflowRegistry;
  runOptions?: RunWorkflowOptions;
  workflowRunRecorder?: WorkflowRecorder;
  workflowRunReader?: WorkflowRunReader;
  workflowOrchestrationStore?: DbWorkflowOrchestrationStore;
  workflowActivityScanner?: WorkflowActivityScanner;
  roleSessionResolver?: WorkflowRoleSessionResolver;
  declarativeWorkflowRuntime?: DeclarativeWorkflowRuntime;
  declarativeWorkflowDefinitionStore?: DbDeclarativeWorkflowDefinitionStore;
  workflowWebhookInboxStore?: DbWorkflowWebhookInboxStore;
  workflowWebhookWakeup?: Pick<WorkflowWebhookWakeup, 'trigger'>;
  workflowWebhookProvisioningStore?: Pick<DbWorkflowWebhookProvisioningStore, 'getSecret' | 'getPublicState'>;
  vkWorkflowWebhookSecret?: string;
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

  hono.get('/dashboard/api/workflow-webhooks/inbox', async (c) => {
    const store = options.workflowWebhookInboxStore;
    if (!store) return c.json({ error: 'workflow_webhook_inbox_store_not_configured' }, 503);
    return c.json(await store.listEvents({
      limit: parsePositiveInteger(c.req.query('limit') ?? null),
      offset: parsePositiveInteger(c.req.query('offset') ?? null),
    }));
  });

  hono.get('/dashboard/api/workflow-webhooks/provisioning', async (c) => {
    const store = options.workflowWebhookProvisioningStore;
    if (!store) return c.json({ error: 'workflow_webhook_provisioning_store_not_configured' }, 503);
    const state = await store.getPublicState();
    return c.json({ state });
  });

  hono.post('/dashboard/api/workflow-webhooks/vk', async (c) => {
    const store = options.workflowWebhookInboxStore;
    if (!store) return c.json({ error: 'workflow_webhook_inbox_store_not_configured' }, 503);
    const secret = options.vkWorkflowWebhookSecret ?? process.env.VD_VK_WEBHOOK_SECRET ?? await options.workflowWebhookProvisioningStore?.getSecret();
    if (!secret) return c.json({ error: 'vk_workflow_webhook_secret_not_configured', message: 'VK workflow webhook HMAC secret is not configured. Wait for webhook provisioning or configure VD_VK_WEBHOOK_SECRET.' }, 503);
    const rawBody = await c.req.raw.text();
    try {
      verifyVkWebhookSignature({
        secret,
        timestamp: c.req.header('X-VK-Webhook-Timestamp') ?? null,
        algorithm: c.req.header('X-VK-Webhook-Algorithm') ?? null,
        signature: c.req.header('X-VK-Webhook-Signature') ?? null,
        body: rawBody,
      });
      const event = parseVkWorkflowWebhookPayload(parseJsonBody(rawBody));
      const inserted = await store.insertEvent({
        event,
        signatureHeader: c.req.header('X-VK-Webhook-Signature') ?? null,
        timestampHeader: c.req.header('X-VK-Webhook-Timestamp') ?? null,
      });
      if (inserted.duplicate) {
        return c.json({ accepted: true, duplicate: true, inbox: inserted.inbox }, 202);
      }
      try {
        const wakeup = await options.workflowWebhookWakeup?.trigger();
        const processed = await store.markProcessed(inserted.inbox.inboxId);
        return c.json({ accepted: true, duplicate: false, inbox: processed, wakeup: { started: Boolean(wakeup?.started), queued: Boolean(wakeup?.queued), passes: wakeup?.passes ?? null } }, 202);
      } catch (error) {
        const failed = await store.markFailed(inserted.inbox.inboxId, error);
        return c.json({ accepted: true, duplicate: false, inbox: failed, wakeup: { started: true, error: error instanceof Error ? error.message : String(error) } }, 202);
      }
    } catch (error) {
      if (error instanceof WorkflowWebhookSignatureError) {
        return c.json({ error: 'invalid_vk_workflow_webhook_signature', message: error.message }, 401);
      }
      if (error instanceof WorkflowWebhookPayloadError) {
        return c.json({ error: 'invalid_vk_workflow_webhook_payload', message: error.message }, 400);
      }
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  hono.get('/dashboard/api/declarative-workflow-definitions', async (c) => {
    const store = options.declarativeWorkflowDefinitionStore;
    const stored = store ? await store.listDefinitions({ includeDisabled: c.req.query('includeDisabled') === 'true' }) : [];
    const storedKeys = new Set(stored.map((entry) => `${entry.definitionId}:${entry.version}`));
    const builtIns = BUILT_IN_DECLARATIVE_WORKFLOW_DEFINITIONS
      .filter((definition) => !storedKeys.has(`${definition.id}:${definition.version}`))
      .map((definition) => ({ source: 'built_in', definitionId: definition.id, version: definition.version, status: 'active', name: definition.name, description: definition.description ?? null, trigger: definition.trigger, definition }));
    return c.json({
      definitions: [
        ...stored.map((definition) => ({ ...definition, source: 'db' })),
        ...builtIns,
      ],
    });
  });

  hono.get('/dashboard/api/declarative-workflow-definitions/:definitionId', async (c) => {
    const definition = await resolveDeclarativeDefinitionFromRegistry(c.req.param('definitionId'), undefined, options, { includeDisabled: c.req.query('includeDisabled') === 'true' });
    if (!definition) return c.json({ error: 'declarative_workflow_definition_not_found' }, 404);
    return c.json({ definition });
  });

  hono.get('/dashboard/api/declarative-workflow-definitions/:definitionId/versions/:version', async (c) => {
    const version = parsePositiveInteger(c.req.param('version'));
    if (!version) return c.json({ error: 'invalid_definition_version' }, 400);
    const definition = await resolveDeclarativeDefinitionFromRegistry(c.req.param('definitionId'), version, options, { includeDisabled: c.req.query('includeDisabled') === 'true' });
    if (!definition) return c.json({ error: 'declarative_workflow_definition_not_found' }, 404);
    return c.json({ definition });
  });

  hono.post('/dashboard/api/declarative-workflow-definitions', async (c) => {
    const store = options.declarativeWorkflowDefinitionStore;
    if (!store) return c.json({ error: 'declarative_workflow_definition_store_not_configured' }, 503);
    try {
      const body = asRecord(await readJsonBody(c.req.raw));
      const saved = await store.saveDefinition({
        definition: body?.definition,
        status: body?.status === 'disabled' ? 'disabled' : 'active',
      });
      return c.json({ definition: saved }, 200);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  hono.delete('/dashboard/api/declarative-workflow-definitions/:definitionId', async (c) => {
    const store = options.declarativeWorkflowDefinitionStore;
    if (!store) return c.json({ error: 'declarative_workflow_definition_store_not_configured' }, 503);
    const version = parsePositiveInteger(c.req.query('version') ?? null);
    const disabled = await store.disableDefinition(c.req.param('definitionId'), version);
    if (!disabled) return c.json({ error: 'declarative_workflow_definition_not_found' }, 404);
    return c.json({ definition: disabled });
  });

  hono.get('/dashboard/api/workflows', (c) => {
    return c.json({
      workflows: options.registry.list().map((workflow) => ({
        id: workflow.id,
        trigger: workflow.trigger,
      })),
    });
  });

  hono.get('/dashboard/api/workflow-runs', async (c) => {
    const reader = options.workflowRunReader;
    if (!reader) return c.json({ error: 'workflow_run_reader_not_configured' }, 503);
    const result = await reader.listRuns({
      workflowId: c.req.query('workflowId') || undefined,
      status: parseWorkflowRunStatus(c.req.query('status') ?? null),
      vkWorkspaceId: c.req.query('vkWorkspaceId') || undefined,
      vkSessionId: c.req.query('vkSessionId') || undefined,
      vkQueueItemId: c.req.query('vkQueueItemId') || undefined,
      limit: parsePositiveInteger(c.req.query('limit') ?? null),
      offset: parsePositiveInteger(c.req.query('offset') ?? null),
    });
    return c.json(result);
  });

  hono.get('/dashboard/api/workflow-runs/:runId', async (c) => {
    const reader = options.workflowRunReader;
    if (!reader) return c.json({ error: 'workflow_run_reader_not_configured' }, 503);
    const run = await reader.getRun(c.req.param('runId'));
    if (!run) return c.json({ error: 'workflow_run_not_found' }, 404);
    return c.json({ run });
  });

  hono.get('/dashboard/api/workflow-runs/:runId/events', async (c) => {
    const reader = options.workflowRunReader;
    if (!reader) return c.json({ error: 'workflow_run_reader_not_configured' }, 503);
    const result = await reader.listRunEvents(c.req.param('runId'), {
      limit: parsePositiveInteger(c.req.query('limit') ?? null),
      offset: parsePositiveInteger(c.req.query('offset') ?? null),
    });
    if (!result) return c.json({ error: 'workflow_run_not_found' }, 404);
    return c.json(result);
  });




  hono.post('/dashboard/api/agent-team-session-mappings/resolve', async (c) => {
    const resolver = options.roleSessionResolver;
    if (!resolver) return c.json({ error: 'role_session_resolver_not_configured' }, 503);
    try {
      const input = await readJsonBody(c.req.raw);
      const result = await resolver.resolve(parseRoleSessionResolveRequest(input));
      const status = result.ok ? 200 : 400;
      return c.json(result, status);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  hono.get('/dashboard/api/workflow-activity', async (c) => {
    const scanner = options.workflowActivityScanner;
    if (!scanner) return c.json({ error: 'workflow_activity_scanner_not_configured' }, 503);
    const scan = await scanner.scanOnce(parseWorkflowActivityPolicy(c.req.query()));
    return c.json(scan);
  });

  hono.get('/dashboard/api/workflow-instances', async (c) => {
    const store = options.workflowOrchestrationStore;
    if (!store) return c.json({ error: 'workflow_orchestration_store_not_configured' }, 503);
    const result = await store.listInstances({
      workflowId: c.req.query('workflowId') || undefined,
      status: parseWorkflowInstanceStatus(c.req.query('status') ?? null),
      teamId: c.req.query('teamId') || undefined,
      laneId: c.req.query('laneId') || undefined,
      limit: parsePositiveInteger(c.req.query('limit') ?? null),
      offset: parsePositiveInteger(c.req.query('offset') ?? null),
    });
    return c.json(result);
  });

  hono.get('/dashboard/api/workflow-instances/:instanceId', async (c) => {
    const store = options.workflowOrchestrationStore;
    if (!store) return c.json({ error: 'workflow_orchestration_store_not_configured' }, 503);
    const instance = await store.getInstance(c.req.param('instanceId'));
    if (!instance) return c.json({ error: 'workflow_instance_not_found' }, 404);
    return c.json({ instance });
  });

  hono.get('/dashboard/api/workflow-instances/:instanceId/status', async (c) => {
    const store = options.workflowOrchestrationStore;
    if (!store) return c.json({ error: 'workflow_orchestration_store_not_configured' }, 503);
    const instance = await store.getInstance(c.req.param('instanceId'));
    if (!instance) return c.json({ error: 'workflow_instance_not_found' }, 404);
    const steps = await store.listStepStates(instance.instanceId);
    const triggers = await store.listTriggers({ instanceId: instance.instanceId, limit: 100 });
    return c.json({ instance, steps, triggers: triggers.triggers, output: asRecord(instance.state)?.output ?? null });
  });

  hono.post('/dashboard/api/declarative-workflows/:workflowId/run', async (c) => {
    const runtime = options.declarativeWorkflowRuntime;
    if (!runtime) return c.json({ error: 'declarative_workflow_runtime_not_configured' }, 503);
    try {
      const workflowId = c.req.param('workflowId');
      const body = asRecord(await readJsonBody(c.req.raw));
      const definition = await resolveDeclarativeDefinition(workflowId, body?.definition, options);
      if (!definition) return c.json({ error: 'declarative_workflow_not_found' }, 404);
      const team = asRecord(body?.team);
      if (!team) return c.json({ error: 'team is required' }, 400);
      const result = await runtime.start({
        definition,
        input: asRecord(body?.input) ?? {},
        team: team as never,
        instanceId: asString(body?.instanceId),
        trigger: asString(body?.trigger),
        teamId: asString(body?.teamId),
      });
      return c.json({ result }, 202);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  hono.post('/dashboard/api/declarative-workflows/:workflowId/run-once', async (c) => {
    const runtime = options.declarativeWorkflowRuntime;
    if (!runtime) return c.json({ error: 'declarative_workflow_runtime_not_configured' }, 503);
    try {
      const body = asRecord(await readJsonBody(c.req.raw));
      const definition = await resolveDeclarativeDefinition(c.req.param('workflowId'), body?.definition, options);
      if (!definition) return c.json({ error: 'declarative_workflow_not_found' }, 404);
      const result = await runtime.runOnce({ definition });
      return c.json({ result });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  hono.get('/dashboard/api/workflow-scoped-triggers', async (c) => {
    const store = options.workflowOrchestrationStore;
    if (!store) return c.json({ error: 'workflow_orchestration_store_not_configured' }, 503);
    const result = await store.listTriggers({
      instanceId: c.req.query('instanceId') || undefined,
      status: parseWorkflowTriggerStatus(c.req.query('status') ?? null),
      workspaceId: c.req.query('workspaceId') || undefined,
      sessionId: c.req.query('sessionId') || undefined,
      limit: parsePositiveInteger(c.req.query('limit') ?? null),
      offset: parsePositiveInteger(c.req.query('offset') ?? null),
    });
    return c.json(result);
  });

  hono.get('/dashboard/api/workflow-scoped-triggers/:triggerId', async (c) => {
    const store = options.workflowOrchestrationStore;
    if (!store) return c.json({ error: 'workflow_orchestration_store_not_configured' }, 503);
    const trigger = await store.getTrigger(c.req.param('triggerId'));
    if (!trigger) return c.json({ error: 'workflow_scoped_trigger_not_found' }, 404);
    return c.json({ trigger });
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

async function resolveDeclarativeDefinition(workflowId: string, rawDefinition: unknown, options: RegisterWorkflowRoutesOptions): Promise<DeclarativeWorkflowDefinition | null> {
  if (rawDefinition !== undefined) {
    const definition = normalizeDeclarativeWorkflowDefinition(rawDefinition);
    if (definition.id !== workflowId) throw new Error(`definition id ${definition.id} does not match requested workflow id ${workflowId}`);
    return definition;
  }
  const stored = await options.declarativeWorkflowDefinitionStore?.getDefinition(workflowId);
  return stored?.definition ?? getBuiltInDeclarativeWorkflowDefinition(workflowId);
}

async function resolveDeclarativeDefinitionFromRegistry(
  definitionId: string,
  version: number | undefined,
  options: RegisterWorkflowRoutesOptions,
  opts: { includeDisabled?: boolean } = {},
) {
  const stored = await options.declarativeWorkflowDefinitionStore?.getDefinition(definitionId, version, opts);
  if (stored) return { ...stored, source: 'db' };
  if (!version || version === 1) {
    const builtIn = getBuiltInDeclarativeWorkflowDefinition(definitionId);
    if (builtIn) return { source: 'built_in', definitionId: builtIn.id, version: builtIn.version, status: 'active', name: builtIn.name, description: builtIn.description ?? null, trigger: builtIn.trigger, definition: builtIn };
  }
  return null;
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


function parseWorkflowActivityPolicy(query: Record<string, string>): WorkflowSchedulerBudgetPolicy {
  return {
    maxActiveExecutions: parsePositiveInteger(query.maxActiveExecutions ?? null) ?? 8,
    maxWorkflowOwnedSessions: parsePositiveInteger(query.maxWorkflowOwnedSessions ?? null),
  };
}


function parseRoleSessionResolveRequest(input: unknown) {
  const record = asRecord(input);
  const team = asRecord(record?.team);
  const workspaceId = asString(record?.workspaceId);
  if (!team) throw new Error('team is required');
  if (!workspaceId) throw new Error('workspaceId is required');
  return {
    team: team as never,
    workspaceId,
    workflowId: asString(record?.workflowId) ?? 'manual-agent-team-runner',
    instanceId: asString(record?.instanceId) ?? null,
    laneId: asString(record?.laneId) ?? null,
    roleIds: Array.isArray(record?.roleIds) ? record.roleIds.filter((value): value is string => typeof value === 'string') : undefined,
    overrides: (asRecord(record?.overrides) ?? undefined) as never,
    allowAutoCreate: typeof record?.allowAutoCreate === 'boolean' ? record.allowAutoCreate : true,
    allowRoleNameReuse: typeof record?.allowRoleNameReuse === 'boolean' ? record.allowRoleNameReuse : true,
  };
}

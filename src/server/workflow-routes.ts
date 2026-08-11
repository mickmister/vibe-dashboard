import { randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import type { Kysely } from 'kysely';
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
  parseWorkflowAttentionStatus,
  parseWorkflowInstanceStatus,
  parseWorkflowTriggerStatus,
  type DbWorkflowOrchestrationStore,
} from './workflow-orchestration-store';
import type { CachedRepoAlias } from '../workflows/github-ci';
import type { WorkflowActivityScanner, WorkflowSchedulerBudgetPolicy } from './workflow-session-scanner';
import type { WorkflowRoleSessionResolver } from './role-session-resolver';
import type { DeclarativeWorkflowRuntime } from '../workflows/declarative/runtime';
import type { VibeKanbanServerClient } from './vk-client';
import { buildWorkflowPresentationModel } from './workflow-presentation-read-model';
import { BUILT_IN_DECLARATIVE_WORKFLOW_DEFINITIONS, getBuiltInDeclarativeWorkflowDefinition } from '../workflows/declarative/builtins';
import type { DeclarativeWorkflowDefinition } from '../workflows/declarative/definitions';
import { normalizeDeclarativeWorkflowDefinition } from '../workflows/declarative/definitions';
import type { DbDeclarativeWorkflowDefinitionStore } from './declarative-workflow-definition-store';
import type { DbWorkflowWebhookProvisioningStore } from './workflow-webhook-provisioning-store';
import { buildWorkspaceWorkflowsHomeModel } from '../modules/plugins/workflows/server/workflowsHomeReadModel';
import { DbWorkflowDesignStore } from '../modules/plugins/workflows/server/workflowDesignStore';
import { PersistedWorkflowRuntimeService, type PersistedWorkflowRunReadModel } from '../modules/plugins/workflows/server/persistedWorkflowRuntime';
import { getVdDb } from './database';
import type { DB } from '../store/kysely_types';
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
  workflowDesignStore?: DbWorkflowDesignStore;
  workflowHomeDb?: Kysely<DB>;
  persistedWorkflowRuntime?: Pick<PersistedWorkflowRuntimeService, 'launch' | 'completeHumanForm'>;
  vkClient?: Partial<Pick<VibeKanbanServerClient, 'getExecutionProcessFinalMessage' | 'getExecutionProcessRepoStates' | 'getSessions' | 'getSession' | 'createSession' | 'queueFollowUp'>>;
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

  hono.get('/dashboard/api/workflows/home', async (c) => {
    const workspaceId = c.req.query('workspaceId')?.trim();
    if (!workspaceId) return c.json({ error: 'workspace_id_required', message: 'Workspace is required' }, 400);
    const db = options.workflowHomeDb ?? (await getVdDb()).db;
    const home = await buildWorkspaceWorkflowsHomeModel({
      db,
      designStore: options.workflowDesignStore,
      orchestrationStore: options.workflowOrchestrationStore,
      workspaceId,
    });
    return c.json({ home });
  });

  hono.get('/dashboard/api/workflows/launch-options', async (c) => {
    const workspaceId = c.req.query('workspaceId')?.trim();
    const designId = c.req.query('designId')?.trim();
    if (!workspaceId) return c.json({ error: 'workspace_id_required', message: 'Workspace is required' }, 400);
    if (!designId) return c.json({ error: 'workflow_required', message: 'Workflow is required' }, 400);
    const db = options.workflowHomeDb ?? (await getVdDb()).db;
    const designStore = options.workflowDesignStore ?? new DbWorkflowDesignStore({ db });
    try {
      const workflow = await buildLaunchWorkflowSummary(designStore, designId, parsePositiveInteger(c.req.query('version') ?? null) ?? undefined);
      if (!workflow.canRun) return c.json({ error: 'workflow_unavailable', message: workflow.unavailableReason ?? 'Workflow is not available to run' }, 400);
      const sessions = await listLaunchSessions(options, workspaceId);
      return c.json({ options: { workspaceId, workflow, sessions } });
    } catch (error) {
      return c.json({ error: 'workflow_launch_options_failed', message: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  hono.post('/dashboard/api/workflows/launch', async (c) => {
    const body = asRecord(await readJsonBody(c.req.raw));
    const parsed = parseWorkflowLaunchRequest(body);
    if (!parsed.ok) return c.json({ error: parsed.error, message: parsed.message, fieldErrors: parsed.fieldErrors }, parsed.status);
    const db = options.workflowHomeDb ?? (await getVdDb()).db;
    const designStore = options.workflowDesignStore ?? new DbWorkflowDesignStore({ db });
    try {
      const workflow = await buildLaunchWorkflowSummary(designStore, parsed.request.designId, parsed.request.version ?? undefined);
      if (!workflow.canRun) return c.json({ error: 'workflow_unavailable', message: workflow.unavailableReason ?? 'Workflow is not available to run' }, 400);
      const validationErrors = validateLaunchInputs(workflow, parsed.request.inputs);
      if (Object.keys(validationErrors).length > 0) {
        return c.json({ error: 'workflow_launch_validation_failed', message: 'Please fill out the required workflow fields.', fieldErrors: validationErrors }, 400);
      }
      const roleBindings = await resolveLaunchRoleBindings(options, parsed.request.workspaceId, workflow, parsed.request.roleBindings);
      const runtime = await resolvePersistedWorkflowRuntime(options, db, designStore);
      if (!runtime) return c.json({ error: 'workflow_runtime_not_configured', message: 'Workflow launch is not configured.' }, 503);
      const run = await runtime.launch({
        runId: `workflow-run-${randomUUID()}`,
        runSnapshotId: `workflow-run-snapshot-${randomUUID()}`,
        designId: parsed.request.designId,
        version: workflow.version ?? undefined,
        workspaceId: parsed.request.workspaceId,
        inputs: parsed.request.inputs,
        additionalInstructions: parsed.request.additionalInstructions,
        roleBindings,
      });
      const home = await buildWorkspaceWorkflowsHomeModel({
        db,
        designStore,
        orchestrationStore: options.workflowOrchestrationStore,
        workspaceId: parsed.request.workspaceId,
      });
      return c.json({ run: summarizePersistedRun(run), home }, 201);
    } catch (error) {
      if (error instanceof WorkflowLaunchFieldError) {
        return c.json({ error: 'workflow_launch_validation_failed', message: error.message, fieldErrors: error.fieldErrors }, 400);
      }
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: 'workflow_launch_failed', message }, 400);
    }
  });

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

  hono.get('/dashboard/api/workflow-instances/:instanceId/presentation', async (c) => {
    const store = options.workflowOrchestrationStore;
    if (!store) return c.json({ error: 'workflow_orchestration_store_not_configured' }, 503);
    const presentation = await buildWorkflowPresentationModel({
      store,
      vk: getPresentationVkClient(options),
      instanceId: c.req.param('instanceId'),
    });
    if (!presentation) return c.json({ error: 'workflow_presentation_not_found', message: 'Workflow not found' }, 404);
    return c.json({ presentation });
  });

  hono.get('/dashboard/api/workflow-attention-items', async (c) => {
    const store = options.workflowOrchestrationStore;
    if (!store) return c.json({ error: 'workflow_orchestration_store_not_configured' }, 503);
    const result = await store.listAttentionItems({
      status: parseWorkflowAttentionStatus(c.req.query('status') ?? null),
      teamId: c.req.query('teamId') || undefined,
      laneId: c.req.query('laneId') || undefined,
      instanceId: c.req.query('instanceId') || undefined,
      limit: parsePositiveInteger(c.req.query('limit') ?? null),
      offset: parsePositiveInteger(c.req.query('offset') ?? null),
    });
    return c.json(result);
  });

  hono.get('/dashboard/api/workflow-attention-items/:attentionItemId', async (c) => {
    const store = options.workflowOrchestrationStore;
    if (!store) return c.json({ error: 'workflow_orchestration_store_not_configured' }, 503);
    const item = await store.getAttentionItem(c.req.param('attentionItemId'));
    if (!item) return c.json({ error: 'workflow_attention_item_not_found' }, 404);
    return c.json({ item });
  });

  hono.post('/dashboard/api/workflow-attention-items/:attentionItemId/complete', async (c) => {
    const store = options.workflowOrchestrationStore;
    if (!store) return c.json({ error: 'workflow_orchestration_store_not_configured' }, 503);
    try {
      const body = asRecord(await readJsonBody(c.req.raw)) ?? {};
      const attention = await store.getAttentionItem(c.req.param('attentionItemId'));
      if (!attention) return c.json({ error: 'workflow_attention_item_not_found' }, 404);
      const db = options.workflowHomeDb ?? (await getVdDb()).db;
      const designStore = options.workflowDesignStore ?? new DbWorkflowDesignStore({ db });
      const persistedRun = await db.selectFrom('WorkflowPersistedRun').select(['runId']).where('runId', '=', attention.instanceId).executeTakeFirst();
      const runtime = persistedRun ? await resolvePersistedWorkflowRuntime(options, db, designStore) : null;
      if (persistedRun && !runtime) {
        return c.json({
          error: 'workflow_persisted_runtime_not_configured',
          message: 'Workflow answer cannot be submitted because persisted workflow resume is not configured.',
        }, 503);
      }
      const result = await store.completeHumanAttention({
        attentionItemId: c.req.param('attentionItemId'),
        stateVisitId: asString(body.stateVisitId),
        submission: body.submission ?? {},
      });
      if (result.applied && persistedRun && runtime) {
        try {
          await runtime.completeHumanForm({
            runId: result.attention.instanceId,
            turnId: result.attention.attentionItemId.startsWith('attention-') ? result.attention.attentionItemId.slice('attention-'.length) : result.attention.stepId,
            responseRef: result.attention.attentionItemId,
            submission: asRecord(body.submission) ?? {},
          });
        } catch (error) {
          return c.json({
            error: 'workflow_persisted_resume_failed',
            message: error instanceof Error ? error.message : 'Workflow answer was saved but workflow resume failed.',
            result,
          }, 500);
        }
      }
      const status = result.reason === 'invalid_submission' || result.reason === 'stale_state_visit' ? 400 : 200;
      return c.json({ result }, status);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
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

interface WorkflowLaunchRoleBindingRequest {
  mode: 'existing' | 'create_or_reuse';
  sessionId?: string;
  name?: string;
}

interface WorkflowLaunchRequest {
  workspaceId: string;
  designId: string;
  version: number | null;
  inputs: Record<string, unknown>;
  additionalInstructions: string | null;
  roleBindings: Record<string, WorkflowLaunchRoleBindingRequest>;
}

class WorkflowLaunchFieldError extends Error {
  readonly fieldErrors: Record<string, string>;

  constructor(path: string, message: string) {
    super(message);
    this.name = 'WorkflowLaunchFieldError';
    this.fieldErrors = { [path]: message };
  }
}

async function buildLaunchWorkflowSummary(designStore: DbWorkflowDesignStore, designId: string, version?: number) {
  const design = await designStore.getDesign(designId);
  if (!design) throw new Error('Workflow was not found.');
  const publishedVersion = version ?? design.latestPublishedVersion;
  const published = publishedVersion == null ? null : await designStore.getVersion(designId, publishedVersion);
  return {
    id: design.designId,
    title: design.name,
    description: design.description,
    source: 'published_design' as const,
    status: published ? 'ready' as const : 'unavailable' as const,
    version: published?.version ?? publishedVersion ?? null,
    unavailableReason: published ? null : 'Publish this workflow before running it.',
    canRun: Boolean(published),
    inputs: published ? summarizeLaunchInputs(published.resolvedDefinition) : [],
    roles: published ? summarizeLaunchRoles(published.resolvedDefinition) : [],
  };
}

function summarizeLaunchInputs(definition: unknown) {
  const inputs = asRecord(definition)?.inputs;
  const inputRecord = asRecord(inputs) ?? {};
  return Object.entries(inputRecord).map(([id, spec]) => {
    const record = asRecord(spec) ?? {};
    return {
      id,
      type: asString(record.type) ?? 'string',
      required: record.required === true,
      description: asString(record.description) ?? null,
    };
  });
}

function summarizeLaunchRoles(definition: unknown) {
  const roles = asRecord(definition)?.roles;
  const roleRecord = asRecord(roles) ?? {};
  return Object.entries(roleRecord).map(([id, spec]) => {
    const record = asRecord(spec) ?? {};
    return {
      id,
      label: asString(record.label) ?? id,
      description: asString(record.description) ?? null,
    };
  });
}

async function listLaunchSessions(options: RegisterWorkflowRoutesOptions, workspaceId: string) {
  if (!options.vkClient?.getSessions) return [];
  const sessions = await options.vkClient.getSessions(workspaceId);
  return sessions.map((session) => ({
    sessionId: session.id,
    name: session.name ?? null,
    executor: session.executor,
    workspaceId: session.workspace_id,
  }));
}

async function resolveLaunchRoleBindings(
  options: RegisterWorkflowRoutesOptions,
  workspaceId: string,
  workflow: Awaited<ReturnType<typeof buildLaunchWorkflowSummary>>,
  requested: Record<string, WorkflowLaunchRoleBindingRequest>,
) {
  const result: Record<string, { sessionId: string; workspaceId: string }> = {};
  for (const role of workflow.roles) {
    const binding = requested[role.id];
    if (!binding) throw new WorkflowLaunchFieldError(`role.${role.id}`, `Choose a session for ${role.label}.`);
    if (binding.mode === 'existing') {
      const sessionId = binding.sessionId?.trim();
      if (!sessionId) throw new WorkflowLaunchFieldError(`role.${role.id}`, `Choose an existing session for ${role.label}.`);
      if (options.vkClient?.getSession) {
        const session = await options.vkClient.getSession(sessionId);
        if (session.workspace_id !== workspaceId) throw new WorkflowLaunchFieldError(`role.${role.id}`, `${role.label} session belongs to another workspace.`);
      }
      result[role.id] = { sessionId, workspaceId };
      continue;
    }
    const name = binding.name?.trim() || role.label;
    if (!options.vkClient?.getSessions || !options.vkClient.createSession) {
      throw new WorkflowLaunchFieldError(`role.${role.id}`, `Cannot create or reuse a session for ${role.label}.`);
    }
    try {
      const sessions = await options.vkClient.getSessions(workspaceId);
      const reusable = [...sessions].sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at)).find((session) => session.name === name);
      const session = reusable ?? await options.vkClient.createSession({ workspace_id: workspaceId, executor: 'CODEX', name });
      if (session.workspace_id !== workspaceId) throw new Error(`${role.label} session belongs to another workspace.`);
      result[role.id] = { sessionId: session.id, workspaceId };
    } catch (error) {
      throw new WorkflowLaunchFieldError(`role.${role.id}`, error instanceof Error ? error.message : `Cannot create or reuse a session for ${role.label}.`);
    }
  }
  return result;
}

function validateLaunchInputs(workflow: Awaited<ReturnType<typeof buildLaunchWorkflowSummary>>, inputs: Record<string, unknown>): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const input of workflow.inputs) {
    const value = inputs[input.id];
    if (!input.required) continue;
    if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
      errors[input.id] = 'This field is required.';
    }
  }
  return errors;
}

function parseWorkflowLaunchRequest(record: Record<string, unknown> | null):
  | { ok: true; request: WorkflowLaunchRequest }
  | { ok: false; status: 400; error: string; message: string; fieldErrors?: Record<string, string> } {
  const workspaceId = asString(record?.workspaceId)?.trim();
  const designId = asString(record?.designId)?.trim();
  const inputs = asRecord(record?.inputs) ?? {};
  const roleBindings = asRecord(record?.roleBindings) ?? {};
  const fieldErrors: Record<string, string> = {};
  if (!workspaceId) fieldErrors.workspaceId = 'Workspace is required.';
  if (!designId) fieldErrors.designId = 'Workflow is required.';
  if (Object.keys(fieldErrors).length > 0) return { ok: false, status: 400, error: 'workflow_launch_validation_failed', message: 'Please fix the launch details.', fieldErrors };
  return {
    ok: true,
    request: {
      workspaceId: workspaceId!,
      designId: designId!,
      version: typeof record?.version === 'number' ? record.version : null,
      inputs,
      additionalInstructions: asString(record?.additionalInstructions)?.trim() || null,
      roleBindings: normalizeRoleBindings(roleBindings),
    },
  };
}

function normalizeRoleBindings(input: Record<string, unknown>): Record<string, WorkflowLaunchRoleBindingRequest> {
  const bindings: Record<string, WorkflowLaunchRoleBindingRequest> = {};
  for (const [roleId, raw] of Object.entries(input)) {
    const record = asRecord(raw) ?? {};
    const mode = record.mode === 'create_or_reuse' ? 'create_or_reuse' : 'existing';
    bindings[roleId] = mode === 'existing'
      ? { mode, sessionId: asString(record.sessionId) }
      : { mode, name: asString(record.name) };
  }
  return bindings;
}

async function resolvePersistedWorkflowRuntime(options: RegisterWorkflowRoutesOptions, db: Kysely<DB>, designStore: DbWorkflowDesignStore): Promise<Pick<PersistedWorkflowRuntimeService, 'launch' | 'completeHumanForm'> | null> {
  if (options.persistedWorkflowRuntime) return options.persistedWorkflowRuntime;
  if (!options.vkClient?.queueFollowUp) return null;
  return new PersistedWorkflowRuntimeService({
    db,
    designStore,
    orchestrationStore: options.workflowOrchestrationStore,
    queue: {
      queueAgentTurn: async (request) => {
        const queued = await options.vkClient!.queueFollowUp!(request.sessionId, request.prompt, { source: 'workflow' });
        return { queueItemRef: queued.queued_item.id };
      },
    },
  });
}

function summarizePersistedRun(run: PersistedWorkflowRunReadModel) {
  return {
    runId: run.runId,
    workspaceId: run.workspaceId,
    status: run.status,
    detailUrl: null,
  };
}

function getPresentationVkClient(options: RegisterWorkflowRoutesOptions) {
  if (options.vkClient?.getExecutionProcessFinalMessage && options.vkClient.getExecutionProcessRepoStates) {
    return {
      getExecutionProcessFinalMessage: options.vkClient.getExecutionProcessFinalMessage,
      getExecutionProcessRepoStates: options.vkClient.getExecutionProcessRepoStates,
    };
  }
  return undefined;
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

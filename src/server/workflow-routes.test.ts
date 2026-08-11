import { createHmac } from 'node:crypto';
import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWorkflowRegistry, type WorkflowDefinition } from '@vibe-dashboard/workflow-core';
import { registerWorkflowRoutes } from './workflow-routes';
import { initVdDb, type VdDbHandle } from './database';
import { DbWorkflowRunRecorder } from './workflow-run-recorder';
import { DbWorkflowRunReader } from './workflow-run-store';
import { DbWorkflowOrchestrationStore } from './workflow-orchestration-store';
import { DbDeclarativeWorkflowDefinitionStore } from './declarative-workflow-definition-store';
import { DbWorkflowWebhookInboxStore, WorkflowWebhookWakeup, signVkWebhookPayload } from './workflow-webhook-inbox';
import { DbWorkflowWebhookProvisioningStore } from './workflow-webhook-provisioning-store';
import { DbWorkflowDesignStore } from '../modules/plugins/workflows/server/workflowDesignStore';

describe('registerWorkflowRoutes', () => {
  const dbHandles: VdDbHandle[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const handle of dbHandles.splice(0)) {
      await handle.db.destroy();
      handle.sqlite.close();
    }
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

  it('returns workspace workflows home read model scoped to workspace', async () => {
    const handle = await initVdDb({ path: ':memory:' });
    dbHandles.push(handle);
    const app = new Hono();
    const designStore = new DbWorkflowDesignStore({ db: handle.db });
    await designStore.createDesign({ designId: 'design-home', draftId: 'draft-home', name: 'Home Workflow', definition: routeValidDefinition() });
    await designStore.publishDraft('draft-home');
    await designStore.createRunSnapshot({ runSnapshotId: 'snapshot-home-a', designId: 'design-home', workspaceId: 'workspace-a', runInput: {}, roleBindings: {} });
    await handle.db.insertInto('WorkflowPersistedRun').values({
      runId: 'run-home-a',
      runSnapshotId: 'snapshot-home-a',
      designId: 'design-home',
      designVersion: 1,
      workspaceId: 'workspace-a',
      status: 'completed',
      coreModelJson: JSON.stringify({ name: 'Home Workflow' }),
      coreSnapshotJson: '{}',
      roleBindingsJson: '{}',
      pendingEffectJson: null,
      queuedTurnsJson: '{}',
      eventsJson: '[]',
      errorJson: null,
      createdAt: 1,
      updatedAt: 2,
    }).execute();
    registerWorkflowRoutes(app, { registry: createWorkflowRegistry(), workflowHomeDb: handle.db, workflowDesignStore: designStore });

    const response = await app.request('/dashboard/api/workflows/home?workspaceId=workspace-a');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      home: {
        workspaceId: 'workspace-a',
        availableWorkflows: [{ id: 'design-home', title: 'Home Workflow', status: 'ready' }],
        recentRuns: [{ runId: 'run-home-a', workflowName: 'Home Workflow', detailUrl: null }],
        needsInput: [],
      },
    });
  });

  it('TEST_CASE_M95_1A launches a persisted workflow with required inputs and existing sessions', async () => {
    const handle = await initVdDb({ path: ':memory:' });
    dbHandles.push(handle);
    const app = new Hono();
    const designStore = new DbWorkflowDesignStore({ db: handle.db });
    await designStore.createDesign({ designId: 'design-launch', draftId: 'draft-launch', name: 'Launch Workflow', definition: routeLaunchDefinition() });
    await designStore.publishDraft('draft-launch');
    const sessions = [
      vkSession('session-dev', 'workspace-a', 'Dev'),
      vkSession('session-review', 'workspace-a', 'Review'),
    ];
    const queued: Array<{ sessionId: string; prompt: string }> = [];
    registerWorkflowRoutes(app, {
      registry: createWorkflowRegistry(),
      workflowHomeDb: handle.db,
      workflowDesignStore: designStore,
      vkClient: {
        getSessions: async () => sessions,
        getSession: async (sessionId) => {
          const session = sessions.find((candidate) => candidate.id === sessionId);
          if (!session) throw new Error('session not found');
          return session;
        },
        createSession: async () => { throw new Error('should not create session'); },
        queueFollowUp: async (sessionId, prompt) => {
          queued.push({ sessionId, prompt });
          return { queued_item: { id: `queue-${queued.length}`, session_id: sessionId, workspace_id: 'workspace-a', status: 'queued', source: 'workflow', priority: 0, data: { message: prompt } }, status: { count: 1, message: null, messages: [], status: 'queued' } };
        },
      },
    });

    const missing = await app.request('/dashboard/api/workflows/launch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: 'workspace-a', designId: 'design-launch', inputs: {}, roleBindings: {} }),
    });
    expect(missing.status).toBe(400);
    await expect(missing.json()).resolves.toMatchObject({ fieldErrors: { featureRequest: 'This field is required.' } });

    const launched = await app.request('/dashboard/api/workflows/launch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceId: 'workspace-a',
        designId: 'design-launch',
        inputs: { featureRequest: 'Build launch flow' },
        additionalInstructions: 'Keep it clean.',
        roleBindings: { dev: { mode: 'existing', sessionId: 'session-dev' }, review: { mode: 'existing', sessionId: 'session-review' } },
      }),
    });

    expect(launched.status).toBe(201);
    const payload = await launched.json();
    expect(payload).toMatchObject({ run: { workspaceId: 'workspace-a', status: 'running', detailUrl: null }, home: { recentRuns: [{ workflowName: 'Launch Workflow', detailUrl: null }] } });
    expect(queued).toMatchObject([{ sessionId: 'session-dev' }]);
    expect(JSON.stringify(await designStore.getDesign('design-launch'))).not.toContain('session-dev');
    const runRow = await handle.db.selectFrom('WorkflowPersistedRun').selectAll().executeTakeFirstOrThrow();
    expect(JSON.parse(runRow.roleBindingsJson)).toMatchObject({ dev: { sessionId: 'session-dev' }, review: { sessionId: 'session-review' } });
  });

  it('TEST_CASE_M95_1B creates or reuses launch sessions by role name and rejects workspace mismatches', async () => {
    const handle = await initVdDb({ path: ':memory:' });
    dbHandles.push(handle);
    const app = new Hono();
    const designStore = new DbWorkflowDesignStore({ db: handle.db });
    await designStore.createDesign({ designId: 'design-create-session', draftId: 'draft-create-session', name: 'Session Workflow', definition: routeLaunchDefinition() });
    await designStore.publishDraft('draft-create-session');
    const sessions = [
      vkSession('session-review-reuse', 'workspace-a', 'Review'),
      vkSession('session-other-workspace', 'workspace-b', 'Dev'),
    ];
    const created: string[] = [];
    registerWorkflowRoutes(app, {
      registry: createWorkflowRegistry(),
      workflowHomeDb: handle.db,
      workflowDesignStore: designStore,
      vkClient: {
        getSessions: async (workspaceId) => sessions.filter((session) => session.workspace_id === workspaceId),
        getSession: async (sessionId) => {
          const session = sessions.find((candidate) => candidate.id === sessionId);
          if (!session) throw new Error('session not found');
          return session;
        },
        createSession: async (body) => {
          created.push(body.name ?? '');
          const session = vkSession(`session-created-${created.length}`, body.workspace_id, body.name ?? null);
          sessions.push(session);
          return session;
        },
        queueFollowUp: async (sessionId, prompt) => ({ queued_item: { id: `queue-${sessionId}`, session_id: sessionId, workspace_id: 'workspace-a', status: 'queued', source: 'workflow', priority: 0, data: { message: prompt } }, status: { count: 1, message: null, messages: [], status: 'queued' } }),
      },
    });

    const mismatch = await app.request('/dashboard/api/workflows/launch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceId: 'workspace-a',
        designId: 'design-create-session',
        inputs: { featureRequest: 'Build launch flow' },
        roleBindings: { dev: { mode: 'existing', sessionId: 'session-other-workspace' }, review: { mode: 'create_or_reuse', name: 'Review' } },
      }),
    });
    expect(mismatch.status).toBe(400);
    await expect(mismatch.json()).resolves.toMatchObject({ message: 'Dev session belongs to another workspace.', fieldErrors: { 'role.dev': 'Dev session belongs to another workspace.' } });

    const launched = await app.request('/dashboard/api/workflows/launch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceId: 'workspace-a',
        designId: 'design-create-session',
        inputs: { featureRequest: 'Build launch flow' },
        roleBindings: { dev: { mode: 'create_or_reuse', name: 'Dev' }, review: { mode: 'create_or_reuse', name: 'Review' } },
      }),
    });
    expect(launched.status).toBe(201);
    expect(created).toEqual(['Dev']);
    const runRow = await handle.db.selectFrom('WorkflowPersistedRun').selectAll().executeTakeFirstOrThrow();
    expect(JSON.parse(runRow.roleBindingsJson)).toMatchObject({ dev: { sessionId: 'session-created-1' }, review: { sessionId: 'session-review-reuse' } });
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

  it('persists manual workflow route runs through the configured recorder', async () => {
    const registry = createWorkflowRegistry();
    registry.register({
      id: 'persisted',
      trigger: 'manual',
      run: async (ctx, input) => {
        ctx.log('persist', 'persisting output');
        return { ok: true, input };
      },
    });
    const handle = await initVdDb({ path: ':memory:' });
    dbHandles.push(handle);
    const app = new Hono();
    registerWorkflowRoutes(app, {
      registry,
      workflowRunRecorder: new DbWorkflowRunRecorder({ db: handle.db }),
      runOptions: {
        createRunId: () => 'run_route_persisted',
        now: (() => {
          let value = 20;
          return () => value++;
        })(),
      },
    });

    const response = await app.request('/dashboard/api/workflows/persisted/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 'stored' }),
    });

    expect(response.status).toBe(200);
    const persisted = await handle.db
      .selectFrom('WorkflowRun')
      .selectAll()
      .where('runId', '=', 'run_route_persisted')
      .executeTakeFirstOrThrow();
    expect(persisted).toMatchObject({ workflowId: 'persisted', status: 'completed' });
    expect(JSON.parse(persisted.inputJson)).toEqual({ value: 'stored' });
  });

  it('exposes read-only workflow run list/get/events APIs', async () => {
    const registry = createWorkflowRegistry();
    registry.register({
      id: 'inspectable',
      trigger: 'manual',
      run: async (ctx, input) => {
        ctx.log('inspect', 'inspectable event', 'info', { authorization: 'Bearer secret' });
        return { outcome: 'message_queued', workspaceId: 'ws-read', sessionId: 'session-read', queueItemId: 'queue-read', input };
      },
    });
    const handle = await initVdDb({ path: ':memory:' });
    dbHandles.push(handle);
    const app = new Hono();
    registerWorkflowRoutes(app, {
      registry,
      workflowRunRecorder: new DbWorkflowRunRecorder({ db: handle.db }),
      workflowRunReader: new DbWorkflowRunReader({ db: handle.db }),
      runOptions: {
        createRunId: () => 'run_read',
        now: (() => {
          let value = 30;
          return () => value++;
        })(),
      },
    });

    await app.request('/dashboard/api/workflows/inspectable/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'ghp_secret' }),
    });

    const listResponse = await app.request('/dashboard/api/workflow-runs?workflowId=inspectable&status=completed&vkQueueItemId=queue-read&limit=1');
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toMatchObject({
      runs: [{
        runId: 'run_read',
        workflowId: 'inspectable',
        status: 'completed',
        input: { token: '[REDACTED]' },
        vkWorkspaceId: 'ws-read',
        vkSessionId: 'session-read',
        vkQueueItemId: 'queue-read',
      }],
      limit: 1,
      offset: 0,
      hasMore: false,
    });

    const getResponse = await app.request('/dashboard/api/workflow-runs/run_read');
    expect(getResponse.status).toBe(200);
    await expect(getResponse.json()).resolves.toMatchObject({
      run: { runId: 'run_read', output: { queueItemId: 'queue-read' } },
    });

    const eventsResponse = await app.request('/dashboard/api/workflow-runs/run_read/events?limit=2');
    expect(eventsResponse.status).toBe(200);
    await expect(eventsResponse.json()).resolves.toMatchObject({
      events: [
        { eventType: 'run_started' },
        { eventType: 'step_log', data: { authorization: '[REDACTED]' } },
      ],
      limit: 2,
      offset: 0,
      hasMore: true,
    });
  });

  it('returns 404 for missing workflow run inspection endpoints', async () => {
    const handle = await initVdDb({ path: ':memory:' });
    dbHandles.push(handle);
    const app = new Hono();
    registerWorkflowRoutes(app, {
      registry: createWorkflowRegistry(),
      workflowRunReader: new DbWorkflowRunReader({ db: handle.db }),
    });

    const runResponse = await app.request('/dashboard/api/workflow-runs/missing');
    expect(runResponse.status).toBe(404);
    await expect(runResponse.json()).resolves.toEqual({ error: 'workflow_run_not_found' });

    const eventsResponse = await app.request('/dashboard/api/workflow-runs/missing/events');
    expect(eventsResponse.status).toBe(404);
    await expect(eventsResponse.json()).resolves.toEqual({ error: 'workflow_run_not_found' });
  });



  it('resolves team role sessions through configured resolver', async () => {
    const app = new Hono();
    const resolver = {
      resolve: vi.fn(async () => ({
        ok: true,
        results: [{ roleId: 'agent-a', roleName: 'orchestrator', status: 'resolved', sessionId: 'session-a', workspaceId: 'ws-1', laneId: null, executor: 'CODEX', source: 'auto_created', bindingId: 'binding-a', warnings: [], error: null }],
        errors: [],
        warnings: [],
      })),
    };
    registerWorkflowRoutes(app, {
      registry: createWorkflowRegistry(),
      roleSessionResolver: resolver as never,
    });

    const response = await app.request('/dashboard/api/agent-team-session-mappings/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ team: { id: 'team-1', agents: [] }, workspaceId: 'ws-1', roleIds: ['agent-a'], allowAutoCreate: true }),
    });

    expect(response.status).toBe(200);
    expect(resolver.resolve).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'ws-1', roleIds: ['agent-a'], allowAutoCreate: true }));
    await expect(response.json()).resolves.toMatchObject({ ok: true, results: [{ sessionId: 'session-a' }] });
  });

  it('returns 503 when role session resolver is not configured', async () => {
    const app = new Hono();
    registerWorkflowRoutes(app, { registry: createWorkflowRegistry() });

    const response = await app.request('/dashboard/api/agent-team-session-mappings/resolve', { method: 'POST' });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'role_session_resolver_not_configured' });
  });

  it('exposes workflow activity scanner read API with explicit policy', async () => {
    const app = new Hono();
    const scanner = {
      scanOnce: vi.fn(async () => ({
        generatedAt: 1000,
        vkGeneratedAt: '2026-08-04T00:00:00.000Z',
        callbackStateAvailable: false,
        sessions: [{
          workspaceId: 'ws-activity',
          sessionId: 'session-activity',
          roleId: 'role-a',
          roleName: 'agent',
          laneId: null,
          instanceId: null,
          stepStateId: null,
          triggerId: null,
          bindingId: 'binding-a',
          externalWaitId: null,
          classification: 'running',
          reason: 'VK activity reports running execution',
          ownsWorkflowSession: true,
          consumesExecutionBudget: true,
          eligibleForUnrelatedWork: false,
          queueCount: 0,
          runningExecutionProcessIds: ['exec-a'],
          completedResponse: null,
          executionProcess: null,
          updatedAt: 999,
          warnings: [],
        }],
        budget: {
          maxActiveExecutions: 4,
          activeExecutionCount: 1,
          availableExecutionSlots: 3,
          maxWorkflowOwnedSessions: 7,
          workflowOwnedSessionCount: 1,
          availableWorkflowOwnedSessionSlots: 6,
          vkQueuedCount: 0,
          eligibleSessionCount: 0,
          blockedSessionCount: 1,
          eligibleSessions: [],
        },
        warnings: [],
      })),
    };
    registerWorkflowRoutes(app, {
      registry: createWorkflowRegistry(),
      workflowActivityScanner: scanner as never,
    });

    const response = await app.request('/dashboard/api/workflow-activity?maxActiveExecutions=4&maxWorkflowOwnedSessions=7');

    expect(response.status).toBe(200);
    expect(scanner.scanOnce).toHaveBeenCalledWith({ maxActiveExecutions: 4, maxWorkflowOwnedSessions: 7 });
    await expect(response.json()).resolves.toMatchObject({
      sessions: [{ sessionId: 'session-activity', classification: 'running' }],
      callbackStateAvailable: false,
    });
  });

  it('returns 503 when workflow activity scanner is not configured', async () => {
    const app = new Hono();
    registerWorkflowRoutes(app, { registry: createWorkflowRegistry() });

    const response = await app.request('/dashboard/api/workflow-activity');

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'workflow_activity_scanner_not_configured' });
  });

  it('exposes read-only workflow orchestration instance and trigger APIs', async () => {
    const handle = await initVdDb({ path: ':memory:' });
    dbHandles.push(handle);
    const store = new DbWorkflowOrchestrationStore({ db: handle.db, now: (() => { let value = 1000; return () => value++; })() });
    await store.createInstance({
      instanceId: 'instance_route',
      workflowId: 'durable-workflow',
      teamId: 'team-route',
      laneId: 'lane-route',
      trigger: 'manual',
      input: { task: 'inspect' },
    });
    await store.startInstance('instance_route');
    await store.createScopedTrigger({
      triggerId: 'trigger_route',
      instanceId: 'instance_route',
      workspaceId: 'ws-route',
      sessionId: 'session-route',
      mode: 'next_completion_after_cursor',
      cursorExecutionProcessId: 'exec-before',
    });

    const app = new Hono();
    registerWorkflowRoutes(app, {
      registry: createWorkflowRegistry(),
      workflowOrchestrationStore: store,
    });

    const listResponse = await app.request('/dashboard/api/workflow-instances?workflowId=durable-workflow&status=running&teamId=team-route&limit=1');
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toMatchObject({
      instances: [{ instanceId: 'instance_route', status: 'running', input: { task: 'inspect' } }],
      limit: 1,
      offset: 0,
      hasMore: false,
    });

    const getResponse = await app.request('/dashboard/api/workflow-instances/instance_route');
    expect(getResponse.status).toBe(200);
    await expect(getResponse.json()).resolves.toMatchObject({
      instance: { instanceId: 'instance_route', workflowId: 'durable-workflow' },
    });

    const triggerListResponse = await app.request('/dashboard/api/workflow-scoped-triggers?instanceId=instance_route&status=active&workspaceId=ws-route');
    expect(triggerListResponse.status).toBe(200);
    await expect(triggerListResponse.json()).resolves.toMatchObject({
      triggers: [{ triggerId: 'trigger_route', sessionId: 'session-route', mode: 'next_completion_after_cursor' }],
    });

    const triggerGetResponse = await app.request('/dashboard/api/workflow-scoped-triggers/trigger_route');
    expect(triggerGetResponse.status).toBe(200);
    await expect(triggerGetResponse.json()).resolves.toMatchObject({
      trigger: { triggerId: 'trigger_route', cursorExecutionProcessId: 'exec-before' },
    });
  });

  it('exposes workflow attention feed and completion APIs for human-turn form submissions', async () => {
    const handle = await initVdDb({ path: ':memory:' });
    dbHandles.push(handle);
    const store = new DbWorkflowOrchestrationStore({ db: handle.db, now: (() => { let value = 5000; return () => value++; })() });
    await store.createInstance({
      instanceId: 'instance_attention',
      workflowId: 'human-workflow',
      teamId: 'team-route',
      laneId: 'lane-route',
      trigger: 'manual',
      input: { task: 'needs approval' },
    });
    await store.createStepState({
      id: 'step_human',
      instanceId: 'instance_attention',
      stepKey: 'human_approval',
    });
    await store.startInstance('instance_attention', { currentStepId: 'human_approval' });
    await store.markStepRunning('step_human');
    await store.createHumanAttention({
      attentionItemId: 'attention_route',
      instanceId: 'instance_attention',
      stepStateId: 'step_human',
      stepKey: 'human_approval',
      stateId: 'waiting_for_user',
      stateVisitId: 'visit_route',
      idempotencyKey: 'instance_attention:visit_route:human_approval',
      title: 'Answer planning questions',
      presentationUrl: '/dashboard/workflows/instance_attention',
      formRef: 'beads-form://vibe-kanban-vscode-web/attention_route',
      formSchema: { fields: { approved: { required: true } } },
    });

    const app = new Hono();
    registerWorkflowRoutes(app, {
      registry: createWorkflowRegistry(),
      workflowOrchestrationStore: store,
    });

    const listResponse = await app.request('/dashboard/api/workflow-attention-items?status=active&teamId=team-route&limit=1');
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toMatchObject({
      items: [{
        attentionItemId: 'attention_route',
        status: 'active',
        kind: 'human_turn',
        title: 'Answer planning questions',
        presentationUrl: '/dashboard/workflows/instance_attention',
        formRef: 'beads-form://vibe-kanban-vscode-web/attention_route',
      }],
      hasMore: false,
    });

    const invalidResponse = await app.request('/dashboard/api/workflow-attention-items/attention_route/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stateVisitId: 'visit_route', submission: {} }),
    });
    expect(invalidResponse.status).toBe(400);
    await expect(invalidResponse.json()).resolves.toMatchObject({
      result: {
        applied: false,
        reason: 'invalid_submission',
        validationErrors: [{ path: 'submission.approved' }],
      },
    });

    const completeResponse = await app.request('/dashboard/api/workflow-attention-items/attention_route/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stateVisitId: 'visit_route', submission: { approved: true, remarks: 'Ship it.' } }),
    });
    expect(completeResponse.status).toBe(200);
    await expect(completeResponse.json()).resolves.toMatchObject({
      result: {
        applied: true,
        reason: 'applied',
        attention: { status: 'resolved' },
        instance: { status: 'running' },
      },
    });

    const getResponse = await app.request('/dashboard/api/workflow-attention-items/attention_route');
    expect(getResponse.status).toBe(200);
    await expect(getResponse.json()).resolves.toMatchObject({
      item: {
        status: 'resolved',
        resolution: { submission: { approved: true, remarks: 'Ship it.' } },
      },
    });
  });

  it('exposes a clean workflow presentation read model', async () => {
    const handle = await initVdDb({ path: ':memory:' });
    dbHandles.push(handle);
    const store = new DbWorkflowOrchestrationStore({ db: handle.db, now: (() => { let value = 6000; return () => value++; })() });
    await store.createInstance({
      instanceId: 'instance_presentation',
      workflowId: 'two-agent-review-round',
      trigger: 'manual',
      input: { task: 'show clean story' },
      state: { definition: { name: 'Two agent review round' } },
    });
    await store.startInstance('instance_presentation');
    await store.createStepState({ id: 'ask_source_presentation', instanceId: 'instance_presentation', stepKey: 'ask_source', status: 'completed', input: { template: 'Implement {{inputs.task}}' }, output: { workspaceId: 'ws-source', sessionId: 'session-source' } });
    await store.createStepState({ id: 'wait_source_presentation', instanceId: 'instance_presentation', stepKey: 'wait_source', status: 'completed', output: { executionProcessId: 'exec-source', workspaceId: 'ws-source', sessionId: 'session-source' } });
    await store.createStepState({ id: 'ask_review_presentation', instanceId: 'instance_presentation', stepKey: 'ask_review', status: 'completed', input: { template: 'Review {{source.response}}' }, output: { workspaceId: 'ws-review', sessionId: 'session-review' } });
    await store.createStepState({ id: 'wait_review_presentation', instanceId: 'instance_presentation', stepKey: 'wait_review', status: 'completed', output: { executionProcessId: 'exec-review', workspaceId: 'ws-review', sessionId: 'session-review' } });
    await store.completeInstance('instance_presentation');

    const app = new Hono();
    registerWorkflowRoutes(app, {
      registry: createWorkflowRegistry(),
      workflowOrchestrationStore: store,
      vkClient: {
        getExecutionProcessFinalMessage: async (processId) => ({
          execution_process_id: processId,
          session_id: processId === 'exec-source' ? 'session-source' : 'session-review',
          workspace_id: processId === 'exec-source' ? 'ws-source' : 'ws-review',
          status: 'completed',
          completed_at: '2026-08-11T00:00:00Z',
          coding_agent_turn_id: null,
          agent_session_id: null,
          agent_message_id: null,
          content: processId === 'exec-source' ? 'Implemented.' : 'Approved.',
          truncated: false,
          max_chars: 20_000,
          source_kind: 'coding_agent_turn_summary',
          prompt_preview: null,
          prompt_truncated: false,
          prompt_max_chars: 4096,
          prompt_source_kind: 'coding_agent_turn_prompt',
        }),
        getExecutionProcessRepoStates: async () => [],
      },
    });

    const response = await app.request('/dashboard/api/workflow-instances/instance_presentation/presentation');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      presentation: {
        workflowName: 'Two agent review round',
        originalTask: 'show clean story',
        status: 'completed',
        timeline: [
          { role: 'Implementer', initialMessage: { text: 'Implement show clean story' }, finalResponse: { text: 'Implemented.' } },
          { role: 'Reviewer', initialMessage: { text: 'Review Implementer response included above.' }, finalResponse: { text: 'Approved.' } },
        ],
      },
    });
  });

  it('returns 404 for missing workflow orchestration inspection endpoints', async () => {
    const handle = await initVdDb({ path: ':memory:' });
    dbHandles.push(handle);
    const app = new Hono();
    registerWorkflowRoutes(app, {
      registry: createWorkflowRegistry(),
      workflowOrchestrationStore: new DbWorkflowOrchestrationStore({ db: handle.db }),
    });

    const instanceResponse = await app.request('/dashboard/api/workflow-instances/missing');
    expect(instanceResponse.status).toBe(404);
    await expect(instanceResponse.json()).resolves.toEqual({ error: 'workflow_instance_not_found' });

    const triggerResponse = await app.request('/dashboard/api/workflow-scoped-triggers/missing');
    expect(triggerResponse.status).toBe(404);
    await expect(triggerResponse.json()).resolves.toEqual({ error: 'workflow_scoped_trigger_not_found' });

    const attentionResponse = await app.request('/dashboard/api/workflow-attention-items/missing');
    expect(attentionResponse.status).toBe(404);
    await expect(attentionResponse.json()).resolves.toEqual({ error: 'workflow_attention_item_not_found' });

    const presentationResponse = await app.request('/dashboard/api/workflow-instances/missing/presentation');
    expect(presentationResponse.status).toBe(404);
    await expect(presentationResponse.json()).resolves.toEqual({ error: 'workflow_presentation_not_found', message: 'Workflow not found' });
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

  it('refreshes repo aliases and retries once when no workspace matches', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const registry = createWorkflowRegistry();
    registry.register({
      id: 'github-ci-failure',
      trigger: 'github.workflow_run',
      run: async (_ctx, input) => {
        const repoAliases = (input as { repoAliases?: Array<{ aliases: string[] }> }).repoAliases ?? [];
        const matched = repoAliases.some((repo) => repo.aliases.includes('owner/repo'));
        return matched
          ? { outcome: 'message_sent', input }
          : { outcome: 'no_matching_workspace', input };
      },
    });
    const app = new Hono();
    const refresh = vi.fn(async () => [{ name: 'local-repo', aliases: ['owner/repo'] }]);
    registerWorkflowRoutes(app, {
      registry,
      githubWebhookSecret: 'secret',
      repoAliasCache: {
        get: () => [{ name: 'local-repo', aliases: [] }],
        set: () => {},
        refresh,
      },
      runOptions: {
        createRunId: (() => {
          let index = 0;
          return () => ['run_initial', 'run_retry'][index++] ?? 'run_extra';
        })(),
        now: (() => {
          let value = 50;
          return () => value++;
        })(),
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
        runId: 'run_retry',
        output: {
          outcome: 'message_sent',
          input: {
            repoAliases: [{ name: 'local-repo', aliases: ['owner/repo'] }],
          },
        },
      },
    });
    expect(refresh).toHaveBeenCalledOnce();
    expect(infoSpy).toHaveBeenCalledWith(
      'Retrying GitHub webhook workflow after refreshing repo aliases',
      {
        delivery: 'delivery-123',
        event: 'workflow_run',
      },
    );
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

  it('starts declarative workflows through submit-and-return route', async () => {
    const runtime = {
      start: vi.fn(async () => ({
        instance: { instanceId: 'instance-api', status: 'waiting' },
        queuedSource: { queueItemId: 'queue-api' },
      })),
      runOnce: vi.fn(),
    };
    const app = new Hono();
    registerWorkflowRoutes(app, {
      registry: createWorkflowRegistry(),
      declarativeWorkflowRuntime: runtime as never,
    });

    const response = await app.request('/dashboard/api/declarative-workflows/two-agent-review-round/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: { task: 'Plan', workspaceId: 'ws-1' }, team: { id: 'team-1', agents: [] }, instanceId: 'instance-api' }),
    });

    expect(response.status).toBe(202);
    expect(runtime.start).toHaveBeenCalledWith(expect.objectContaining({
      input: { task: 'Plan', workspaceId: 'ws-1' },
      team: { id: 'team-1', agents: [] },
      instanceId: 'instance-api',
    }));
    await expect(response.json()).resolves.toMatchObject({ result: { instance: { instanceId: 'instance-api' } } });
  });

  it('starts declarative workflows from a custom definition body when ids match', async () => {
    const runtime = {
      start: vi.fn(async () => ({
        instance: { instanceId: 'instance-custom', status: 'waiting' },
        queuedSource: { queueItemId: 'queue-custom' },
      })),
      runOnce: vi.fn(),
    };
    const app = new Hono();
    registerWorkflowRoutes(app, {
      registry: createWorkflowRegistry(),
      declarativeWorkflowRuntime: runtime as never,
    });
    const definition = customDefinition('custom-review-round');

    const response = await app.request('/dashboard/api/declarative-workflows/custom-review-round/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        definition,
        input: { task: 'Plan', workspaceId: 'ws-1' },
        team: { id: 'team-1', agents: [] },
      }),
    });

    expect(response.status).toBe(202);
    expect(runtime.start).toHaveBeenCalledWith(expect.objectContaining({
      definition: expect.objectContaining({ id: 'custom-review-round', name: 'Custom review round' }),
    }));
  });

  it('rejects custom declarative definition bodies with a mismatched workflow id', async () => {
    const runtime = { start: vi.fn(), runOnce: vi.fn() };
    const app = new Hono();
    registerWorkflowRoutes(app, {
      registry: createWorkflowRegistry(),
      declarativeWorkflowRuntime: runtime as never,
    });

    const response = await app.request('/dashboard/api/declarative-workflows/requested-id/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        definition: customDefinition('other-id'),
        input: { task: 'Plan', workspaceId: 'ws-1' },
        team: { id: 'team-1', agents: [] },
      }),
    });

    expect(response.status).toBe(400);
    expect(runtime.start).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining('does not match requested workflow id') });
  });

  it('runs declarative workflows from the DB definition registry when no body definition is supplied', async () => {
    const handle = await initVdDb({ path: ':memory:' });
    dbHandles.push(handle);
    const definitionStore = new DbDeclarativeWorkflowDefinitionStore({ db: handle.db });
    await definitionStore.saveDefinition({ definition: customDefinition('db-review-round') });
    const runtime = {
      start: vi.fn(async () => ({
        instance: { instanceId: 'instance-db', status: 'waiting' },
        queuedSource: { queueItemId: 'queue-db' },
      })),
      runOnce: vi.fn(async () => ({ resumed: [], completed: [], skipped: [], errors: [] })),
    };
    const app = new Hono();
    registerWorkflowRoutes(app, {
      registry: createWorkflowRegistry(),
      declarativeWorkflowRuntime: runtime as never,
      declarativeWorkflowDefinitionStore: definitionStore,
    });

    const response = await app.request('/dashboard/api/declarative-workflows/db-review-round/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: { task: 'Plan', workspaceId: 'ws-1' }, team: { id: 'team-1', agents: [] } }),
    });

    expect(response.status).toBe(202);
    expect(runtime.start).toHaveBeenCalledWith(expect.objectContaining({
      definition: expect.objectContaining({ id: 'db-review-round' }),
    }));
  });

  it('exposes declarative workflow definition catalog APIs with built-in fallback and disabled DB definitions', async () => {
    const handle = await initVdDb({ path: ':memory:' });
    dbHandles.push(handle);
    const definitionStore = new DbDeclarativeWorkflowDefinitionStore({ db: handle.db });
    await definitionStore.saveDefinition({ definition: customDefinition('catalog-round') });
    const app = new Hono();
    registerWorkflowRoutes(app, {
      registry: createWorkflowRegistry(),
      declarativeWorkflowDefinitionStore: definitionStore,
    });

    const list = await app.request('/dashboard/api/declarative-workflow-definitions');
    expect(list.status).toBe(200);
    await expect(list.json()).resolves.toMatchObject({
      definitions: expect.arrayContaining([
        expect.objectContaining({ definitionId: 'catalog-round', source: 'db', status: 'active' }),
        expect.objectContaining({ definitionId: 'two-agent-review-round', source: 'built_in', status: 'active' }),
      ]),
    });

    const get = await app.request('/dashboard/api/declarative-workflow-definitions/catalog-round');
    expect(get.status).toBe(200);
    await expect(get.json()).resolves.toMatchObject({ definition: { definitionId: 'catalog-round', definition: { id: 'catalog-round' } } });

    const disabled = await app.request('/dashboard/api/declarative-workflow-definitions/catalog-round', { method: 'DELETE' });
    expect(disabled.status).toBe(200);
    await expect(disabled.json()).resolves.toMatchObject({ definition: { definitionId: 'catalog-round', status: 'disabled' } });

    const missingDisabled = await app.request('/dashboard/api/declarative-workflow-definitions/catalog-round');
    expect(missingDisabled.status).toBe(404);
    const includeDisabled = await app.request('/dashboard/api/declarative-workflow-definitions/catalog-round?includeDisabled=true');
    expect(includeDisabled.status).toBe(200);
    await expect(includeDisabled.json()).resolves.toMatchObject({ definition: { status: 'disabled' } });
  });

  it('runs declarative workflow run-once and exposes instance status details', async () => {
    const handle = await initVdDb({ path: ':memory:' });
    dbHandles.push(handle);
    const store = new DbWorkflowOrchestrationStore({ db: handle.db });
    await store.createInstance({ instanceId: 'instance-status', workflowId: 'two-agent-review-round', trigger: 'manual' });
    await store.createStepState({ id: 'instance-status_step', instanceId: 'instance-status', stepKey: 'resolve_sessions' });
    const runtime = { start: vi.fn(), runOnce: vi.fn(async () => ({ resumed: [], completed: [{ instanceId: 'instance-status' }], skipped: [], errors: [] })) };
    const app = new Hono();
    registerWorkflowRoutes(app, {
      registry: createWorkflowRegistry(),
      workflowOrchestrationStore: store,
      declarativeWorkflowRuntime: runtime as never,
    });

    const runOnce = await app.request('/dashboard/api/declarative-workflows/two-agent-review-round/run-once', { method: 'POST' });
    expect(runOnce.status).toBe(200);
    await expect(runOnce.json()).resolves.toMatchObject({ result: { completed: [{ instanceId: 'instance-status' }] } });

    const status = await app.request('/dashboard/api/workflow-instances/instance-status/status');
    expect(status.status).toBe(200);
    await expect(status.json()).resolves.toMatchObject({
      instance: { instanceId: 'instance-status' },
      steps: [{ stepKey: 'resolve_sessions' }],
      triggers: [],
    });
  });

  it('accepts valid VK workflow webhooks, stores inbox refs, and wakes runReady once', async () => {
    const handle = await initVdDb({ path: ':memory:' });
    dbHandles.push(handle);
    const inboxStore = new DbWorkflowWebhookInboxStore({ db: handle.db, createId: () => 'inbox-route-1', now: () => 10 });
    const wakeup = { trigger: vi.fn(async () => ({ started: true, queued: false })) };
    const app = new Hono();
    registerWorkflowRoutes(app, {
      registry: createWorkflowRegistry(),
      workflowWebhookInboxStore: inboxStore,
      workflowWebhookWakeup: wakeup,
      vkWorkflowWebhookSecret: 'secret',
    });
    const body = JSON.stringify(vkWebhookPayload());
    const response = await app.request('/dashboard/api/workflow-webhooks/vk', {
      method: 'POST',
      headers: signedVkWebhookHeaders('secret', body),
      body,
    });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({ accepted: true, duplicate: false, wakeup: { started: true } });
    expect(wakeup.trigger).toHaveBeenCalledTimes(1);
    const rows = await inboxStore.listEvents();
    expect(rows.events).toHaveLength(1);
    expect(rows.events[0]).toMatchObject({ inboxId: 'inbox-route-1', status: 'processed', executionProcessId: 'exec-1' });
    expect(JSON.stringify(rows.events[0]?.payload)).not.toContain('full notification message');
  });

  it('accepts execution.killed VK workflow webhooks and stores killed status', async () => {
    const handle = await initVdDb({ path: ':memory:' });
    dbHandles.push(handle);
    const inboxStore = new DbWorkflowWebhookInboxStore({ db: handle.db, createId: () => 'inbox-route-killed', now: () => 12 });
    const wakeup = { trigger: vi.fn(async () => ({ started: true, queued: false })) };
    const app = new Hono();
    registerWorkflowRoutes(app, {
      registry: createWorkflowRegistry(),
      workflowWebhookInboxStore: inboxStore,
      workflowWebhookWakeup: wakeup,
      vkWorkflowWebhookSecret: 'secret',
    });
    const body = JSON.stringify(vkWebhookPayload({ event_type: 'execution.killed', delivery_id: 'delivery-route-killed' }));
    const response = await app.request('/dashboard/api/workflow-webhooks/vk', {
      method: 'POST',
      headers: signedVkWebhookHeaders('secret', body),
      body,
    });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      accepted: true,
      duplicate: false,
      inbox: { status: 'processed', eventType: 'execution.killed', eventStatus: 'killed' },
    });
    expect(wakeup.trigger).toHaveBeenCalledTimes(1);
  });

  it('coalesces overlapping non-duplicate VK webhook wakeups into a follow-up runReady pass', async () => {
    const handle = await initVdDb({ path: ':memory:' });
    dbHandles.push(handle);
    let id = 0;
    const inboxStore = new DbWorkflowWebhookInboxStore({ db: handle.db, createId: () => `inbox-route-overlap-${++id}`, now: () => 20 + id });
    const releases: Array<() => void> = [];
    const runReady = vi.fn(async () => {
      await new Promise<void>((resolve) => { releases.push(resolve); });
    });
    const wakeup = new WorkflowWebhookWakeup(runReady);
    const app = new Hono();
    registerWorkflowRoutes(app, {
      registry: createWorkflowRegistry(),
      workflowWebhookInboxStore: inboxStore,
      workflowWebhookWakeup: wakeup,
      vkWorkflowWebhookSecret: 'secret',
    });
    const bodyA = JSON.stringify(vkWebhookPayload({ delivery_id: 'delivery-route-overlap-a', execution_id: 'exec-overlap-a' }));
    const bodyB = JSON.stringify(vkWebhookPayload({ delivery_id: 'delivery-route-overlap-b', execution_id: 'exec-overlap-b' }));

    const first = app.request('/dashboard/api/workflow-webhooks/vk', { method: 'POST', headers: signedVkWebhookHeaders('secret', bodyA), body: bodyA });
    await waitUntil(() => releases.length === 1);
    const second = await app.request('/dashboard/api/workflow-webhooks/vk', { method: 'POST', headers: signedVkWebhookHeaders('secret', bodyB), body: bodyB });

    expect(second.status).toBe(202);
    await expect(second.json()).resolves.toMatchObject({ accepted: true, duplicate: false, wakeup: { started: false, queued: true } });
    expect(runReady).toHaveBeenCalledTimes(1);

    releases[0]!();
    await waitUntil(() => releases.length === 2);
    expect(runReady).toHaveBeenCalledTimes(2);
    releases[1]!();
    const firstResponse = await first;
    expect(firstResponse.status).toBe(202);
    await expect(firstResponse.json()).resolves.toMatchObject({ accepted: true, duplicate: false, wakeup: { started: true, queued: false, passes: 2 } });

    await expect(inboxStore.listEvents({ limit: 10 })).resolves.toMatchObject({
      events: [
        expect.objectContaining({ deliveryId: 'delivery-route-overlap-b', status: 'processed' }),
        expect.objectContaining({ deliveryId: 'delivery-route-overlap-a', status: 'processed' }),
      ],
    });
  });

  it('acknowledges duplicate valid VK workflow webhooks without duplicate wakeups', async () => {
    const handle = await initVdDb({ path: ':memory:' });
    dbHandles.push(handle);
    let id = 0;
    const inboxStore = new DbWorkflowWebhookInboxStore({ db: handle.db, createId: () => `inbox-route-${++id}`, now: () => 10 + id });
    const wakeup = { trigger: vi.fn(async () => ({ started: true, queued: false })) };
    const app = new Hono();
    registerWorkflowRoutes(app, {
      registry: createWorkflowRegistry(),
      workflowWebhookInboxStore: inboxStore,
      workflowWebhookWakeup: wakeup,
      vkWorkflowWebhookSecret: 'secret',
    });
    const body = JSON.stringify(vkWebhookPayload());
    const headers = signedVkWebhookHeaders('secret', body);

    const first = await app.request('/dashboard/api/workflow-webhooks/vk', { method: 'POST', headers, body });
    const second = await app.request('/dashboard/api/workflow-webhooks/vk', { method: 'POST', headers, body });

    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    await expect(second.json()).resolves.toMatchObject({ accepted: true, duplicate: true });
    expect(wakeup.trigger).toHaveBeenCalledTimes(1);
    await expect(inboxStore.listEvents()).resolves.toMatchObject({ events: [expect.objectContaining({ inboxId: 'inbox-route-1' })] });
  });


  it('uses provisioned VK webhook secret when no env override is configured', async () => {
    const handle = await initVdDb({ path: ':memory:' });
    dbHandles.push(handle);
    const inboxStore = new DbWorkflowWebhookInboxStore({ db: handle.db, createId: () => 'inbox-provisioned-secret', now: () => 40 });
    const provisioningStore = new DbWorkflowWebhookProvisioningStore({ db: handle.db, createSecret: () => 'provisioned-secret', now: () => 30 });
    await provisioningStore.ensureState({ upsertKey: 'vd.workflow_wakeups.v1', targetUrl: 'http://127.0.0.1:3109/dashboard/api/workflow-webhooks/vk' });
    const wakeup = { trigger: vi.fn(async () => ({ started: true, queued: false })) };
    const app = new Hono();
    registerWorkflowRoutes(app, {
      registry: createWorkflowRegistry(),
      workflowWebhookInboxStore: inboxStore,
      workflowWebhookProvisioningStore: provisioningStore,
      workflowWebhookWakeup: wakeup,
    });
    const body = JSON.stringify(vkWebhookPayload({ delivery_id: 'delivery-provisioned-secret' }));

    const response = await app.request('/dashboard/api/workflow-webhooks/vk', {
      method: 'POST',
      headers: signedVkWebhookHeaders('provisioned-secret', body),
      body,
    });

    expect(response.status).toBe(202);
    expect(wakeup.trigger).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toMatchObject({ accepted: true, inbox: { inboxId: 'inbox-provisioned-secret' } });
  });

  it('exposes redacted VK workflow webhook provisioning status', async () => {
    const handle = await initVdDb({ path: ':memory:' });
    dbHandles.push(handle);
    const provisioningStore = new DbWorkflowWebhookProvisioningStore({ db: handle.db, createSecret: () => 'do-not-leak', now: () => 50 });
    await provisioningStore.ensureState({ upsertKey: 'vd.workflow_wakeups.v1', targetUrl: 'http://127.0.0.1:3109/dashboard/api/workflow-webhooks/vk' });
    const app = new Hono();
    registerWorkflowRoutes(app, {
      registry: createWorkflowRegistry(),
      workflowWebhookProvisioningStore: provisioningStore,
    });

    const response = await app.request('/dashboard/api/workflow-webhooks/provisioning');

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toMatchObject({ state: { secretSet: true, upsertKey: 'vd.workflow_wakeups.v1' } });
    expect(JSON.stringify(json)).not.toContain('do-not-leak');
    expect(JSON.stringify(json)).not.toContain('secret":"');
  });

  it('rejects invalid VK webhook signatures without storing or waking', async () => {
    const handle = await initVdDb({ path: ':memory:' });
    dbHandles.push(handle);
    const inboxStore = new DbWorkflowWebhookInboxStore({ db: handle.db });
    const wakeup = { trigger: vi.fn(async () => ({ started: true, queued: false })) };
    const app = new Hono();
    registerWorkflowRoutes(app, {
      registry: createWorkflowRegistry(),
      workflowWebhookInboxStore: inboxStore,
      workflowWebhookWakeup: wakeup,
      vkWorkflowWebhookSecret: 'secret',
    });
    const body = JSON.stringify(vkWebhookPayload());
    const response = await app.request('/dashboard/api/workflow-webhooks/vk', {
      method: 'POST',
      headers: { ...signedVkWebhookHeaders('wrong', body), 'Content-Type': 'application/json' },
      body,
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: 'invalid_vk_workflow_webhook_signature' });
    expect(wakeup.trigger).not.toHaveBeenCalled();
    await expect(inboxStore.listEvents()).resolves.toMatchObject({ events: [] });
  });
});

function customDefinition(id: string) {
  return {
    id,
    version: 1,
    name: 'Custom review round',
    trigger: 'manual',
    inputs: {
      task: { type: 'string', required: true },
      workspaceId: { type: 'string', required: true },
      sourceSessionId: { type: 'string', required: false },
      reviewSessionId: { type: 'string', required: false },
      overseerSessionId: { type: 'string', required: false },
    },
    policies: { refsOnlyStorage: true },
    steps: [
      {
        id: 'resolve_custom',
        type: 'resolve_roles',
        workspaceInput: 'workspaceId',
        roles: [
          { key: 'source', sessionInput: 'sourceSessionId', defaultRole: 'implementer' },
          { key: 'review', sessionInput: 'reviewSessionId', defaultRole: 'reviewer' },
        ],
      },
      { id: 'ask_custom_source', type: 'queue_prompt', target: 'source', template: '{{inputs.task}}' },
      { id: 'wait_custom_source', type: 'wait_for_next_completed_response', target: 'source', after: 'ask_custom_source' },
      { id: 'ask_custom_review', type: 'pipe_response', source: 'wait_custom_source', target: 'review', template: 'Review: {{source.response}}' },
      { id: 'wait_custom_review', type: 'wait_for_next_completed_response', target: 'review', after: 'ask_custom_review' },
      { id: 'notify_custom_overseer', type: 'notify_overseer', sessionInput: 'overseerSessionId', template: 'Review: {{responses.wait_custom_review}}' },
      { id: 'complete_custom', type: 'complete', summaryTemplate: 'Done {{inputs.task}}' },
    ],
    outputs: {},
  };
}

function vkWebhookPayload(overrides: Record<string, unknown> = {}) {
  return {
    event_type: 'execution.completed',
    delivery_id: 'delivery-route-1',
    timestamp: '2026-08-08T00:00:00.000Z',
    workspace_id: 'ws-1',
    session_id: 'session-1',
    execution_id: 'exec-1',
    queue_item_id: 'queue-1',
    message: 'full notification message should not be persisted',
    ...overrides,
  };
}

function signedVkWebhookHeaders(secret: string, body: string): Record<string, string> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  return {
    'Content-Type': 'application/json',
    'X-VK-Webhook-Timestamp': timestamp,
    'X-VK-Webhook-Algorithm': 'hmac-sha256',
    'X-VK-Webhook-Signature': signVkWebhookPayload(secret, timestamp, body),
  };
}


function routeValidDefinition() {
  return {
    schemaVersion: 1,
    name: 'Home Workflow',
    roles: { dev: { label: 'Dev' } },
    initialState: 'dev',
    states: {
      dev: {
        owner: 'dev',
        steps: [{ id: 'decide', type: 'agent_turn', turnType: 'decision', prompt: { template: 'Decide' }, response: { format: 'xml', schema: { format: 'xsd', source: 'state_actions' }, invalidXmlRetry: { maxAttempts: 1, prompt: 'engine_default_with_validation_errors', onExhausted: 'blocked' }, storeRawXml: true, storeParsedFields: true, unknownFields: 'reject_unless_allowed_by_result_contract' } }],
        actions: { done: { targetState: 'done' } },
      },
      done: { terminal: true },
    },
  };
}

function routeLaunchDefinition() {
  return {
    schemaVersion: 1,
    name: 'Launch Workflow',
    inputs: { featureRequest: { type: 'markdown', required: true, description: 'What should the workflow do?' } },
    roles: { dev: { label: 'Dev' }, review: { label: 'Review' } },
    initialState: 'dev',
    states: {
      dev: {
        owner: 'dev',
        steps: [{ id: 'decide', type: 'agent_turn', turnType: 'decision', prompt: { template: 'Decide {{inputs.featureRequest}}' }, response: { format: 'xml', schema: { format: 'xsd', source: 'state_actions' }, invalidXmlRetry: { maxAttempts: 1, prompt: 'engine_default_with_validation_errors', onExhausted: 'blocked' }, storeRawXml: true, storeParsedFields: true, unknownFields: 'reject_unless_allowed_by_result_contract' } }],
        actions: { done: { targetState: 'done' } },
      },
      done: { terminal: true },
    },
  };
}

function vkSession(id: string, workspaceId: string, name: string | null) {
  return {
    id,
    workspace_id: workspaceId,
    executor: 'CODEX' as const,
    name,
    created_at: '2026-08-11T00:00:00.000Z',
    updated_at: '2026-08-11T00:00:00.000Z',
  };
}

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

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('condition not met');
}

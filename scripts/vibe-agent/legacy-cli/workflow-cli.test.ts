import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  parseWorkflowCliFlags,
  productSafeWorkflowCliText,
  resolveWorkflowReference,
  resolveWorkflowWorkspace,
  validateWorkflowCliInputs,
  workflowCliCatalog,
  workflowCommand,
  confirmWorkflowPlan,
} from './vibe-agent.js';

const originalWorkspace = process.env.VK_WORKSPACE_ID;
const originalBead = process.env.VK_BEAD_ID;
const originalSession = process.env.VK_SESSION_ID;

beforeEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
  delete process.env.VK_WORKSPACE_ID;
  delete process.env.VK_BEAD_ID;
  delete process.env.VK_SESSION_ID;
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
  if (originalWorkspace === undefined) delete process.env.VK_WORKSPACE_ID;
  else process.env.VK_WORKSPACE_ID = originalWorkspace;
  if (originalBead === undefined) delete process.env.VK_BEAD_ID;
  else process.env.VK_BEAD_ID = originalBead;
  if (originalSession === undefined) delete process.env.VK_SESSION_ID;
  else process.env.VK_SESSION_ID = originalSession;
});

describe('vibe-agent workflow CLI foundation', () => {
  it('parses repeated inputs/beads and defaults workspace from VK_WORKSPACE_ID', () => {
    process.env.VK_WORKSPACE_ID = 'workspace-env';
    const flags = parseWorkflowCliFlags(['--input', 'role=review', '--input=request=Review this', '--bead', 'bead-a', '--bead=bead-b', '--json']);
    expect(flags).toMatchObject({ json: true, inputs: { role: 'review', request: 'Review this' }, beadIds: ['bead-a', 'bead-b'], callerSessionId: null, roleSessions: [], roleExecutors: [], roleModels: [], roleReasonings: [], positionals: [] });
    expect(resolveWorkflowWorkspace(flags, { required: true })).toBe('workspace-env');
  });

  it('parses caller callback and role/session binding flags', () => {
    process.env.VK_SESSION_ID = 'caller-env';
    const flags = parseWorkflowCliFlags(['--role-session', 'teammate=session-review', '--role-executor=teammate=CODEX', '--role-model', 'teammate=gpt-5.1', '--role-reasoning', 'teammate=high', '--caller-session', 'caller-override']);
    expect(flags).toMatchObject({
      callerSessionId: 'caller-override',
      roleSessions: [{ roleId: 'teammate', value: 'session-review' }],
      roleExecutors: [{ roleId: 'teammate', value: 'CODEX' }],
      roleModels: [{ roleId: 'teammate', value: 'gpt-5.1' }],
      roleReasonings: [{ roleId: 'teammate', value: 'high' }],
    });
    expect(parseWorkflowCliFlags(['--no-caller-response']).callerSessionId).toBeNull();
  });

  it('requires affirmative TTY confirmation and treats decline or EOF as no start', async () => {
    await expect(confirmWorkflowPlan(false, async () => 'no')).rejects.toThrow('Declined');
    await expect(confirmWorkflowPlan(false, async () => { throw new Error('EOF'); })).rejects.toThrow('Confirmation ended');
    await expect(confirmWorkflowPlan(false, async () => 'yes')).resolves.toBeUndefined();
    const ask = vi.fn(async () => 'no');
    await expect(confirmWorkflowPlan(true, ask)).resolves.toBeUndefined();
    expect(ask).not.toHaveBeenCalled();
  });

  it('resolves workflows by id, starter alias, unique slug, and rejects ambiguity', () => {
    const catalog = workflowCliCatalog({
      workspaceId: 'workspace-a',
      userWorkflows: [workflow('design-a', 'Ask teammate'), workflow('design-b', 'Review changes')],
      starterTemplates: [workflow('built-in/ask-teammate', 'Ask teammate', 'template')],
    });
    expect(resolveWorkflowReference('design-a', catalog).workflow.id).toBe('design-a');
    expect(resolveWorkflowReference('review-changes', catalog).workflow.id).toBe('design-b');
    expect(() => resolveWorkflowReference('ask-teammate', catalog)).toThrow(/ambiguous/i);
    expect(resolveWorkflowReference('ask-teammate', workflowCliCatalog({ workspaceId: 'workspace-a', userWorkflows: [], starterTemplates: [workflow('built-in/ask-teammate', 'Ask teammate', 'template')] })).workflow.id).toBe('built-in/ask-teammate');
  });

  it('discovers enabled task-backed Gas City recipes as generic workflow CLI entries', () => {
    const catalog = workflowCliCatalog(gasCityHome());
    const recipe = resolveWorkflowReference('dev-review-test', catalog);
    expect(recipe).toMatchObject({
      alias: 'dev-review-test',
      source: 'gas_city_recipe',
      workflow: {
        id: 'gas-city/dev-review-test',
        title: 'Dev Review Test recipe',
        canRun: true,
      },
    });
  });

  it('validates missing required inputs product-safely', () => {
    expect(() => validateWorkflowCliInputs(workflow('design-a', 'Ask teammate'), { role: 'review' })).toThrow('request');
    expect(() => resolveWorkflowWorkspace({}, { required: true })).toThrow('Workspace is required');
  });

  it('scrubs normal output text', () => {
    const scrubbed = productSafeWorkflowCliText('raw XML <xs:schema>secret</xs:schema> prompt:abc@1 skill:def@2 contentHash webhook queue_item delivery ID /Users/me/x /tmp/x shell bd show foo git status runReady WorkflowStepState');
    expect(scrubbed).not.toContain('<xs:schema');
    expect(scrubbed).not.toContain('prompt:');
    expect(scrubbed).not.toContain('skill:');
    expect(scrubbed).not.toContain('webhook');
    expect(scrubbed).not.toContain('queue_item');
    expect(scrubbed).not.toContain('/Users/');
    expect(scrubbed).not.toContain('/tmp/');
    expect(scrubbed).not.toContain('bd show');
    expect(scrubbed).not.toContain('git status');
    expect(scrubbed).not.toContain('runReady');
    expect(scrubbed).not.toContain('WorkflowStepState');
  });



  it('supports flags before the workflow ref and validates starter inputs before materializing', async () => {
    process.env.VK_WORKSPACE_ID = 'workspace-a';
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/dashboard/api/workflows/home?workspaceId=workspace-a')) return json({ home: { workspaceId: 'workspace-a', userWorkflows: [], starterTemplates: [workflow('built-in/ask-teammate', 'Ask teammate', 'template')] } });
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const lines = captureConsole();
    await workflowCommand(['run', '--workspace', 'workspace-a', 'ask-teammate', '--input', 'role=review', '--json']);
    expect(process.exitCode).toBe(1);
    expect(JSON.parse(lines.join('\n'))).toMatchObject({ ok: false, error: expect.stringContaining('request') });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/dashboard/api/workflows/home');
  });

  it('materializes a valid starter before planning and preserves caller response intent', async () => {
    process.env.VK_WORKSPACE_ID = 'workspace-a'; process.env.VK_SESSION_ID = 'caller-1';
    const digest = 'c'.repeat(64);
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/dashboard/api/workflows/home?workspaceId=workspace-a')) return json({ home: { workspaceId: 'workspace-a', userWorkflows: [], starterTemplates: [workflow('built-in/ask-teammate', 'Ask teammate', 'template')] } });
      if (url.endsWith('/dashboard/api/workflow-templates/use')) return json({ design: { designId: 'copy-1', latestPublishedVersion: 1 }, version: { version: 1 } }, 201);
      if (url.endsWith('/dashboard/api/workflows/plan')) { const body = JSON.parse(String(init?.body)); expect(body).toMatchObject({ designId: 'copy-1', completionResponse: { sessionId: 'caller-1', source: 'vibe-agent-cli' } }); return json({ plan: { digest, summary: 'Plan.', workflow: { label: 'Ask teammate', version: 1 }, tasks: [], repositories: [], expiresAt: 9999 } }); }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock); const lines = captureConsole();
    await workflowCommand(['plan', 'ask-teammate', '--input', 'role=review', '--input', 'request=Review', '--json']);
    expect(JSON.parse(lines.join('\n'))).toMatchObject({ ok: true, plan: { digest } });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('runs a planned teammate workflow through digest-bound APIs and detaches with JSON output', async () => {
    process.env.VK_WORKSPACE_ID = 'workspace-a';
    const digest = 'a'.repeat(64);
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/dashboard/api/workflows/home?workspaceId=workspace-a')) return json({ home: { workspaceId: 'workspace-a', userWorkflows: [workflow('design-ask', 'Ask teammate')], starterTemplates: [] } });
      if (url.endsWith('/dashboard/api/workflows/plan')) return json({ plan: { digest, bundleDigest: 'b'.repeat(64), summary: 'One task.', workflow: { label: 'Ask teammate', version: 1 }, tasks: [{ id: 'bead-explicit', title: 'Task' }], repositories: [], expiresAt: 9999 } });
      if (url.endsWith('/dashboard/api/workflows/plan/launch')) {
        const body = JSON.parse(String(init?.body)); expect(body.planDigest).toBe(digest); expect(body.request.beadIds).toEqual(['bead-explicit']);
        return json({ result: { status: 'launched', run: { runId: 'run-1', status: 'running', url: '/dashboard/workflows/run-1' }, plan: { digest } } }, 201);
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock); const lines = captureConsole();
    await workflowCommand(['run', 'design-ask', '--input', 'role=review', '--input', 'request=Review this', '--bead', 'bead-explicit', '--plan-digest', digest, '--json']);
    const output = JSON.parse(lines.join('\n'));
    expect(output).toMatchObject({ ok: true, runId: 'run-1', status: 'running', workspaceId: 'workspace-a', planDigest: digest });
    expect(output.nextAction).toContain('End this turn');
  });

  it('prints a side-effect-free plan digest for automation', async () => {
    process.env.VK_WORKSPACE_ID = 'workspace-a'; const digest = 'd'.repeat(64);
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/dashboard/api/workflows/home?workspaceId=workspace-a')) return json({ home: { workspaceId: 'workspace-a', userWorkflows: [workflow('design-ask', 'Ask teammate')], starterTemplates: [] } });
      if (url.endsWith('/dashboard/api/workflows/plan')) return json({ plan: { digest, summary: 'No tasks.', workflow: { label: 'Ask teammate', version: 1 }, tasks: [], repositories: [], expiresAt: 9999 } });
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock); const lines = captureConsole();
    await workflowCommand(['plan', 'design-ask', '--input', 'role=review', '--input', 'request=Review', '--json']);
    expect(JSON.parse(lines.join('\n'))).toMatchObject({ ok: true, plan: { digest } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not let noninteractive --yes bypass a plan digest', async () => {
    process.env.VK_WORKSPACE_ID = 'workspace-a';
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/dashboard/api/workflows/home?workspaceId=workspace-a')) return json({ home: { workspaceId: 'workspace-a', userWorkflows: [workflow('design-ask', 'Ask teammate')], starterTemplates: [] } });
      if (url.endsWith('/dashboard/api/workflows/plan')) return json({ plan: { digest: 'e'.repeat(64), summary: 'Plan.', workflow: { label: 'Ask', version: 1 }, tasks: [], repositories: [], expiresAt: 9999 } });
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock); const lines = captureConsole();
    await workflowCommand(['run', 'design-ask', '--input', 'role=review', '--input', 'request=Review', '--yes', '--json']);
    expect(JSON.parse(lines.join('\n'))).toMatchObject({ ok: false, error: expect.stringContaining('--plan-digest') });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('runs a task-backed Gas City recipe through the fixture launch seam and detaches cleanly', async () => {
    process.env.VK_WORKSPACE_ID = 'workspace-a';
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/dashboard/api/workflows/home?workspaceId=workspace-a')) return json({ home: gasCityHome() });
      if (url.endsWith('/dashboard/api/workflows/gas-city-e2e-fixture/launch')) {
        const body = JSON.parse(String(init?.body));
        expect(body).toEqual({
          workspaceId: 'workspace-a',
          sourceBeadId: 'bead-gas-city',
          target: 'worker',
          formula: 'dev-review-test',
          idempotencyKey: 'vibe-agent-workflow-workspace-a-bead-gas-city-dev-review-test-worker',
          completionResponse: { sessionId: 'caller-explicit', source: 'vibe-agent-cli' },
        });
        return json({
          launch: {
            status: 'accepted',
            summary: 'Task-backed workflow accepted.',
            workflowRef: {
              providerId: 'gas_city',
              workspaceId: 'workspace-a',
              sourceBeadId: 'bead-gas-city',
              target: 'worker',
              formula: 'dev-review-test',
              workflowId: 'gc-workflow-bead-gas-city',
            },
          },
          workflow: { status: 'running', nextAction: 'Agent is working.' },
          completionResponse: { status: 'pending', callbackKey: 'workflow-completion:gc-workflow-bead-gas-city:caller-explicit', sessionId: 'caller-explicit', summary: 'Completion response will be sent.' },
        }, 201);
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const lines = captureConsole();
    process.env.VK_SESSION_ID = 'caller-session';
    await workflowCommand(['run', 'dev-review-test', '--bead', 'bead-gas-city', '--caller-session', 'caller-explicit', '--json']);
    const output = JSON.parse(lines.join('\n'));
    expect(output).toMatchObject({
      ok: true,
      runId: 'gc-workflow-bead-gas-city',
      status: 'running',
      workspaceId: 'workspace-a',
      workflow: { id: 'gas-city/dev-review-test', alias: 'dev-review-test', kind: 'task_backed_recipe' },
      beadIds: ['bead-gas-city'],
      completionResponse: { expected: true, status: 'pending', sessionId: 'caller-explicit' },
    });
    expect(output.nextAction).toContain('End this turn');
    expect(output.nextAction).toContain('workflow response will arrive later');
    const serialized = JSON.stringify(output);
    expect(serialized).not.toMatch(/raw XML|raw JSON|prompt:|skill:|contentHash|provider diagnostics|\/Users\/|\/tmp\/|queue[_ -]?item|webhook|runReady|WorkflowStepState/i);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('requires exactly one source bead for task-backed recipe launches', async () => {
    process.env.VK_WORKSPACE_ID = 'workspace-a';
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/dashboard/api/workflows/home?workspaceId=workspace-a')) return json({ home: gasCityHome() });
      throw new Error(`unexpected fetch ${url}`);
    }));
    const lines = captureConsole();
    await workflowCommand(['run', 'dev-review-test', '--json']);
    expect(process.exitCode).toBe(1);
    expect(JSON.parse(lines.join('\n'))).toMatchObject({ ok: false, error: expect.stringContaining('--bead') });
  });



  it('rejects mismatched --bead and sourceBeadId input for task-backed recipe launches', async () => {
    process.env.VK_WORKSPACE_ID = 'workspace-a';
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/dashboard/api/workflows/home?workspaceId=workspace-a')) return json({ home: gasCityHome() });
      throw new Error(`unexpected fetch ${url}`);
    }));
    const lines = captureConsole();
    await workflowCommand(['run', 'dev-review-test', '--bead', 'bead-a', '--input', 'sourceBeadId=bead-b', '--json']);
    expect(process.exitCode).toBe(1);
    expect(JSON.parse(lines.join('\n'))).toMatchObject({ ok: false, error: expect.stringContaining('source bead mismatch') });
  });

  it('submits explicit role/session binding overrides in the confirmed plan request', async () => {
    process.env.VK_WORKSPACE_ID = 'workspace-a'; const digest = 'c'.repeat(64);
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/dashboard/api/workflows/home?workspaceId=workspace-a')) return json({ home: { workspaceId: 'workspace-a', userWorkflows: [workflow('design-ask', 'Ask teammate')], starterTemplates: [] } });
      if (url.endsWith('/dashboard/api/workflows/plan')) { const body=JSON.parse(String(init?.body)); expect(body.roleBindings.teammate).toMatchObject({ sessionId:'session-review', executorType:'CODEX', model:'gpt-5.1', reasoningId:'high' }); return json({ plan: { digest, summary:'One task.',workflow:{label:'Ask',version:1},tasks:[],repositories:[],expiresAt:9999 } }); }
      if (url.endsWith('/dashboard/api/workflows/plan/launch')) return json({ result: { status:'launched',run:{runId:'run-roles',status:'running',url:'/dashboard/workflows/run-roles'} } },201);
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock); const lines=captureConsole();
    await workflowCommand(['run','design-ask','--input','role=review','--input','request=Review','--role-session','teammate=session-review','--role-executor','teammate=CODEX','--role-model=teammate=gpt-5.1','--role-reasoning=teammate=high','--plan-digest',digest,'--json']);
    expect(JSON.parse(lines.join('\n'))).toMatchObject({ok:true,runId:'run-roles'});
  });

  it('reports status and result from clean presentation read model', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      expect(url).toContain('/dashboard/api/workflow-instances/run-1/presentation');
      return json({ presentation: { instanceId: 'run-1', workflowId: 'design-ask', workflowName: 'Ask teammate', status: 'completed', summary: { statusLabel: 'Complete', currentOwner: null, waitingReason: null, nextAction: 'Read result.' }, outputs: [{ id: 'summary', label: 'Final summary', value: 'Looks good.', kind: 'summary' }], provenance: { workflowVersion: 1 } } });
    }));
    const lines = captureConsole();
    await workflowCommand(['result', 'run-1', '--json']);
    const output = JSON.parse(lines.join('\n'));
    expect(output).toMatchObject({ ok: true, runId: 'run-1', status: 'completed', finalResult: [{ label: 'Final summary', kind: 'summary', value: 'Looks good.' }] });
  });

  it('emits structured JSON errors for missing workspace', async () => {
    const lines = captureConsole();
    await workflowCommand(['run', 'ask-teammate', '--input', 'role=review', '--input', 'request=Review', '--json']);
    expect(process.exitCode).toBe(1);
    expect(JSON.parse(lines.join('\n'))).toMatchObject({ ok: false, error: expect.stringContaining('Workspace is required') });
  });
});

function workflow(id: string, title: string, source: 'published_design' | 'template' = 'published_design') {
  return {
    id,
    title,
    description: 'Workflow description',
    source,
    status: 'ready',
    version: source === 'template' ? null : 1,
    unavailableReason: null,
    canRun: source !== 'template',
    inputs: [
      { id: 'role', type: 'string', required: true, description: 'Role' },
      { id: 'request', type: 'markdown', required: true, description: 'Request' },
      { id: 'successCriteria', type: 'markdown', required: false, description: 'Success criteria' },
    ],
    roles: [{ id: 'teammate', label: 'Teammate' }],
  };
}

function gasCityHome() {
  return {
    workspaceId: 'workspace-a',
    userWorkflows: [],
    starterTemplates: [],
    gasCityEngine: {
      health: { status: 'healthy', summary: 'Workflow orchestration is available.', version: '1.4.1' },
      recipes: [{
        id: 'dev-review-test',
        name: 'Dev Review Test recipe',
        summary: 'Generated recipe available for deterministic task-backed workflow testing.',
        sourceWorkflow: 'Dev Review Test',
        status: 'ready',
      }],
      launch: {
        enabled: true,
        sourceBeadId: 'bead-gas-city',
        target: 'worker',
        recipeId: 'dev-review-test',
        summary: 'Ready to start task-backed workflow work.',
      },
    },
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function captureConsole(): string[] {
  const lines: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((line?: unknown) => { lines.push(String(line ?? '')); });
  return lines;
}

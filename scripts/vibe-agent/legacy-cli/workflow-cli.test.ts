import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  parseWorkflowCliFlags,
  productSafeWorkflowCliText,
  resolveWorkflowReference,
  resolveWorkflowWorkspace,
  validateWorkflowCliInputs,
  workflowCliCatalog,
  workflowCommand,
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
    expect(flags).toMatchObject({ json: true, inputs: { role: 'review', request: 'Review this' }, beadIds: ['bead-a', 'bead-b'], callerSessionId: null, roleSessions: [], roleExecutors: [], roleModels: [], positionals: [] });
    expect(resolveWorkflowWorkspace(flags, { required: true })).toBe('workspace-env');
  });

  it('parses caller callback and role/session binding flags', () => {
    process.env.VK_SESSION_ID = 'caller-env';
    const flags = parseWorkflowCliFlags(['--role-session', 'teammate=session-review', '--role-executor=teammate=CODEX', '--role-model', 'teammate=gpt-5.1', '--caller-session', 'caller-override']);
    expect(flags).toMatchObject({
      callerSessionId: 'caller-override',
      roleSessions: [{ roleId: 'teammate', value: 'session-review' }],
      roleExecutors: [{ roleId: 'teammate', value: 'CODEX' }],
      roleModels: [{ roleId: 'teammate', value: 'gpt-5.1' }],
    });
    expect(parseWorkflowCliFlags(['--no-caller-response']).callerSessionId).toBeNull();
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

  it('runs a starter teammate workflow through HTTP APIs and detaches with JSON output', async () => {
    process.env.VK_WORKSPACE_ID = 'workspace-a';
    process.env.VK_BEAD_ID = 'bead-env';
    process.env.VK_SESSION_ID = 'caller-session';
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/dashboard/api/workflows/home?workspaceId=workspace-a')) return json({ home: { workspaceId: 'workspace-a', userWorkflows: [], starterTemplates: [workflow('built-in/ask-teammate', 'Ask teammate', 'template')] } });
      if (url.endsWith('/dashboard/api/workflow-templates/built-in%2Fask-teammate/use')) return json({ design: { designId: 'design-ask', name: 'Ask teammate', latestPublishedVersion: 1 }, version: { version: 1 } }, 201);
      if (url.endsWith('/dashboard/api/workflows/launch-options?workspaceId=workspace-a&designId=design-ask&version=1')) return json({ options: { workspaceId: 'workspace-a', workflow: { ...workflow('design-ask', 'Ask teammate'), version: 1, roles: [{ id: 'teammate', label: 'Teammate' }] }, sessions: [] } });
      if (url.endsWith('/dashboard/api/workflows/launch')) {
        const body = JSON.parse(String(init?.body));
        expect(body).toMatchObject({ workspaceId: 'workspace-a', designId: 'design-ask', version: 1, inputs: { role: 'review', request: 'Review this' }, beadIds: ['bead-explicit'], completionResponse: { sessionId: 'caller-session', source: 'vibe-agent-cli' } });
        expect(body.roleBindings).toEqual({ teammate: { mode: 'create_or_reuse', name: 'Teammate' } });
        return json({ run: { runId: 'run-1', status: 'running', detailUrl: '/dashboard/workflows/run-1' } }, 201);
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const lines = captureConsole();
    await workflowCommand(['run', 'ask-teammate', '--input', 'role=review', '--input', 'request=Review this', '--bead', 'bead-explicit', '--json']);
    const output = JSON.parse(lines.join('\n'));
    expect(output).toMatchObject({ ok: true, runId: 'run-1', status: 'running', workspaceId: 'workspace-a' });
    expect(output.nextAction).toContain('End this turn');
    expect(output.completionResponse).toMatchObject({ sessionId: 'caller-session', expected: true });
    expect(output.runUrl).toContain('/dashboard/workflows/run-1');
  });

  it('submits explicit role/session binding overrides product-safely', async () => {
    process.env.VK_WORKSPACE_ID = 'workspace-a';
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/dashboard/api/workflows/home?workspaceId=workspace-a')) return json({ home: { workspaceId: 'workspace-a', userWorkflows: [workflow('design-ask', 'Ask teammate')], starterTemplates: [] } });
      if (url.endsWith('/dashboard/api/workflows/launch-options?workspaceId=workspace-a&designId=design-ask&version=1')) return json({ options: { workspaceId: 'workspace-a', workflow: { ...workflow('design-ask', 'Ask teammate'), version: 1, roles: [{ id: 'teammate', label: 'Teammate' }] }, sessions: [] } });
      if (url.endsWith('/dashboard/api/workflows/launch')) {
        const body = JSON.parse(String(init?.body));
        expect(body.roleBindings).toEqual({ teammate: { mode: 'existing', name: 'Teammate', sessionId: 'session-review', executorType: 'CODEX', model: 'gpt-5.1' } });
        return json({ run: { runId: 'run-roles', status: 'running', detailUrl: '/dashboard/workflows/run-roles' } }, 201);
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const lines = captureConsole();
    await workflowCommand(['run', 'design-ask', '--input', 'role=review', '--input', 'request=Review', '--role-session', 'teammate=session-review', '--role-executor', 'teammate=CODEX', '--role-model=teammate=gpt-5.1', '--json']);
    expect(JSON.parse(lines.join('\n'))).toMatchObject({ ok: true, runId: 'run-roles' });
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

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function captureConsole(): string[] {
  const lines: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((line?: unknown) => { lines.push(String(line ?? '')); });
  return lines;
}

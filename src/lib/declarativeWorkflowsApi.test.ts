import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchDeclarativeWorkflowDefinitions, fetchWorkflowInstanceStatus, runDeclarativeWorkflow, fetchWorkflowWebhookProvisioningStatus, DeclarativeWorkflowRequestError } from './declarativeWorkflowsApi';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('declarative workflow API client', () => {
  it('loads definitions and launches durable workflow runs', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (input === '/dashboard/api/declarative-workflow-definitions') {
        return json({ definitions: [{ definitionId: 'two-agent-review-round', version: 1, status: 'active', source: 'built_in', definition: { id: 'two-agent-review-round' } }] });
      }
      if (input === '/dashboard/api/declarative-workflows/two-agent-review-round/run') {
        expect(init?.method).toBe('POST');
        expect(JSON.parse(String(init?.body))).toMatchObject({ input: { task: 'Do it' }, trigger: 'manual_ui' });
        return json({ result: { instance: { instanceId: 'instance-1', workflowId: 'two-agent-review-round', status: 'waiting' }, steps: [], trigger: { triggerId: 'trigger-1' }, resolvedRoles: {}, queuedSource: { queueItemId: 'queue-1' }, cursor: {} } }, { status: 202 });
      }
      throw new Error(`unexpected ${String(input)}`);
    });

    await expect(fetchDeclarativeWorkflowDefinitions()).resolves.toMatchObject({ definitions: [{ definitionId: 'two-agent-review-round' }] });
    await expect(runDeclarativeWorkflow('two-agent-review-round', { input: { task: 'Do it' }, team: {}, trigger: 'manual_ui' })).resolves.toMatchObject({ result: { instance: { instanceId: 'instance-1' } } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('loads instance status and webhook provisioning status', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (input === '/dashboard/api/workflow-instances/instance-1/status') return json({ instance: { instanceId: 'instance-1' }, steps: [], triggers: [], output: null });
      if (input === '/dashboard/api/workflow-webhooks/provisioning') return json({ state: { secretSet: true, status: 'provisioned' } });
      throw new Error(`unexpected ${String(input)}`);
    });

    await expect(fetchWorkflowInstanceStatus('instance-1')).resolves.toMatchObject({ instance: { instanceId: 'instance-1' } });
    await expect(fetchWorkflowWebhookProvisioningStatus()).resolves.toMatchObject({ state: { secretSet: true, status: 'provisioned' } });
  });

  it('throws actionable request errors with payload detail', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ error: 'same_session', message: 'Source and reviewer must be different sessions' }, { status: 400 }));

    await expect(runDeclarativeWorkflow('two-agent-review-round', { input: {}, team: {} })).rejects.toMatchObject({
      name: 'DeclarativeWorkflowRequestError',
      status: 400,
      message: 'Failed to launch workflow two-agent-review-round: Source and reviewer must be different sessions',
    } satisfies Partial<DeclarativeWorkflowRequestError>);
  });
});

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' }, ...init });
}

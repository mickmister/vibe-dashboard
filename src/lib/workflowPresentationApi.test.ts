import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkflowPresentationRequestError, fetchWorkflowPresentation } from './workflowPresentationApi';

describe('workflow presentation API client', () => {
  afterEach(() => vi.restoreAllMocks());

  it('loads clean workflow presentation by instance id', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ presentation: { instanceId: 'instance-1', workflowName: 'Two agent review round', timeline: [] } })));

    await expect(fetchWorkflowPresentation('instance/1')).resolves.toMatchObject({ workflowName: 'Two agent review round' });
    expect(fetchMock).toHaveBeenCalledWith('/dashboard/api/workflow-instances/instance%2F1/presentation', { headers: { Accept: 'application/json' } });
  });

  it('throws specific not-found errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: 'workflow_presentation_not_found', message: 'Workflow not found' }), { status: 404 }));

    await expect(fetchWorkflowPresentation('missing')).rejects.toMatchObject({
      name: 'WorkflowPresentationRequestError',
      status: 404,
      message: 'Workflow not found',
    } satisfies Partial<WorkflowPresentationRequestError>);
  });
});

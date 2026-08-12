import { afterEach, describe, expect, it, vi } from 'vitest';
import { batchLaunchWorkspaceWorkflow, fetchWorkflowBatchDetail, fetchWorkflowLaunchOptions, fetchWorkspaceWorkflowsHome, launchWorkspaceWorkflow, useWorkflowTemplate } from './workflowsHomeApi';

describe('workflows home API client', () => {
  afterEach(() => vi.restoreAllMocks());

  it('loads workspace workflows home by workspace id', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ home: { workspaceId: 'workspace-a', userWorkflows: [], starterTemplates: [], recentRuns: [], needsInput: [], recentBatches: [] } })));

    await expect(fetchWorkspaceWorkflowsHome('workspace-a')).resolves.toMatchObject({ workspaceId: 'workspace-a' });
    expect(fetchMock).toHaveBeenCalledWith('/dashboard/api/workflows/home?workspaceId=workspace-a', { headers: { Accept: 'application/json' } });
  });

  it('throws product errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ message: 'Workspace is required' }), { status: 400 }));
    await expect(fetchWorkspaceWorkflowsHome('')).rejects.toThrow('Workspace is required');
  });

  it('loads launch options and posts workflow launch requests', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ options: { workspaceId: 'workspace-a', workflow: { id: 'design-a', title: 'Workflow', description: null, source: 'published_design', status: 'ready', version: 1, unavailableReason: null, canRun: true, inputs: [], roles: [] }, sessions: [] } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ run: { runId: 'run-a', workspaceId: 'workspace-a', status: 'running', detailUrl: null } }), { status: 201 }));

    await expect(fetchWorkflowLaunchOptions('workspace-a', 'design-a', 1)).resolves.toMatchObject({ workspaceId: 'workspace-a' });
    await expect(launchWorkspaceWorkflow({ workspaceId: 'workspace-a', designId: 'design-a', inputs: {}, roleBindings: {}, additionalInstructions: 'Keep it clean.' })).resolves.toMatchObject({ run: { runId: 'run-a' } });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/dashboard/api/workflows/launch-options?workspaceId=workspace-a&designId=design-a&version=1');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/dashboard/api/workflows/launch');
    expect(JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body))).toMatchObject({ additionalInstructions: 'Keep it clean.' });
  });


  it('posts workflow batch launch requests', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ batch: { batchId: 'batch-a', workflowName: 'Workflow', status: 'running', counts: { total: 2, pending: 1, running: 1, completed: 0, blocked: 0, failed: 0, cancelled: 0 }, items: [{ itemIndex: 1, status: 'failed', runId: null, error: { code: 'workflow_launch_validation_failed', message: 'Missing field', fieldErrors: { featureRequest: 'This field is required.' } } }], updatedAt: 1, detailUrl: null } }), { status: 201 }));
    await expect(batchLaunchWorkspaceWorkflow({ workspaceId: 'workspace-a', designId: 'design-a', items: [{ inputs: { featureRequest: 'One' } }], roleBindings: {} })).resolves.toMatchObject({ batch: { batchId: 'batch-a', items: [{ error: { fieldErrors: { featureRequest: 'This field is required.' } } }] } });
    expect(fetchMock).toHaveBeenCalledWith('/dashboard/api/workflows/batches', expect.objectContaining({ method: 'POST' }));
  });

  it('fetches workflow batch detail read models', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ batch: { batchId: 'batch-a', workflowName: 'Workflow', status: 'running', counts: { total: 1, pending: 1, running: 0, completed: 0, blocked: 0, failed: 0, cancelled: 0 }, capacity: { globalActiveRunLimit: 4, workspaceActiveRunLimit: 1, globalActiveRuns: 1, workspaceActiveRuns: 1, explanation: 'Pending items are waiting.' }, items: [{ batchItemId: 'item-a', lineNumber: 1, itemIndex: 0, inputSummary: 'featureRequest: One', status: 'pending', runId: null, runUrl: null, error: null, startedAt: null, completedAt: null, updatedAt: 1, pendingReason: 'Pending items are waiting.' }], createdAt: 1, updatedAt: 1 } })));
    await expect(fetchWorkflowBatchDetail('batch/a')).resolves.toMatchObject({ batchId: 'batch-a', items: [{ lineNumber: 1, pendingReason: 'Pending items are waiting.' }] });
    expect(fetchMock).toHaveBeenCalledWith('/dashboard/api/workflows/batches/batch%2Fa', { headers: { Accept: 'application/json' } });
  });

  it('uses workflow templates through the product API', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ design: { designId: 'design-drt', name: 'Dev / Review / Tester', latestPublishedVersion: 1 }, draft: { draftId: 'draft-drt', designId: 'design-drt' }, version: { designId: 'design-drt', version: 1 }, home: { workspaceId: 'workspace-a', userWorkflows: [], starterTemplates: [], recentRuns: [], needsInput: [], recentBatches: [] } }), { status: 201, headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchMock);

    await expect(useWorkflowTemplate({ templateId: 'built-in/dev-review-tester', workspaceId: 'workspace-a' })).resolves.toMatchObject({ version: { version: 1 } });
    expect(fetchMock).toHaveBeenCalledWith('/dashboard/api/workflow-templates/built-in%2Fdev-review-tester/use', expect.objectContaining({ method: 'POST', body: JSON.stringify({ workspaceId: 'workspace-a', name: undefined, publish: true }) }));
  });
});

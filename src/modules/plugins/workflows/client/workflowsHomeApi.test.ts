import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWorkflowLaunchOptions, fetchWorkspaceWorkflowsHome, launchWorkspaceWorkflow } from './workflowsHomeApi';

describe('workflows home API client', () => {
  afterEach(() => vi.restoreAllMocks());

  it('loads workspace workflows home by workspace id', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ home: { workspaceId: 'workspace-a', availableWorkflows: [], recentRuns: [], needsInput: [] } })));

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
});

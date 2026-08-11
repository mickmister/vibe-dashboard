import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWorkspaceWorkflowsHome } from './workflowsHomeApi';

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
});

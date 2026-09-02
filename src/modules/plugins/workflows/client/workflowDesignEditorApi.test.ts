import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWorkflowDesign, fetchWorkflowDesignEditor, publishWorkflowDesignDraft, saveWorkflowDesignDraft } from './workflowDesignEditorApi';

describe('workflowDesignEditorApi', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('loads workflow graph editor models', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ editor: { designId: 'design-a', name: 'Workflow A', description: null, draftId: 'draft-a', version: 1, readonly: false, definition: { schemaVersion: 1, name: 'Workflow A', roles: {}, initialState: 'done', states: { done: { terminal: true } } }, validationStatus: 'valid', validationIssues: [] } }), { status: 200, headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchWorkflowDesignEditor('design-a')).resolves.toMatchObject({ designId: 'design-a', draftId: 'draft-a' });
    expect(fetchMock).toHaveBeenCalledWith('/dashboard/api/workflow-designs/design-a/editor', { headers: { Accept: 'application/json' } });
  });

  it('saves workflow graph editor draft definitions', async () => {
    const definition = { schemaVersion: 1, name: 'Workflow A', roles: {}, initialState: 'done', states: { done: { terminal: true } } } as any;
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ editor: { designId: 'design-a', name: 'Workflow A', description: null, draftId: 'draft-a', version: 1, readonly: false, definition, validationStatus: 'valid', validationIssues: [] } }), { status: 200, headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchMock);

    await expect(saveWorkflowDesignDraft('draft-a', definition)).resolves.toMatchObject({ designId: 'design-a' });
    expect(fetchMock).toHaveBeenCalledWith('/dashboard/api/workflow-design-drafts/draft-a', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ definition }) }));
  });

  it('publishes workflow design drafts', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ editor: { designId: 'design-a', name: 'Workflow A', description: null, draftId: 'draft-a', version: 2, readonly: false, definition: { schemaVersion: 1, name: 'Workflow A', roles: {}, initialState: 'done', states: { done: { terminal: true } } }, validationStatus: 'valid', validationIssues: [] } }), { status: 200, headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchMock);

    await expect(publishWorkflowDesignDraft('draft-a')).resolves.toMatchObject({ version: 2 });
    expect(fetchMock).toHaveBeenCalledWith('/dashboard/api/workflow-design-drafts/draft-a/publish', expect.objectContaining({ method: 'POST' }));
  });

  it('creates workflow designs from wizard requests', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ design: { designId: 'design-a', name: 'Wizard', latestPublishedVersion: 1 }, draft: { draftId: 'draft-a', designId: 'design-a' }, version: { designId: 'design-a', version: 1 }, editor: { designId: 'design-a', name: 'Wizard', description: null, draftId: 'draft-a', version: 1, readonly: false, definition: { schemaVersion: 1, name: 'Wizard', roles: {}, initialState: 'done', states: { done: { terminal: true } } }, validationStatus: 'valid', validationIssues: [] } }), { status: 201, headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchMock);

    await expect(createWorkflowDesign({ workspaceId: 'workspace-a', name: 'Wizard', sourceDesignId: 'design-source', publish: true })).resolves.toMatchObject({ design: { designId: 'design-a' }, version: { version: 1 } });
    expect(fetchMock).toHaveBeenCalledWith('/dashboard/api/workflow-designs', expect.objectContaining({ method: 'POST', body: JSON.stringify({ workspaceId: 'workspace-a', name: 'Wizard', sourceDesignId: 'design-source', publish: true }) }));
  });
});

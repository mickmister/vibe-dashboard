import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWorkflowDesignEditor, saveWorkflowDesignDraft } from './workflowDesignEditorApi';

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
});

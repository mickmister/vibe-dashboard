import { afterEach, describe, expect, it, vi } from 'vitest';
import { completeWorkflowAttentionItem, fetchWorkflowAttentionItems } from './workflowAttentionApi';

describe('workflow attention API client', () => {
  afterEach(() => vi.restoreAllMocks());

  it('loads active human attention items with feed filters', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ items: [], limit: 20, offset: 0, hasMore: false })));

    await expect(fetchWorkflowAttentionItems({ status: 'active', teamId: 'team-a', limit: 20 })).resolves.toMatchObject({ items: [] });

    expect(fetchMock).toHaveBeenCalledWith('/dashboard/api/workflow-attention-items?status=active&teamId=team-a&limit=20', { headers: { Accept: 'application/json' } });
  });

  it('submits beads-form answers to complete a human attention item', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ result: { applied: true, reason: 'applied', validationErrors: [] } })));

    await expect(completeWorkflowAttentionItem('attention/1', { stateVisitId: 'visit-1', submission: { approved: true } })).resolves.toMatchObject({ applied: true });

    expect(fetchMock).toHaveBeenCalledWith('/dashboard/api/workflow-attention-items/attention%2F1/complete', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ stateVisitId: 'visit-1', submission: { approved: true } }),
    });
  });
});

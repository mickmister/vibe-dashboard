import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWorkflowAssets } from './workflowAssetsApi';

describe('workflowAssetsApi', () => {
  afterEach(() => vi.restoreAllMocks());

  it('TEST_CASE_M108_1C fetches prompt and skill assets with source/version metadata', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ prompts: [{ kind: 'prompt', id: 'prompt.dev', version: 2, name: 'Dev prompt', description: null, source: 'built_in', preview: 'Implement.' }], skills: [{ kind: 'skill', id: 'skill.testing', version: 1, name: 'Testing skill', description: 'Use tests', source: 'user', preview: 'Write tests.' }] })));
    await expect(fetchWorkflowAssets()).resolves.toMatchObject({ prompts: [{ id: 'prompt.dev', version: 2, source: 'built_in' }], skills: [{ id: 'skill.testing', source: 'user' }] });
    expect(fetchMock).toHaveBeenCalledWith('/dashboard/api/workflow-assets', { headers: { Accept: 'application/json' } });
  });
});

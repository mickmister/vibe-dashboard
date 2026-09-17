import { describe, expect, it, vi } from 'vitest';
import { fetchExternalKanbanBoardView } from './boardApi';

describe('fetchExternalKanbanBoardView', () => {
  it('routes provider board requests through the neutral external_view_url contract', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true, boardView: { provider: 'github' } }), {
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;

    const result = await fetchExternalKanbanBoardView({
      provider: 'github',
      externalViewUrl: 'https://github.com/jamtools/springboard/issues?q=is%3Aissue',
      fetchImpl,
    });

    expect(result.ok).toBe(true);
    expect(vi.mocked(fetchImpl).mock.calls[0]?.[0]).toBe('/dashboard/api/external-trackers/github/board?external_view_url=https%3A%2F%2Fgithub.com%2Fjamtools%2Fspringboard%2Fissues%3Fq%3Dis%253Aissue');
  });
});

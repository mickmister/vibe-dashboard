import { describe, expect, it, vi } from 'vitest';
import { fetchExternalLinearBoardView } from './externalTrackerBoardApi';

describe('fetchExternalLinearBoardView', () => {
  it('uses the neutral Linear board endpoint and external_view_url contract', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true, boardView: { provider: 'linear' } }), {
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;

    const result = await fetchExternalLinearBoardView({
      externalViewUrl: 'https://linear.app/jamtools/team/VD/all?status=Todo',
      fetchImpl,
    });

    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith('/dashboard/api/external-trackers/linear/board?external_view_url=https%3A%2F%2Flinear.app%2Fjamtools%2Fteam%2FVD%2Fall%3Fstatus%3DTodo', expect.any(Object));
  });
});

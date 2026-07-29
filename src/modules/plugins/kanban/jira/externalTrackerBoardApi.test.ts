import { describe, expect, it, vi } from 'vitest';
import { fetchExternalJiraBoardView } from './externalTrackerBoardApi';

describe('fetchExternalJiraBoardView', () => {
  it('encodes the external Jira URL using the canonical query param', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true, boardView: { provider: 'jira' } }), {
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;

    const result = await fetchExternalJiraBoardView({
      externalViewUrl: 'https://team.atlassian.net/jira/software/projects/VD/boards/42?selectedIssue=VD-1',
      fetchImpl,
    });

    expect(result.ok).toBe(true);
    expect(vi.mocked(fetchImpl).mock.calls[0]?.[0]).toBe('/dashboard/api/external-trackers/jira/board?external_view_url=https%3A%2F%2Fteam.atlassian.net%2Fjira%2Fsoftware%2Fprojects%2FVD%2Fboards%2F42%3FselectedIssue%3DVD-1');
  });

  it('turns a non-JSON 404 into a user-actionable feature-gate error', async () => {
    const fetchImpl = vi.fn(async () => new Response('not found', { status: 404 })) as unknown as typeof fetch;

    const result = await fetchExternalJiraBoardView({ externalViewUrl: 'https://team.atlassian.net/jira/software/projects/VD/boards/42', fetchImpl });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'external_trackers_disabled',
        message: 'External tracker views are disabled or unavailable.',
        userAction: 'Enable the external tracker feature flag and try again.',
      },
    });
  });
});

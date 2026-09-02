import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAgentTeam } from '../teams/agentTeams';
import { applyResolvedSessionsToTeam, resolveTeamSessionMappings } from './teamSessionMappingApi';

afterEach(() => vi.restoreAllMocks());

describe('team session mapping API', () => {
  it('posts resolver input and returns resolution payload', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true, results: [], errors: [], warnings: [] }), { status: 200 }));
    const team = teamFixture();

    await expect(resolveTeamSessionMappings({ team, workspaceId: 'ws-1', allowAutoCreate: true })).resolves.toMatchObject({ ok: true });

    expect(fetchMock).toHaveBeenCalledWith('/dashboard/api/agent-team-session-mappings/resolve', expect.objectContaining({ method: 'POST' }));
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({ workspaceId: 'ws-1', allowAutoCreate: true, team: { id: 'team-1' } });
  });

  it('applies resolved session refs to matching team roles only when resolution succeeds', () => {
    const team = teamFixture();
    const updated = applyResolvedSessionsToTeam(team, {
      ok: true,
      warnings: [],
      errors: [],
      results: [{ roleId: 'agent-a', roleName: 'Agent A', status: 'resolved', sessionId: 'session-a', workspaceId: 'ws-1', laneId: null, executor: 'CODEX', source: 'auto_created', bindingId: 'binding-a', warnings: [], error: null }],
    });

    expect(updated.agents[0]).toMatchObject({ vkWorkspaceId: 'ws-1', vkSessionId: 'session-a', executor: 'CODEX' });
    expect(updated.agents[1]?.vkSessionId).toBeNull();
    expect(applyResolvedSessionsToTeam(team, { ok: false, warnings: [], errors: [], results: [] })).toBe(team);
  });
});

function teamFixture() {
  return createAgentTeam({
    id: 'team-1',
    name: 'Team',
    agents: [
      { id: 'agent-a', role: 'orchestrator', displayName: 'Agent A', vkSessionId: null },
      { id: 'agent-b', role: 'implementer', displayName: 'Agent B', vkSessionId: null },
    ],
  }, { now: '2026-08-04T00:00:00.000Z' });
}

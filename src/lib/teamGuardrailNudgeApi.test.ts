import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildTeamNudgePreview, runTeamGuardrailNudgeWorkflow } from './teamGuardrailNudgeApi';
import type { AgentTeam } from '../teams/agentTeams';

describe('team guardrail nudge API helpers', () => {
  afterEach(() => vi.restoreAllMocks());

  it('runs the guarded nudge workflow through workflow routes', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ run: { runId: 'run_nudge' } })));
    const input = { team: team(), agentActivity: [], staleAfterMinutes: 45 };
    await expect(runTeamGuardrailNudgeWorkflow(input)).resolves.toMatchObject({ run: { runId: 'run_nudge' } });
    expect(fetchMock).toHaveBeenCalledWith('/dashboard/api/workflows/team-guardrail-nudge/run', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  });

  it('previews stale nudges and cap escalations without queueing', () => {
    const preview = buildTeamNudgePreview({
      team: team({ maxNudgesPerRun: 1 }),
      now: '2026-07-22T12:00:00.000Z',
      staleAfterMinutes: 30,
      agentActivity: [
        { agentId: 'agent-orch', lastActivityAt: '2026-07-22T11:00:00.000Z', nudgeCount: 0 },
        { agentId: 'agent-impl', lastActivityAt: '2026-07-22T11:00:00.000Z', nudgeCount: 0 },
        { agentId: 'agent-review', lastActivityAt: null, nudgeCount: 0 },
      ],
    });

    expect(preview.nudges).toEqual([expect.objectContaining({ agentId: 'agent-orch', action: 'nudge', staleMinutes: 60 })]);
    expect(preview.escalations).toEqual([expect.objectContaining({ agentId: 'agent-impl', action: 'escalate', reason: 'nudge_cap_reached' })]);
    expect(preview.skipped).toEqual(expect.arrayContaining([expect.objectContaining({ agentId: 'agent-review', reason: 'missing_activity' })]));
  });
});

function team(policies: Partial<AgentTeam['policies']> = {}): AgentTeam {
  return {
    id: 'team-1',
    version: 1,
    name: 'Team One',
    orchestratorAgentId: 'agent-orch',
    agents: [
      { id: 'agent-orch', role: 'orchestrator', displayName: 'Orchestrator', enabled: true, vkWorkspaceId: 'ws-1', vkSessionId: 'session-orch', executor: 'CODEX', instructions: null },
      { id: 'agent-impl', role: 'implementer', displayName: 'Implementer', enabled: true, vkWorkspaceId: 'ws-1', vkSessionId: 'session-impl', executor: 'CODEX', instructions: null },
      { id: 'agent-review', role: 'reviewer', displayName: 'Reviewer', enabled: true, vkWorkspaceId: 'ws-1', vkSessionId: 'session-review', executor: 'CODEX', instructions: null },
    ],
    policies: { maxConcurrentAgents: 3, requireOrchestrator: true, allowWorkspaceParallelism: false, nudgeAfterMs: null, maxNudgesPerRun: 3, ...policies },
    workflowBindings: [],
    createdAt: '2026-07-22T00:00:00.000Z',
    updatedAt: '2026-07-22T00:00:00.000Z',
  };
}

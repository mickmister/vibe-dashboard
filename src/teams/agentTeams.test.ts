import { describe, expect, it } from 'vitest';
import {
  addAgentTeam,
  createAgentTeam,
  createDefaultAgentTeamState,
  deleteAgentTeam,
  migrateAgentTeamState,
  selectAgentTeam,
  updateAgentTeam,
  validateAgentTeam,
} from './agentTeams';

describe('agent team config model', () => {
  const ids = {
    teamId: () => 'team-1',
    agentId: (() => {
      let index = 0;
      return () => ['agent-orch', 'agent-impl', 'agent-reviewer'][index++] ?? `agent-${index}`;
    })(),
    bindingId: () => 'binding-1',
  };

  it('creates versioned teams with defaults and workflow bindings', () => {
    const team = createAgentTeam({
      name: 'Ship It',
      agents: [
        { role: 'orchestrator', displayName: 'PM' },
        { role: 'implementer', displayName: 'Builder', vkSessionId: 'session-1' },
      ],
      workflowBindings: [{ workflowId: 'manual-agent-team-runner' }],
    }, { ids, now: '2026-07-22T00:00:00.000Z' });

    expect(team).toMatchObject({
      id: 'team-1',
      version: 1,
      name: 'Ship It',
      orchestratorAgentId: 'agent-orch',
      policies: {
        maxConcurrentAgents: 4,
        requireOrchestrator: true,
        allowWorkspaceParallelism: false,
        nudgeAfterMs: null,
        maxNudgesPerRun: 3,
      },
      workflowBindings: [{ id: 'binding-1', workflowId: 'manual-agent-team-runner', trigger: 'manual', enabled: true }],
    });
  });

  it('adds updates selects and deletes teams immutably', () => {
    let state = createDefaultAgentTeamState();
    state = addAgentTeam(state, {
      id: 'team-a',
      name: 'Team A',
      agents: [{ id: 'agent-a', role: 'orchestrator', displayName: 'Lead' }],
    }, { now: '2026-07-22T00:00:00.000Z' });
    expect(state.selectedTeamId).toBe('team-a');

    state = updateAgentTeam(state, 'team-a', {
      name: 'Team Alpha',
      policies: { maxConcurrentAgents: 8, allowWorkspaceParallelism: true },
    }, '2026-07-22T00:01:00.000Z');
    expect(state.teams[0]).toMatchObject({
      name: 'Team Alpha',
      policies: { maxConcurrentAgents: 8, allowWorkspaceParallelism: true },
      updatedAt: '2026-07-22T00:01:00.000Z',
    });

    state = selectAgentTeam(state, null);
    expect(state.selectedTeamId).toBeNull();
    state = deleteAgentTeam(state, 'team-a');
    expect(state.teams).toEqual([]);
  });

  it('migrates legacy or partial state to the current version', () => {
    const migrated = migrateAgentTeamState({
      version: 0,
      selectedTeamId: 'missing',
      teams: [{
        id: 'team-old',
        name: 'Old Team',
        orchestratorAgentId: 'agent-old',
        agents: [{ id: 'agent-old', role: 'orchestrator', displayName: 'Old Lead' }],
        policies: { maxConcurrentAgents: -1 },
      }],
    });

    expect(migrated).toMatchObject({
      version: 1,
      selectedTeamId: 'team-old',
      teams: [{ id: 'team-old', policies: { maxConcurrentAgents: 4 } }],
    });
  });

  it('rejects invalid teams before storage', () => {
    expect(() => validateAgentTeam({
      ...createAgentTeam({
        id: 'team-bad',
        name: 'Bad',
        agents: [{ id: 'agent-1', role: 'implementer', displayName: 'Builder' }],
      }),
      orchestratorAgentId: 'missing-agent',
    })).toThrow(/Orchestrator agent not found/);

    expect(() => addAgentTeam(createDefaultAgentTeamState(), {
      id: 'team-empty',
      name: '',
      agents: [{ id: 'agent-1', role: 'orchestrator', displayName: 'Lead' }],
    })).toThrow(/Team name is required/);
  });
});

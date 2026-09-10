import springboard, { type ModuleAPI } from 'springboard';
import {
  addAgentTeam,
  createDefaultAgentTeamState,
  deleteAgentTeam,
  selectAgentTeam,
  updateAgentTeam,
  type AgentTeamState,
  type CreateAgentTeamInput,
  type UpdateAgentTeamInput,
} from '../teams/agentTeams';

export type AgentTeamsModuleReturnValue = Awaited<ReturnType<typeof createAgentTeamsModule>>;

springboard.registerModule('agentTeams', { rpcMode: 'remote' }, async (moduleAPI): Promise<AgentTeamsModuleReturnValue> => {
  return createAgentTeamsModule(moduleAPI);
});

export async function createAgentTeamsModule(moduleAPI: ModuleAPI) {
  const teamState = await moduleAPI.statesAPI.createPersistentState<AgentTeamState>(
    'agent-teams',
    createDefaultAgentTeamState(),
  );

  const actions = moduleAPI.createActions({
    createTeam: async (input: CreateAgentTeamInput) => {
      return teamState.setState((state) => addAgentTeam(state, input));
    },
    updateTeam: async (args: { teamId: string; patch: UpdateAgentTeamInput }) => {
      return teamState.setState((state) => updateAgentTeam(state, args.teamId, args.patch));
    },
    deleteTeam: async (args: { teamId: string }) => {
      return teamState.setState((state) => deleteAgentTeam(state, args.teamId));
    },
    selectTeam: async (args: { teamId: string | null }) => {
      return teamState.setState((state) => selectAgentTeam(state, args.teamId));
    },
  });

  return {
    states: {
      teams: teamState,
    },
    actions,
  };
}

declare module 'springboard/module_registry/module_registry' {
  interface AllModules {
    agentTeams: AgentTeamsModuleReturnValue;
  }
}

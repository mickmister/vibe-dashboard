import type { AgentTeam } from '../teams/agentTeams';

export interface RoleSessionOverrideInput {
  sessionId: string;
  executor?: string | null;
}

export interface ResolveTeamSessionMappingsInput {
  team: AgentTeam;
  workspaceId: string;
  workflowId?: string | null;
  laneId?: string | null;
  roleIds?: string[];
  overrides?: Record<string, RoleSessionOverrideInput | string | null | undefined>;
  allowAutoCreate?: boolean;
  allowRoleNameReuse?: boolean;
}

export interface RoleSessionResolutionResult {
  roleId: string;
  roleName: string;
  status: 'resolved' | 'error';
  sessionId: string | null;
  workspaceId: string;
  laneId: string | null;
  executor: string | null;
  source: string | null;
  bindingId: string | null;
  warnings: string[];
  error: string | null;
}

export interface ResolveTeamSessionMappingsResult {
  ok: boolean;
  results: RoleSessionResolutionResult[];
  errors: RoleSessionResolutionResult[];
  warnings: string[];
}

export async function resolveTeamSessionMappings(input: ResolveTeamSessionMappingsInput): Promise<ResolveTeamSessionMappingsResult> {
  const response = await fetch('/dashboard/api/agent-team-session-mappings/resolve', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const payload = await response.json().catch(() => ({})) as Partial<ResolveTeamSessionMappingsResult> & { error?: string };
  if (!response.ok && payload.ok === undefined) throw new Error(payload.error || `Failed to resolve team session mappings: ${response.status}`);
  return payload as ResolveTeamSessionMappingsResult;
}

export function applyResolvedSessionsToTeam(team: AgentTeam, resolution: ResolveTeamSessionMappingsResult): AgentTeam {
  if (!resolution.ok) return team;
  const byRoleId = new Map(resolution.results.filter((result) => result.status === 'resolved' && result.sessionId).map((result) => [result.roleId, result]));
  return {
    ...team,
    agents: team.agents.map((agent) => {
      const resolved = byRoleId.get(agent.id);
      if (!resolved?.sessionId) return agent;
      return {
        ...agent,
        vkWorkspaceId: resolved.workspaceId,
        vkSessionId: resolved.sessionId,
        executor: resolved.executor ?? agent.executor ?? null,
      };
    }),
  };
}

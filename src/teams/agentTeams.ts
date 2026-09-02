export const AGENT_TEAM_STATE_VERSION = 1;

export type TeamAgentRole = 'orchestrator' | 'implementer' | 'reviewer' | 'pm' | 'assistant' | string;
export type TeamWorkflowTrigger = 'manual' | 'github.workflow_run' | 'scheduled' | string;

export interface TeamAgent {
  id: string;
  role: TeamAgentRole;
  displayName: string;
  enabled: boolean;
  vkWorkspaceId?: string | null;
  vkSessionId?: string | null;
  executor?: string | null;
  instructions?: string | null;
}

export interface TeamPolicies {
  maxConcurrentAgents: number;
  requireOrchestrator: boolean;
  allowWorkspaceParallelism: boolean;
  nudgeAfterMs: number | null;
  maxNudgesPerRun: number;
}

export interface WorkflowBinding {
  id: string;
  workflowId: string;
  trigger: TeamWorkflowTrigger;
  enabled: boolean;
  inputDefaults?: Record<string, unknown>;
}

export interface AgentTeam {
  id: string;
  version: typeof AGENT_TEAM_STATE_VERSION;
  name: string;
  description?: string | null;
  orchestratorAgentId: string;
  agents: TeamAgent[];
  policies: TeamPolicies;
  workflowBindings: WorkflowBinding[];
  createdAt: string;
  updatedAt: string;
}

export interface AgentTeamState {
  version: typeof AGENT_TEAM_STATE_VERSION;
  teams: AgentTeam[];
  selectedTeamId: string | null;
}

export type AgentTeamStateInput = Partial<AgentTeamState> | { teams?: unknown; version?: unknown; selectedTeamId?: unknown } | null | undefined;

export interface CreateAgentTeamInput {
  id?: string;
  name: string;
  description?: string | null;
  agents?: Array<Partial<TeamAgent> & { id?: string; role: TeamAgentRole; displayName?: string }>;
  orchestratorAgentId?: string;
  policies?: Partial<TeamPolicies>;
  workflowBindings?: Array<Partial<WorkflowBinding> & { workflowId: string; trigger?: TeamWorkflowTrigger }>;
}

export interface UpdateAgentTeamInput {
  name?: string;
  description?: string | null;
  orchestratorAgentId?: string;
  agents?: TeamAgent[];
  policies?: Partial<TeamPolicies>;
  workflowBindings?: WorkflowBinding[];
}

export interface AgentTeamIdFactory {
  teamId?: () => string;
  agentId?: () => string;
  bindingId?: () => string;
}

const DEFAULT_POLICIES: TeamPolicies = {
  maxConcurrentAgents: 4,
  requireOrchestrator: true,
  allowWorkspaceParallelism: false,
  nudgeAfterMs: null,
  maxNudgesPerRun: 3,
};

export function createDefaultAgentTeamState(): AgentTeamState {
  return { version: AGENT_TEAM_STATE_VERSION, teams: [], selectedTeamId: null };
}

export function migrateAgentTeamState(input: AgentTeamStateInput): AgentTeamState {
  const state = input && typeof input === 'object' ? input as Partial<AgentTeamState> : {};
  const teams = Array.isArray(state.teams)
    ? state.teams.map((team) => normalizeAgentTeam(team)).filter((team): team is AgentTeam => team !== null)
    : [];
  const selectedTeamId = typeof state.selectedTeamId === 'string' && teams.some((team) => team.id === state.selectedTeamId)
    ? state.selectedTeamId
    : teams[0]?.id ?? null;
  return { version: AGENT_TEAM_STATE_VERSION, teams, selectedTeamId };
}

export function createAgentTeam(
  input: CreateAgentTeamInput,
  options: { now?: string; ids?: AgentTeamIdFactory } = {},
): AgentTeam {
  const now = options.now ?? new Date().toISOString();
  const ids = options.ids ?? {};
  const teamId = nonEmpty(input.id) ?? ids.teamId?.() ?? createRandomId('team');
  const agents = normalizeInputAgents(input.agents, ids);
  const orchestratorAgentId = input.orchestratorAgentId ?? agents.find((agent) => agent.role === 'orchestrator')?.id ?? agents[0]?.id;
  const team: AgentTeam = {
    id: teamId,
    version: AGENT_TEAM_STATE_VERSION,
    name: requireNonEmpty(input.name, 'Team name is required'),
    description: input.description ?? null,
    orchestratorAgentId: requireNonEmpty(orchestratorAgentId, 'At least one team agent is required'),
    agents,
    policies: normalizePolicies(input.policies),
    workflowBindings: normalizeInputWorkflowBindings(input.workflowBindings, ids),
    createdAt: now,
    updatedAt: now,
  };
  validateAgentTeam(team);
  return team;
}

export function addAgentTeam(state: AgentTeamStateInput, input: CreateAgentTeamInput, options: { now?: string; ids?: AgentTeamIdFactory } = {}): AgentTeamState {
  const current = migrateAgentTeamState(state);
  const team = createAgentTeam(input, options);
  if (current.teams.some((existing) => existing.id === team.id)) {
    throw new Error(`Agent team already exists: ${team.id}`);
  }
  return {
    ...current,
    teams: [...current.teams, team],
    selectedTeamId: current.selectedTeamId ?? team.id,
  };
}

export function updateAgentTeam(state: AgentTeamStateInput, teamId: string, input: UpdateAgentTeamInput, now = new Date().toISOString()): AgentTeamState {
  const current = migrateAgentTeamState(state);
  let found = false;
  const teams = current.teams.map((team) => {
    if (team.id !== teamId) return team;
    found = true;
    const updated: AgentTeam = {
      ...team,
      name: input.name !== undefined ? requireNonEmpty(input.name, 'Team name is required') : team.name,
      description: input.description !== undefined ? input.description : team.description,
      orchestratorAgentId: input.orchestratorAgentId ?? team.orchestratorAgentId,
      agents: input.agents ? input.agents.map((agent) => normalizeTeamAgent(agent)).filter((agent): agent is TeamAgent => agent !== null) : team.agents,
      policies: normalizePolicies({ ...team.policies, ...input.policies }),
      workflowBindings: input.workflowBindings ? input.workflowBindings.map((binding) => normalizeWorkflowBinding(binding)).filter((binding): binding is WorkflowBinding => binding !== null) : team.workflowBindings,
      updatedAt: now,
    };
    validateAgentTeam(updated);
    return updated;
  });
  if (!found) throw new Error(`Agent team not found: ${teamId}`);
  return { ...current, teams };
}

export function deleteAgentTeam(state: AgentTeamStateInput, teamId: string): AgentTeamState {
  const current = migrateAgentTeamState(state);
  const teams = current.teams.filter((team) => team.id !== teamId);
  return {
    ...current,
    teams,
    selectedTeamId: current.selectedTeamId === teamId ? teams[0]?.id ?? null : current.selectedTeamId,
  };
}

export function selectAgentTeam(state: AgentTeamStateInput, teamId: string | null): AgentTeamState {
  const current = migrateAgentTeamState(state);
  if (teamId !== null && !current.teams.some((team) => team.id === teamId)) {
    throw new Error(`Agent team not found: ${teamId}`);
  }
  return { ...current, selectedTeamId: teamId };
}

export function validateAgentTeam(team: AgentTeam): void {
  requireNonEmpty(team.id, 'Team id is required');
  requireNonEmpty(team.name, 'Team name is required');
  if (team.agents.length === 0) throw new Error('At least one team agent is required');
  const agentIds = new Set<string>();
  for (const agent of team.agents) {
    requireNonEmpty(agent.id, 'Agent id is required');
    requireNonEmpty(agent.role, 'Agent role is required');
    requireNonEmpty(agent.displayName, 'Agent display name is required');
    if (agentIds.has(agent.id)) throw new Error(`Duplicate team agent id: ${agent.id}`);
    agentIds.add(agent.id);
  }
  if (!agentIds.has(team.orchestratorAgentId)) {
    throw new Error(`Orchestrator agent not found: ${team.orchestratorAgentId}`);
  }
  const bindingIds = new Set<string>();
  for (const binding of team.workflowBindings) {
    requireNonEmpty(binding.id, 'Workflow binding id is required');
    requireNonEmpty(binding.workflowId, 'Workflow binding workflowId is required');
    if (bindingIds.has(binding.id)) throw new Error(`Duplicate workflow binding id: ${binding.id}`);
    bindingIds.add(binding.id);
  }
}

function normalizeAgentTeam(value: unknown): AgentTeam | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<AgentTeam>;
  const agents = Array.isArray(record.agents)
    ? record.agents.map((agent) => normalizeTeamAgent(agent)).filter((agent): agent is TeamAgent => agent !== null)
    : [];
  if (!record.id || !record.name || agents.length === 0) return null;
  const team: AgentTeam = {
    id: record.id,
    version: AGENT_TEAM_STATE_VERSION,
    name: record.name,
    description: record.description ?? null,
    orchestratorAgentId: record.orchestratorAgentId && agents.some((agent) => agent.id === record.orchestratorAgentId)
      ? record.orchestratorAgentId
      : agents.find((agent) => agent.role === 'orchestrator')?.id ?? agents[0]!.id,
    agents,
    policies: normalizePolicies(record.policies),
    workflowBindings: Array.isArray(record.workflowBindings)
      ? record.workflowBindings.map((binding) => normalizeWorkflowBinding(binding)).filter((binding): binding is WorkflowBinding => binding !== null)
      : [],
    createdAt: record.createdAt ?? record.updatedAt ?? new Date(0).toISOString(),
    updatedAt: record.updatedAt ?? record.createdAt ?? new Date(0).toISOString(),
  };
  try {
    validateAgentTeam(team);
    return team;
  } catch {
    return null;
  }
}

function normalizeInputAgents(input: CreateAgentTeamInput['agents'], ids: AgentTeamIdFactory): TeamAgent[] {
  const agents = input && input.length > 0 ? input : [{ role: 'orchestrator', displayName: 'Orchestrator' }];
  return agents.map((agent) => normalizeTeamAgent({
    ...agent,
    id: nonEmpty(agent.id) ?? ids.agentId?.() ?? createRandomId('agent'),
    displayName: nonEmpty(agent.displayName) ?? titleCase(String(agent.role)),
  })).filter((agent): agent is TeamAgent => agent !== null);
}

function normalizeTeamAgent(value: unknown): TeamAgent | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<TeamAgent>;
  if (!record.id || !record.role || !record.displayName) return null;
  return {
    id: record.id,
    role: record.role,
    displayName: record.displayName,
    enabled: record.enabled ?? true,
    vkWorkspaceId: record.vkWorkspaceId ?? null,
    vkSessionId: record.vkSessionId ?? null,
    executor: record.executor ?? null,
    instructions: record.instructions ?? null,
  };
}

function normalizeInputWorkflowBindings(input: CreateAgentTeamInput['workflowBindings'], ids: AgentTeamIdFactory): WorkflowBinding[] {
  return (input ?? []).map((binding) => normalizeWorkflowBinding({
    ...binding,
    id: nonEmpty(binding.id) ?? ids.bindingId?.() ?? createRandomId('binding'),
    trigger: binding.trigger ?? 'manual',
    enabled: binding.enabled ?? true,
  })).filter((binding): binding is WorkflowBinding => binding !== null);
}

function normalizeWorkflowBinding(value: unknown): WorkflowBinding | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<WorkflowBinding>;
  if (!record.id || !record.workflowId) return null;
  return {
    id: record.id,
    workflowId: record.workflowId,
    trigger: record.trigger ?? 'manual',
    enabled: record.enabled ?? true,
    inputDefaults: record.inputDefaults ?? {},
  };
}

function normalizePolicies(input: Partial<TeamPolicies> | undefined): TeamPolicies {
  return {
    maxConcurrentAgents: positiveInteger(input?.maxConcurrentAgents, DEFAULT_POLICIES.maxConcurrentAgents),
    requireOrchestrator: input?.requireOrchestrator ?? DEFAULT_POLICIES.requireOrchestrator,
    allowWorkspaceParallelism: input?.allowWorkspaceParallelism ?? DEFAULT_POLICIES.allowWorkspaceParallelism,
    nudgeAfterMs: input?.nudgeAfterMs == null ? null : positiveInteger(input.nudgeAfterMs, DEFAULT_POLICIES.nudgeAfterMs ?? 0),
    maxNudgesPerRun: positiveInteger(input?.maxNudgesPerRun, DEFAULT_POLICIES.maxNudgesPerRun),
  };
}

function positiveInteger(value: unknown, fallback: number): number {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : fallback;
}

function requireNonEmpty(value: unknown, message: string): string {
  const normalized = nonEmpty(value);
  if (!normalized) throw new Error(message);
  return normalized;
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function createRandomId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function titleCase(value: string): string {
  return value.replace(/(^|[-_\s])([a-z])/g, (_match, sep: string, letter: string) => `${sep ? ' ' : ''}${letter.toUpperCase()}`).trim();
}

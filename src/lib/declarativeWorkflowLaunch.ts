import type { DeclarativeWorkflowDefinition, DeclarativeWorkflowInputSpec } from '../workflows/declarative/definitions';
import type { AgentTeam } from '../teams/agentTeams';
import type { Session } from './vk-client';

export interface DeclarativeWorkflowLaunchDraft {
  workspaceId: string;
  task: string;
  sourceRole: string;
  reviewRole: string;
  sourceSessionId: string;
  reviewSessionId: string;
  overseerSessionId: string;
  laneId: string;
}

export interface LaunchValidationResult {
  ok: boolean;
  fieldErrors: Partial<Record<keyof DeclarativeWorkflowLaunchDraft, string>>;
  formError: string | null;
}

export const DEFAULT_TWO_AGENT_LAUNCH_DRAFT: DeclarativeWorkflowLaunchDraft = {
  workspaceId: '',
  task: '',
  sourceRole: 'implementer',
  reviewRole: 'reviewer',
  sourceSessionId: '',
  reviewSessionId: '',
  overseerSessionId: '',
  laneId: '',
};

export function createDraftFromDefinition(definition: DeclarativeWorkflowDefinition | null, previous?: Partial<DeclarativeWorkflowLaunchDraft>): DeclarativeWorkflowLaunchDraft {
  const draft = { ...DEFAULT_TWO_AGENT_LAUNCH_DRAFT, ...previous };
  if (!definition) return draft;
  if (!definition.inputs.sourceRole && !previous?.sourceRole) draft.sourceRole = '';
  if (!definition.inputs.reviewRole && !previous?.reviewRole) draft.reviewRole = '';
  return draft;
}

export function validateDeclarativeWorkflowLaunch(definition: DeclarativeWorkflowDefinition | null, draft: DeclarativeWorkflowLaunchDraft): LaunchValidationResult {
  const fieldErrors: LaunchValidationResult['fieldErrors'] = {};
  if (!definition) return { ok: false, fieldErrors, formError: 'Choose a workflow definition before launching.' };
  for (const [key, spec] of Object.entries(definition.inputs)) {
    if (!isRequiredStringInput(spec)) continue;
    const value = draft[key as keyof DeclarativeWorkflowLaunchDraft];
    if (typeof value !== 'string' || !value.trim()) {
      fieldErrors[key as keyof DeclarativeWorkflowLaunchDraft] = `${inputLabel(key)} is required.`;
    }
  }
  if (definition.policies.blockSameSession && draft.sourceSessionId.trim() && draft.reviewSessionId.trim() && draft.sourceSessionId.trim() === draft.reviewSessionId.trim()) {
    fieldErrors.reviewSessionId = 'Source and reviewer must use different VK sessions.';
  }
  if (!draft.sourceSessionId.trim() && !draft.sourceRole.trim()) fieldErrors.sourceRole = 'Choose a source session or role.';
  if (!draft.reviewSessionId.trim() && !draft.reviewRole.trim()) fieldErrors.reviewRole = 'Choose a reviewer session or role.';
  return { ok: Object.keys(fieldErrors).length === 0, fieldErrors, formError: null };
}

export function buildDeclarativeWorkflowInput(draft: DeclarativeWorkflowLaunchDraft): Record<string, string> {
  return Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, value.trim()]).filter(([, value]) => value));
}

export function createMinimalWorkflowTeam(args: { sourceRole: string; reviewRole: string; sourceSessionId?: string | null; reviewSessionId?: string | null; workspaceId: string; workflowId?: string }): AgentTeam {
  const now = Date.now();
  return {
    id: `declarative_launch_${now}`,
    version: 1,
    name: 'Declarative workflow launch team',
    description: null,
    orchestratorAgentId: 'source',
    agents: [
      { id: 'source', role: args.sourceRole || 'implementer', displayName: args.sourceRole || 'Source', enabled: true, vkWorkspaceId: args.workspaceId, vkSessionId: args.sourceSessionId ?? null, executor: null, instructions: null },
      { id: 'review', role: args.reviewRole || 'reviewer', displayName: args.reviewRole || 'Reviewer', enabled: true, vkWorkspaceId: args.workspaceId, vkSessionId: args.reviewSessionId ?? null, executor: null, instructions: null },
    ],
    policies: {
      maxConcurrentAgents: 2,
      requireOrchestrator: false,
      maxNudgesPerRun: 3,
      nudgeAfterMs: 30 * 60_000,
      allowWorkspaceParallelism: false,
    },
    workflowBindings: [{ id: `${args.workflowId ?? 'two-agent-review-round'}-binding`, workflowId: args.workflowId ?? 'two-agent-review-round', trigger: 'manual', enabled: true }],
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
  };
}

export function describeDefinitionRoles(definition: DeclarativeWorkflowDefinition): string[] {
  return definition.steps.flatMap((step) => step.type === 'resolve_roles' ? step.roles.map((role) => `${role.key}: ${role.defaultRole ?? role.roleInput ?? role.sessionInput ?? 'role'}`) : []);
}

export function filterWorkflowSessionsForWorkspace(sessions: Session[], workspaceId: string): Session[] {
  const normalizedWorkspaceId = workspaceId.trim();
  if (!normalizedWorkspaceId) return [];
  return sessions.filter((session) => session.workspace_id === normalizedWorkspaceId);
}

function isRequiredStringInput(spec: DeclarativeWorkflowInputSpec): boolean {
  return spec.type === 'string' && spec.required;
}

function inputLabel(key: string): string {
  return key.replace(/Id$/, ' id').replace(/([A-Z])/g, ' $1').toLowerCase().replace(/^./, (char) => char.toUpperCase());
}

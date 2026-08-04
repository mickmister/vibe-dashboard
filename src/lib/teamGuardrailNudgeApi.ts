import type { AgentTeam } from '../teams/agentTeams';
import type {
  SkippedTeamNudge,
  TeamAgentActivitySnapshot,
  TeamGuardrailNudgeWorkflowOutput,
} from '../workflows/team-guardrail-nudge';
import type { RunManualWorkflowResponse } from './workflowRunsApi';

export interface TeamGuardrailNudgeInput {
  team: AgentTeam;
  agentActivity: TeamAgentActivitySnapshot[];
  workflowRunId?: string | null;
  taskPrompt?: string | null;
  staleAfterMinutes?: number;
  now?: number | string;
}

export interface TeamNudgePreviewAgent {
  agentId: string;
  displayName: string;
  role: string;
  action: 'nudge' | 'skip' | 'escalate';
  reason: 'stale' | SkippedTeamNudge['reason'];
  staleMinutes: number | null;
  nudgeCount: number;
  sessionId: string | null;
}

export interface TeamNudgePreview {
  staleAfterMinutes: number;
  maxNudgesPerRun: number;
  nudges: TeamNudgePreviewAgent[];
  skipped: TeamNudgePreviewAgent[];
  escalations: TeamNudgePreviewAgent[];
}

export async function runTeamGuardrailNudgeWorkflow(input: TeamGuardrailNudgeInput): Promise<RunManualWorkflowResponse & { run: RunManualWorkflowResponse['run'] & { output?: TeamGuardrailNudgeWorkflowOutput | null } }> {
  const response = await fetch('/dashboard/api/workflows/team-guardrail-nudge/run', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const payload = await response.json().catch(() => ({})) as RunManualWorkflowResponse & { error?: string };
  if (!response.ok) throw new Error(payload.error || `Failed to run guardrail nudge workflow: ${response.status}`);
  return payload as RunManualWorkflowResponse & { run: RunManualWorkflowResponse['run'] & { output?: TeamGuardrailNudgeWorkflowOutput | null } };
}

export function buildTeamNudgePreview(args: { team: AgentTeam; agentActivity: TeamAgentActivitySnapshot[]; staleAfterMinutes?: number | null; now?: number | string }): TeamNudgePreview {
  const nowMs = parseTime(args.now ?? Date.now());
  const staleAfterMinutes = resolveStaleAfterMinutes(args.team, args.staleAfterMinutes);
  const staleAfterMs = staleAfterMinutes * 60_000;
  const byAgentId = new Map(args.team.agents.map((agent) => [agent.id, agent]));
  const bySnapshotId = new Map(args.agentActivity.map((snapshot) => [snapshot.agentId, snapshot]));
  const nudges: TeamNudgePreviewAgent[] = [];
  const skipped: SkippedTeamNudge[] = [];
  const escalations: SkippedTeamNudge[] = [];
  let nudgeBudgetUsed = args.agentActivity.reduce((total, snapshot) => total + Math.max(0, snapshot.nudgeCount ?? 0), 0);

  for (const snapshot of args.agentActivity) {
    const agent = byAgentId.get(snapshot.agentId);
    if (!agent) {
      skipped.push({ agentId: snapshot.agentId, reason: 'not_in_team' });
      continue;
    }
    if (!agent.enabled) {
      skipped.push({ agentId: agent.id, reason: 'disabled' });
      continue;
    }
    if (snapshot.lastActivityAt == null) {
      skipped.push({ agentId: agent.id, reason: 'missing_activity', nudgeCount: snapshot.nudgeCount ?? 0 });
      continue;
    }
    const lastActivityMs = parseTime(snapshot.lastActivityAt);
    const staleMs = nowMs - lastActivityMs;
    if (staleMs < staleAfterMs) {
      skipped.push({ agentId: agent.id, reason: 'not_stale', staleMs, nudgeCount: snapshot.nudgeCount ?? 0 });
      continue;
    }
    if (nudgeBudgetUsed >= args.team.policies.maxNudgesPerRun) {
      const capped = { agentId: agent.id, reason: 'nudge_cap_reached' as const, staleMs, nudgeCount: snapshot.nudgeCount ?? 0 };
      skipped.push(capped);
      escalations.push(capped);
      continue;
    }
    nudges.push({
      agentId: agent.id,
      displayName: agent.displayName,
      role: agent.role,
      action: 'nudge',
      reason: 'stale',
      staleMinutes: Math.max(0, Math.round(staleMs / 60_000)),
      nudgeCount: snapshot.nudgeCount ?? 0,
      sessionId: agent.vkSessionId ?? null,
    });
    nudgeBudgetUsed += 1;
  }

  const toPreview = (entry: SkippedTeamNudge): TeamNudgePreviewAgent => {
    const agent = byAgentId.get(entry.agentId);
    const snapshot = bySnapshotId.get(entry.agentId);
    const action = entry.reason === 'nudge_cap_reached' ? 'escalate' : 'skip';
    return {
      agentId: entry.agentId,
      displayName: agent?.displayName ?? entry.agentId,
      role: agent?.role ?? 'unknown',
      action,
      reason: entry.reason,
      staleMinutes: typeof entry.staleMs === 'number' ? Math.max(0, Math.round(entry.staleMs / 60_000)) : null,
      nudgeCount: entry.nudgeCount ?? snapshot?.nudgeCount ?? 0,
      sessionId: agent?.vkSessionId ?? null,
    };
  };

  return {
    staleAfterMinutes,
    maxNudgesPerRun: args.team.policies.maxNudgesPerRun,
    nudges,
    skipped: skipped.map(toPreview),
    escalations: escalations.map(toPreview),
  };
}

function resolveStaleAfterMinutes(team: AgentTeam, override?: number | null): number {
  if (Number.isFinite(override) && Number(override) > 0) return Number(override);
  if (team.policies.nudgeAfterMs && team.policies.nudgeAfterMs > 0) return Math.max(1, Math.round(team.policies.nudgeAfterMs / 60_000));
  return 30;
}

function parseTime(value: number | string): number {
  const parsed = typeof value === 'number' ? value : new Date(value).getTime();
  if (!Number.isFinite(parsed)) throw new Error('Invalid preview time');
  return parsed;
}

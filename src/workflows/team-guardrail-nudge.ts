import type { WorkflowDefinition } from '@vibe-dashboard/workflow-core';
import type { QueueFollowUpResponse } from '../server/vk-client';
import { validateAgentTeam, type AgentTeam, type TeamAgent } from '../teams/agentTeams';

export interface TeamAgentActivitySnapshot {
  agentId: string;
  lastActivityAt: number | string | null;
  nudgeCount?: number;
  status?: string | null;
  blockedReason?: string | null;
}

export interface TeamGuardrailNudgeWorkflowInput {
  team: AgentTeam;
  agentActivity: TeamAgentActivitySnapshot[];
  workflowRunId?: string | null;
  taskPrompt?: string | null;
  staleAfterMinutes?: number;
  now?: number | string;
}

export interface QueuedTeamNudge {
  agentId: string;
  role: string;
  displayName: string;
  sessionId: string;
  workspaceId: string;
  queueItemId: string;
  queuedCount: number;
  staleMs: number;
  previousNudgeCount: number;
}

export interface SkippedTeamNudge {
  agentId: string;
  reason: 'not_stale' | 'missing_activity' | 'nudge_cap_reached' | 'disabled' | 'not_in_team';
  staleMs?: number;
  nudgeCount?: number;
}

export type TeamGuardrailNudgeWorkflowOutput =
  | {
      outcome: 'nudges_queued';
      teamId: string;
      workflowRunId: string | null;
      workspaceId: string;
      sessionId: string;
      queueItemId: string;
      nudges: QueuedTeamNudge[];
      skipped: SkippedTeamNudge[];
      escalations: SkippedTeamNudge[];
    }
  | {
      outcome: 'no_nudges_needed';
      teamId: string;
      workflowRunId: string | null;
      nudges: [];
      skipped: SkippedTeamNudge[];
      escalations: SkippedTeamNudge[];
    };

export interface TeamGuardrailVkClient {
  queueFollowUp: (sessionId: string, prompt: string, options?: { source?: 'system' | 'workflow' | 'agent' | 'from_user' }) => Promise<QueueFollowUpResponse>;
}

export function createTeamGuardrailNudgeWorkflow(options: { vkClient: TeamGuardrailVkClient }): WorkflowDefinition<TeamGuardrailNudgeWorkflowInput, TeamGuardrailNudgeWorkflowOutput> {
  return {
    id: 'team-guardrail-nudge',
    trigger: 'manual',
    run: async (ctx, input) => {
      validateGuardrailInput(input);
      const nowMs = parseTime(input.now ?? Date.now(), 'now');
      const staleAfterMs = resolveStaleAfterMs(input);
      const decisions = decideTeamNudges(input.team, input.agentActivity, { nowMs, staleAfterMs });
      validateNudgeTargets(decisions.toNudge);
      ctx.log('check_team_activity', `Checked ${input.agentActivity.length} agent activity records`, 'info', {
        teamId: input.team.id,
        workflowRunId: input.workflowRunId ?? null,
        staleAfterMs,
        nudgeCandidates: decisions.toNudge.length,
        skipped: decisions.skipped.length,
        escalations: decisions.escalations.length,
      });

      const nudges: QueuedTeamNudge[] = [];
      for (const target of decisions.toNudge) {
        const sessionId = target.agent.vkSessionId as string;
        const response = await options.vkClient.queueFollowUp(sessionId, formatNudgePrompt({
          team: input.team,
          agent: target.agent,
          activity: target.activity,
          staleMs: target.staleMs,
          taskPrompt: input.taskPrompt ?? null,
          workflowRunId: input.workflowRunId ?? null,
        }), { source: 'system' });
        const nudge: QueuedTeamNudge = {
          agentId: target.agent.id,
          role: target.agent.role,
          displayName: target.agent.displayName,
          sessionId,
          workspaceId: response.queued_item.workspace_id,
          queueItemId: response.queued_item.id,
          queuedCount: response.status.count,
          staleMs: target.staleMs,
          previousNudgeCount: target.activity.nudgeCount ?? 0,
        };
        nudges.push(nudge);
        ctx.log('queue_guardrail_nudge', `Queued guardrail nudge for ${target.agent.displayName}`, 'info', nudge);
      }

      for (const escalation of decisions.escalations) {
        ctx.log('guardrail_escalation', `Nudge cap reached for ${escalation.agentId}; escalate to orchestrator/human`, 'warn', escalation);
      }

      const primary = nudges[0];
      if (!primary) {
        return {
          outcome: 'no_nudges_needed',
          teamId: input.team.id,
          workflowRunId: input.workflowRunId ?? null,
          nudges: [],
          skipped: decisions.skipped,
          escalations: decisions.escalations,
        };
      }

      return {
        outcome: 'nudges_queued',
        teamId: input.team.id,
        workflowRunId: input.workflowRunId ?? null,
        workspaceId: primary.workspaceId,
        sessionId: primary.sessionId,
        queueItemId: primary.queueItemId,
        nudges,
        skipped: decisions.skipped,
        escalations: decisions.escalations,
      };
    },
  };
}

export function validateGuardrailInput(input: TeamGuardrailNudgeWorkflowInput): void {
  validateAgentTeam(input.team);
  if (!Array.isArray(input.agentActivity)) throw new Error('agentActivity is required');
}

interface NudgeCandidate {
  agent: TeamAgent;
  activity: TeamAgentActivitySnapshot;
  staleMs: number;
}

export function decideTeamNudges(inputTeam: AgentTeam, activity: TeamAgentActivitySnapshot[], options: { nowMs: number; staleAfterMs: number }): { toNudge: NudgeCandidate[]; skipped: SkippedTeamNudge[]; escalations: SkippedTeamNudge[] } {
  const byAgentId = new Map(inputTeam.agents.map((agent) => [agent.id, agent]));
  const toNudge: NudgeCandidate[] = [];
  const skipped: SkippedTeamNudge[] = [];
  const escalations: SkippedTeamNudge[] = [];
  const maxNudges = Math.max(0, inputTeam.policies.maxNudgesPerRun);

  for (const snapshot of activity) {
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
    const lastActivityMs = parseTime(snapshot.lastActivityAt, `lastActivityAt for ${agent.id}`);
    const staleMs = options.nowMs - lastActivityMs;
    if (staleMs < options.staleAfterMs) {
      skipped.push({ agentId: agent.id, reason: 'not_stale', staleMs, nudgeCount: snapshot.nudgeCount ?? 0 });
      continue;
    }
    if ((snapshot.nudgeCount ?? 0) >= maxNudges) {
      const capped = { agentId: agent.id, reason: 'nudge_cap_reached' as const, staleMs, nudgeCount: snapshot.nudgeCount ?? 0 };
      skipped.push(capped);
      escalations.push(capped);
      continue;
    }
    toNudge.push({ agent, activity: snapshot, staleMs });
  }

  return { toNudge, skipped, escalations };
}

export function validateNudgeTargets(targets: NudgeCandidate[]): void {
  for (const target of targets) {
    if (!target.agent.vkSessionId) {
      throw new Error(`Team agent ${target.agent.id} (${target.agent.displayName}) is missing vkSessionId`);
    }
  }
}

export function formatNudgePrompt(args: { team: AgentTeam; agent: TeamAgent; activity: TeamAgentActivitySnapshot; staleMs: number; taskPrompt: string | null; workflowRunId: string | null }): string {
  return [
    `Guardrail nudge for ${args.team.name}: ${args.agent.displayName} appears stale.`,
    '',
    `Stale for: ${Math.round(args.staleMs / 60_000)} minute(s)`,
    `Previous nudges for this run: ${args.activity.nudgeCount ?? 0}`,
    args.workflowRunId ? `Workflow run: ${args.workflowRunId}` : null,
    args.taskPrompt ? `Task: ${args.taskPrompt}` : null,
    '',
    'Please reply with current status, blockers, and the next concrete action. If blocked, say what help is needed.',
  ].filter((line): line is string => line !== null).join('\n');
}

function resolveStaleAfterMs(input: TeamGuardrailNudgeWorkflowInput): number {
  if (Number.isSafeInteger(input.staleAfterMinutes) && Number(input.staleAfterMinutes) > 0) {
    return Number(input.staleAfterMinutes) * 60_000;
  }
  if (input.team.policies.nudgeAfterMs && input.team.policies.nudgeAfterMs > 0) {
    return input.team.policies.nudgeAfterMs;
  }
  return 30 * 60_000;
}

function parseTime(value: number | string, label: string): number {
  const parsed = typeof value === 'number' ? value : new Date(value).getTime();
  if (!Number.isFinite(parsed)) throw new Error(`Invalid ${label}`);
  return parsed;
}

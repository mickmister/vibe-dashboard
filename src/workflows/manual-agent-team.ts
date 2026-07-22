import type { WorkflowDefinition } from '@vibe-dashboard/workflow-core';
import type { QueueFollowUpResponse } from '../server/vk-client';
import {
  validateAgentTeam,
  type AgentTeam,
  type TeamAgent,
} from '../teams/agentTeams';

export interface ManualAgentTeamWorkflowInput {
  team: AgentTeam;
  taskPrompt: string;
  context?: string | null;
  targetAgentIds?: string[];
}

export interface QueuedTeamAgentPrompt {
  agentId: string;
  role: string;
  displayName: string;
  sessionId: string;
  workspaceId: string;
  queueItemId: string;
  queuedCount: number;
}

export type ManualAgentTeamWorkflowOutput =
  | {
      outcome: 'team_prompts_queued';
      teamId: string;
      teamName: string;
      orchestratorAgentId: string;
      workspaceId: string;
      sessionId: string;
      queueItemId: string;
      queuedAgents: QueuedTeamAgentPrompt[];
    };

export interface ManualAgentTeamVkClient {
  queueFollowUp: (sessionId: string, prompt: string) => Promise<QueueFollowUpResponse>;
}

export interface CreateManualAgentTeamWorkflowOptions {
  vkClient: ManualAgentTeamVkClient;
}

export function createManualAgentTeamWorkflow(
  options: CreateManualAgentTeamWorkflowOptions,
): WorkflowDefinition<ManualAgentTeamWorkflowInput, ManualAgentTeamWorkflowOutput> {
  return {
    id: 'manual-agent-team-runner',
    trigger: 'manual',
    run: async (ctx, input) => {
      validateManualTeamInput(input);
      const targetAgents = selectTargetAgents(input.team, input.targetAgentIds);
      ctx.log('validate_team', `Validated team ${input.team.name}`, 'info', {
        teamId: input.team.id,
        agentCount: input.team.agents.length,
        targetAgentCount: targetAgents.length,
      });

      const queuedAgents: QueuedTeamAgentPrompt[] = [];
      for (const agent of targetAgents) {
        if (!agent.vkSessionId) {
          throw new Error(`Team agent ${agent.id} (${agent.displayName}) is missing vkSessionId`);
        }
        const prompt = formatTeamAgentPrompt({
          team: input.team,
          agent,
          taskPrompt: input.taskPrompt,
          context: input.context ?? null,
        });
        const queueResponse = await options.vkClient.queueFollowUp(agent.vkSessionId, prompt);
        const queued: QueuedTeamAgentPrompt = {
          agentId: agent.id,
          role: agent.role,
          displayName: agent.displayName,
          sessionId: agent.vkSessionId,
          workspaceId: queueResponse.queued_item.workspace_id,
          queueItemId: queueResponse.queued_item.id,
          queuedCount: queueResponse.status.count,
        };
        queuedAgents.push(queued);
        ctx.log('queue_agent_prompt', `Queued prompt for ${agent.displayName}`, 'info', queued);
      }

      const primary = queuedAgents[0];
      if (!primary) {
        throw new Error('No team agents were eligible for queueing');
      }

      return {
        outcome: 'team_prompts_queued',
        teamId: input.team.id,
        teamName: input.team.name,
        orchestratorAgentId: input.team.orchestratorAgentId,
        workspaceId: primary.workspaceId,
        sessionId: primary.sessionId,
        queueItemId: primary.queueItemId,
        queuedAgents,
      };
    },
  };
}

export function validateManualTeamInput(input: ManualAgentTeamWorkflowInput): void {
  validateAgentTeam(input.team);
  if (!input.taskPrompt.trim()) {
    throw new Error('Manual team workflow taskPrompt is required');
  }
  const orchestrator = input.team.agents.find((agent) => agent.id === input.team.orchestratorAgentId);
  if (!orchestrator) {
    throw new Error(`Orchestrator agent not found: ${input.team.orchestratorAgentId}`);
  }
  if (input.team.policies.requireOrchestrator && !orchestrator.enabled) {
    throw new Error(`Orchestrator agent is disabled: ${orchestrator.id}`);
  }
  if (input.team.policies.requireOrchestrator && !orchestrator.vkSessionId) {
    throw new Error(`Orchestrator agent ${orchestrator.id} is missing vkSessionId`);
  }
}

export function selectTargetAgents(team: AgentTeam, targetAgentIds?: string[]): TeamAgent[] {
  const targetSet = targetAgentIds && targetAgentIds.length > 0 ? new Set(targetAgentIds) : null;
  const orchestrator = team.agents.find((agent) => agent.id === team.orchestratorAgentId);
  const ordered = [
    ...(orchestrator ? [orchestrator] : []),
    ...team.agents.filter((agent) => agent.id !== team.orchestratorAgentId),
  ];
  const selected = ordered.filter((agent) => agent.enabled && (!targetSet || targetSet.has(agent.id)));
  const maxAgents = Math.max(1, team.policies.maxConcurrentAgents);
  return selected.slice(0, maxAgents);
}

export function formatTeamAgentPrompt(args: {
  team: AgentTeam;
  agent: TeamAgent;
  taskPrompt: string;
  context: string | null;
}): string {
  const roster = args.team.agents
    .filter((agent) => agent.enabled)
    .map((agent) => `- ${agent.displayName} (${agent.role})${agent.id === args.team.orchestratorAgentId ? ' [orchestrator]' : ''}`)
    .join('\n');
  const parts = [
    `You are ${args.agent.displayName}, the ${args.agent.role} agent on team ${args.team.name}.`,
    '',
    'Team roster:',
    roster || '- No other enabled agents',
    '',
    'Task:',
    args.taskPrompt.trim(),
  ];
  if (args.context?.trim()) {
    parts.push('', 'Context:', args.context.trim());
  }
  if (args.agent.instructions?.trim()) {
    parts.push('', 'Your agent-specific instructions:', args.agent.instructions.trim());
  }
  if (args.agent.id === args.team.orchestratorAgentId) {
    parts.push('', 'As orchestrator, coordinate the team, assign tactical next steps, and keep the work from being dropped.');
  } else {
    parts.push('', 'Coordinate through the orchestrator and focus on your assigned role.');
  }
  return parts.join('\n');
}

import { createWorkflowRegistry } from '@vibe-dashboard/workflow-core';
import { VibeKanbanServerClient } from '../server/vk-client';
import { createGitHubCiFailureWorkflow } from './github-ci';
import { createManualAgentTeamWorkflow } from './manual-agent-team';
import { createTeamGuardrailNudgeWorkflow } from './team-guardrail-nudge';

export const workflowRegistry = createWorkflowRegistry();

workflowRegistry.register(
  createGitHubCiFailureWorkflow({
    vkClient: new VibeKanbanServerClient(),
  }),
);

workflowRegistry.register(
  createManualAgentTeamWorkflow({
    vkClient: new VibeKanbanServerClient(),
  }),
);

workflowRegistry.register(
  createTeamGuardrailNudgeWorkflow({
    vkClient: new VibeKanbanServerClient(),
  }),
);

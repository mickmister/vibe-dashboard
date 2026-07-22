import { createWorkflowRegistry } from '@vibe-dashboard/workflow-core';
import { VibeKanbanServerClient } from '../server/vk-client';
import { createGitHubCiFailureWorkflow } from './github-ci';
import { createManualAgentTeamWorkflow } from './manual-agent-team';

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

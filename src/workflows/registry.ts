import { createWorkflowRegistry } from '@vibe-kanban/workflow-core';
import { VibeKanbanServerClient } from '../server/vk-client';
import { createGitHubCiFailureWorkflow } from './github-ci';

export const workflowRegistry = createWorkflowRegistry();

workflowRegistry.register(
  createGitHubCiFailureWorkflow({
    vkClient: new VibeKanbanServerClient(),
  }),
);

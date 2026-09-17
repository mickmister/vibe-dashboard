import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { WorkflowCreationWizardView } from '../components/WorkflowCreationWizardPage';
import { workflowsHomeFixture } from '../fixtures/workflowStoryFixtures';
import { WorkflowStoryFrame } from './WorkflowStoryFrame';

const home = workflowsHomeFixture();

const meta: Meta<typeof WorkflowCreationWizardView> = {
  title: 'Workflows/Creation Wizard',
  component: WorkflowCreationWizardView,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <WorkflowStoryFrame
        title="Workflow creation wizard"
        description="Storybook-only fixtures for wizard-first creation, starter duplication, true blank draft creation, and product error states."
      >
        <Story />
      </WorkflowStoryFrame>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const TrueBlankWorkflowDraft: Story = {
  args: {
    workspaceId: home.workspaceId ?? 'workspace-storybook',
    userWorkflows: home.userWorkflows,
    starterTemplates: home.starterTemplates,
    initialDraft: {
      sourceMode: 'blank',
      sourceId: null,
      name: 'Storybook blank workflow',
      purpose: 'Start with an empty draft and add roles, states, and actions in the editor.',
      publish: true,
    },
  },
};

export const StarterTemplateCopy: Story = {
  args: {
    workspaceId: home.workspaceId ?? 'workspace-storybook',
    userWorkflows: home.userWorkflows,
    starterTemplates: home.starterTemplates,
    initialDraft: {
      sourceMode: 'starter',
      sourceId: 'built-in/dev-review-tester',
      name: 'Dev / Review / Tester copy',
      purpose: 'Customize the three-role starter after creating the copy.',
      publish: false,
    },
  },
};

export const DuplicateExistingWorkflow: Story = {
  args: {
    workspaceId: home.workspaceId ?? 'workspace-storybook',
    userWorkflows: home.userWorkflows,
    starterTemplates: home.starterTemplates,
    initialDraft: {
      sourceMode: 'duplicate',
      sourceId: 'design-ci-wait',
      name: 'CI wait workflow copy',
      purpose: 'Duplicate a published design without copying sessions or runs.',
      publish: false,
    },
  },
};

export const LoadErrorState: Story = {
  args: {
    workspaceId: 'workspace-storybook',
    userWorkflows: [],
    starterTemplates: [],
    loadError: 'Workflow templates are temporarily unavailable.',
  },
};

import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { WorkspaceWorkflowsHomeView } from '../components/WorkspaceWorkflowsPage';
import { workflowsHomeFixture } from '../fixtures/workflowStoryFixtures';
import { WorkflowStoryFrame } from './WorkflowStoryFrame';

const meta: Meta<typeof WorkspaceWorkflowsHomeView> = {
  title: 'Workflows/Home',
  component: WorkspaceWorkflowsHomeView,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <WorkflowStoryFrame title="Workspace Workflows home" description="Pure home read-model fixture with starter templates, user workflows, attention, batches, and runs.">
        <Story />
      </WorkflowStoryFrame>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const WorkspaceOverview: Story = {
  args: {
    home: workflowsHomeFixture(),
    loading: false,
    error: null,
    onRefresh: () => undefined,
    onHomeUpdated: () => undefined,
    embedded: true,
  },
};

export const EmptyWorkspace: Story = {
  args: {
    home: { workspaceId: 'workspace-empty', userWorkflows: [], starterTemplates: [], needsInput: [], recentRuns: [], recentBatches: [] },
    loading: false,
    error: null,
    onRefresh: () => undefined,
    onHomeUpdated: () => undefined,
    embedded: true,
  },
};

export const ProductError: Story = {
  args: {
    home: null,
    loading: false,
    error: 'Workspace is required.',
    onRefresh: () => undefined,
    embedded: true,
  },
};

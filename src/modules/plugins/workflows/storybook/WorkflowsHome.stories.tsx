import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { WorkspaceWorkflowsHomeView } from '../components/WorkspaceWorkflowsPage';
import type { WorkspaceWorkflowSummary } from '../client/workflowsHomeApi';
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

export const DenseWorkspaceDashboard: Story = {
  args: {
    home: denseWorkflowsHomeFixture(),
    loading: false,
    error: null,
    onRefresh: () => undefined,
    onHomeUpdated: () => undefined,
    embedded: true,
  },
};

export const EmptyWorkspace: Story = {
  args: {
    home: { workspaceId: 'workspace-empty', lanes: null, userWorkflows: [], starterTemplates: [], needsInput: [], recentRuns: [], recentBatches: [] },
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

function denseWorkflowsHomeFixture() {
  const home = JSON.parse(JSON.stringify(workflowsHomeFixture())) as ReturnType<typeof workflowsHomeFixture>;
  const firstWorkflow = home.userWorkflows[0] as WorkspaceWorkflowSummary;
  const secondWorkflow = home.userWorkflows[1] as WorkspaceWorkflowSummary;
  const firstTemplate = home.starterTemplates[0] as WorkspaceWorkflowSummary;
  home.userWorkflows = [
    ...home.userWorkflows,
    { ...firstWorkflow, id: 'design-drt-copy', title: 'Dev / Review / Tester copy', version: 4 },
    { ...secondWorkflow, id: 'design-ci-copy', title: 'CI wait release workflow', version: 2 },
  ];
  home.starterTemplates = [
    ...home.starterTemplates,
    { ...firstTemplate, id: 'built-in/dense-review-loop', title: 'Review loop starter' },
  ];
  home.needsInput = [
    ...home.needsInput,
    { attentionItemId: 'attention-test', title: 'Confirm tester scope', description: 'Tester needs your acceptance criteria before continuing.', workflowName: 'Dev / Review / Tester copy', createdAt: 1_700, detailUrl: '/dashboard/workflows/run-test' },
  ];
  home.recentRuns = [
    ...home.recentRuns,
    { runId: 'run-blocked', workflowName: 'CI wait release workflow', status: 'blocked', startedAt: 1_100, updatedAt: 1_800, detailUrl: '/dashboard/workflows/run-blocked' },
    { runId: 'run-waiting', workflowName: 'Dev / Review / Tester copy', status: 'waiting', startedAt: 1_200, updatedAt: 1_900, detailUrl: '/dashboard/workflows/run-waiting' },
  ];
  return home;
}

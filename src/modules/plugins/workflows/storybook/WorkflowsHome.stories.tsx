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

export const GasCityBackedOrchestrationReady: Story = {
  args: {
    home: workflowsHomeFixture(),
    loading: false,
    error: null,
    onRefresh: () => undefined,
    onHomeUpdated: () => undefined,
    embedded: true,
    gasCityEngine: {
      health: {
        status: 'healthy',
        summary: 'Workflow orchestration is connected and ready for task-backed workflow recipes.',
        version: '1.4.1',
        warnings: [],
      },
      recipes: [
        { id: 'recipe-dev-review-tester', name: 'Dev / Review / Tester recipe', summary: 'Generated from the published Dev / Review / Tester workflow.', sourceWorkflow: 'Dev / Review / Tester', status: 'ready' },
        { id: 'recipe-create-form', name: 'Create form from agent recipe', summary: 'Preview recipe for creating a human input form from an agent decision.', sourceWorkflow: 'Create form from agent', status: 'preview' },
      ],
      launch: { enabled: false, summary: 'Start from task is shown here as a safe preview until launch routes are connected.' },
      diagnosticsRef: 'gas-city-launch:storybook',
    },
  },
};

export const GasCityBackedOrchestrationUnavailable: Story = {
  args: {
    home: workflowsHomeFixture(),
    loading: false,
    error: null,
    onRefresh: () => undefined,
    onHomeUpdated: () => undefined,
    embedded: true,
    gasCityEngine: {
      health: {
        status: 'unavailable',
        summary: 'Workflow orchestration is unavailable. Check setup and retry from this workspace.',
        version: null,
        warnings: ['Workflow engine version could not be verified.'],
      },
      recipes: [],
      launch: { enabled: false, summary: 'Connect the workflow engine before starting task-backed workflow work.' },
      diagnosticsRef: null,
    },
  },
};


export const GlobalAllWorkspacesOverview: Story = {
  args: {
    home: globalWorkflowsHomeFixture(),
    loading: false,
    error: null,
    onRefresh: () => undefined,
    onHomeUpdated: () => undefined,
    embedded: true,
  },
};

export const LaneCapacityBlocked: Story = {
  args: {
    home: laneCapacityBlockedFixture(),
    loading: false,
    error: null,
    onRefresh: () => undefined,
    onHomeUpdated: () => undefined,
    embedded: true,
  },
};

export const LoadingDashboard: Story = {
  args: {
    home: null,
    loading: true,
    error: null,
    onRefresh: () => undefined,
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
    { runId: 'run-blocked', workflowName: 'CI wait release workflow', workspaceId: 'workspace-a', status: 'blocked', startedAt: 1_100, updatedAt: 1_800, detailUrl: '/dashboard/workflows/run-blocked' },
    { runId: 'run-waiting', workflowName: 'Dev / Review / Tester copy', workspaceId: 'workspace-a', status: 'waiting', startedAt: 1_200, updatedAt: 1_900, detailUrl: '/dashboard/workflows/run-waiting' },
  ];
  return home;
}


function globalWorkflowsHomeFixture() {
  const home = JSON.parse(JSON.stringify(workflowsHomeFixture())) as ReturnType<typeof workflowsHomeFixture>;
  home.workspaceId = null;
  home.lanes = null;
  home.recentRuns = [
    { runId: 'run-workspace-a', workflowName: 'Dev / Review / Tester', workspaceId: 'workspace-a', status: 'running', startedAt: 1_000, updatedAt: 1_500, detailUrl: '/dashboard/workflows/run-workspace-a' },
    { runId: 'run-workspace-b', workflowName: 'Create form from agent', workspaceId: 'workspace-b', status: 'waiting', startedAt: 1_100, updatedAt: 1_600, detailUrl: '/dashboard/workflows/run-workspace-b' },
    { runId: 'run-workspace-c', workflowName: 'Wait for GitHub CI', workspaceId: 'workspace-c', status: 'completed', startedAt: 900, updatedAt: 1_300, detailUrl: '/dashboard/workflows/run-workspace-c' },
  ];
  home.needsInput = [];
  return home;
}

function laneCapacityBlockedFixture() {
  const home = JSON.parse(JSON.stringify(workflowsHomeFixture())) as ReturnType<typeof workflowsHomeFixture>;
  home.lanes = {
    parentWorkspaceId: home.workspaceId ?? 'workspace-storybook',
    lanes: [
      {
        laneId: 'lane-active-write',
        parentWorkspaceId: home.workspaceId ?? 'workspace-storybook',
        name: 'Active implementation lane',
        purpose: 'One workflow run is currently mutating this lane.',
        label: 'Active implementation lane',
        breadcrumb: 'workspace-storybook / Active implementation lane',
        status: 'ready',
        sourceBranch: 'main',
        workingBranch: 'workflow/active-implementation',
        worktree: { status: 'dirty', display: 'Dirty worktree', summary: { message: 'Uncommitted changes are attributed to the active workflow run.' } },
        capacity: { write: { status: 'held', activeLeaseId: 'lease-story', ownerId: 'run-drt', reason: 'Write token held by Dev / Review / Tester run.' } },
        boundRunIds: ['run-drt'],
        boundBeadIds: ['vibe-kanban-vscode-web-story'],
        nextAction: 'Wait for the active write turn to finish before starting another mutating step.',
        createdAt: 1_000,
        updatedAt: 2_000,
        archivedAt: null,
      },
      {
        laneId: 'lane-archived',
        parentWorkspaceId: home.workspaceId ?? 'workspace-storybook',
        name: 'Archived review lane',
        purpose: 'Completed spike follow-up.',
        label: 'Archived review lane',
        breadcrumb: 'workspace-storybook / Archived review lane',
        status: 'archived',
        sourceBranch: 'main',
        workingBranch: 'workflow/archived-review',
        worktree: { status: 'unknown', display: 'Worktree status unknown', summary: { message: 'Refresh lane status before reusing this lane.' } },
        capacity: { write: { status: 'blocked', activeLeaseId: null, ownerId: null, reason: 'Archived lanes cannot accept new write work.' } },
        boundRunIds: [],
        boundBeadIds: [],
        nextAction: 'Create or select a ready lane for new workflow work.',
        createdAt: 500,
        updatedAt: 1_700,
        archivedAt: 1_700,
      },
    ],
    counts: { ready: 1, archived: 1 },
    activeWriteLanes: 1,
    nextAction: 'One lane has an active write token; new mutating work should choose another ready lane.',
  };
  return home;
}

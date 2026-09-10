import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { WorkflowBatchDetailView } from '../components/WorkflowBatchDetailPage';
import type { WorkflowBatchDetailModel } from '../client/workflowsHomeApi';
import { WorkflowStoryFrame } from './WorkflowStoryFrame';

const meta: Meta<typeof WorkflowBatchDetailView> = {
  title: 'Workflows/Batch Detail',
  component: WorkflowBatchDetailView,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <WorkflowStoryFrame
        title="Workflow batch detail"
        description="Batch item status, per-item errors, and capacity/backpressure explanations."
      >
        <Story />
      </WorkflowStoryFrame>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const MixedItemsWithCapacityPressure: Story = {
  args: {
    batch: batchFixture(),
    loading: false,
    error: null,
    onRefresh: () => undefined,
  },
};

export const EmptyBatch: Story = {
  args: {
    batch: { ...batchFixture(), counts: { total: 0, pending: 0, running: 0, completed: 0, blocked: 0, failed: 0, cancelled: 0 }, items: [] },
    loading: false,
    error: null,
    onRefresh: () => undefined,
  },
};

export const ProductError: Story = {
  args: {
    batch: null,
    loading: false,
    error: 'Batch details are temporarily unavailable.',
    onRefresh: () => undefined,
  },
};

function batchFixture(): WorkflowBatchDetailModel {
  return {
    batchId: 'batch-storybook',
    workflowName: 'Dev / Review / Tester batch',
    status: 'running',
    counts: { total: 5, pending: 2, running: 1, completed: 1, blocked: 1, failed: 0, cancelled: 0 },
    capacity: {
      globalActiveRunLimit: 2,
      workspaceActiveRunLimit: 1,
      globalActiveRuns: 2,
      workspaceActiveRuns: 1,
      explanation: 'Pending items wait because this workspace already has one active write workflow run.',
    },
    items: [
      { batchItemId: 'item-1', lineNumber: 1, itemIndex: 0, inputSummary: 'Feature: add workflow wizard', status: 'completed', runId: 'run-1', runUrl: '/dashboard/workflows/run-1', error: null, startedAt: 1_000, completedAt: 1_500, updatedAt: 1_500, pendingReason: null },
      { batchItemId: 'item-2', lineNumber: 2, itemIndex: 1, inputSummary: 'Feature: polish role templates', status: 'running', runId: 'run-2', runUrl: '/dashboard/workflows/run-2', error: null, startedAt: 1_600, completedAt: null, updatedAt: 1_800, pendingReason: null },
      { batchItemId: 'item-3', lineNumber: 3, itemIndex: 2, inputSummary: 'Feature: add command step', status: 'pending', runId: null, runUrl: null, error: null, startedAt: null, completedAt: null, updatedAt: 1_900, pendingReason: 'Workspace active run limit reached.' },
      { batchItemId: 'item-4', lineNumber: 4, itemIndex: 3, inputSummary: 'Feature: missing required input', status: 'blocked', runId: null, runUrl: null, error: { code: 'missing_input', message: 'Line 4 is missing featureRequest.', fieldErrors: { featureRequest: 'This field is required.' } }, startedAt: null, completedAt: null, updatedAt: 2_000, pendingReason: null },
      { batchItemId: 'item-5', lineNumber: 5, itemIndex: 4, inputSummary: 'Feature: queue next workflow', status: 'pending', runId: null, runUrl: null, error: null, startedAt: null, completedAt: null, updatedAt: 2_100, pendingReason: 'Global active run limit reached.' },
    ],
    createdAt: 900,
    updatedAt: 2_100,
  };
}

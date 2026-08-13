import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { WorkflowPresentationView } from '../../../../components/WorkflowPresentationPage';
import { completedWorkflowPresentationFixture, runningCiPresentationFixture } from '../fixtures/workflowStoryFixtures';
import { WorkflowStoryFrame } from './WorkflowStoryFrame';

const meta: Meta<typeof WorkflowPresentationView> = {
  title: 'Workflows/Run Presentation',
  component: WorkflowPresentationView,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <WorkflowStoryFrame title="Run presentation story" description="Pure prop-based run presentation fixtures; no route/API/MSW dependency.">
        <Story />
      </WorkflowStoryFrame>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const WaitingOnGitHubCi: Story = {
  args: {
    presentation: runningCiPresentationFixture(),
    loading: false,
    error: null,
    onRefresh: () => undefined,
  },
};

export const CompletedWithCiResult: Story = {
  args: {
    presentation: completedWorkflowPresentationFixture(),
    loading: false,
    error: null,
    onRefresh: () => undefined,
  },
};

export const ProductErrorState: Story = {
  args: {
    presentation: null,
    loading: false,
    error: 'Workflow run could not be loaded.',
    onRefresh: () => undefined,
  },
};

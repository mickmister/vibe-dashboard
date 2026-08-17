import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { WorkflowPresentationView } from '../../../../components/WorkflowPresentationPage';
import type { WorkflowPresentationModel } from '../../../../lib/workflowPresentationApi';
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


export const WaitingOnHumanForm: Story = {
  args: {
    presentation: waitingHumanFormPresentationFixture(),
    loading: false,
    error: null,
    onRefresh: () => undefined,
  },
};

export const BlockingWorkflowCallTree: Story = {
  args: {
    presentation: workflowCallPresentationFixture(),
    loading: false,
    error: null,
    onRefresh: () => undefined,
  },
};

export const BlockedInvalidXmlRetry: Story = {
  args: {
    presentation: blockedInvalidXmlPresentationFixture(),
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


function waitingHumanFormPresentationFixture(): WorkflowPresentationModel {
  const model = completedWorkflowPresentationFixture();
  return {
    ...model,
    instanceId: 'run-human-form',
    workflowName: 'Human approval workflow',
    status: 'waiting',
    humanStatus: 'waiting_for_user',
    completedAt: null,
    summary: { statusLabel: 'Needs input', currentOwner: 'Dev', currentState: 'Approval', currentStep: 'Approve implementation plan', waitingReason: 'Waiting for you to submit the approval form.', nextAction: 'Review the form fields and submit your response.' },
    attention: { title: 'Approve implementation plan', description: 'Review the plan before the agent continues.', formRef: 'form.storybook-human-form', status: 'active' },
    outputs: [{ id: 'form-schema', label: 'Form artifact', value: 'Approval form with required Approved? field.', kind: 'form_artifact' }],
    timeline: [
      { id: 'human-form', role: 'You', title: 'Approve implementation plan', kind: 'human_form', state: 'Approval', step: 'Approval form', status: 'Waiting', session: null, initialMessage: { text: 'Approve implementation plan form is ready.', truncated: false, maxChars: null }, finalResponse: null, responseUnavailable: 'Waiting for form submission.', commits: [] },
    ],
  };
}

function workflowCallPresentationFixture(): WorkflowPresentationModel {
  const model = completedWorkflowPresentationFixture();
  return {
    ...model,
    instanceId: 'run-parent-call',
    workflowName: 'Parent workflow call',
    status: 'running',
    completedAt: null,
    summary: { statusLabel: 'In progress', currentOwner: 'Dev', currentState: 'Parent', currentStep: 'Call child', waitingReason: 'Waiting for child workflow to complete.', nextAction: 'The parent resumes after the child workflow returns output refs.' },
    callTree: [{ turnId: 'call_child', label: 'Child review workflow', status: 'running', childRunId: 'run-child-review', childUrl: '/dashboard/workflows/run-child-review', waitingReason: 'Child review is running.', outputRef: null }],
    outputs: [{ id: 'child-output', label: 'Child output refs', value: 'Child workflow output will appear here after completion.', kind: 'workflow_call_output' }],
    timeline: [
      { id: 'call-child', role: 'Workflow call', title: 'Child review workflow', kind: 'workflow_call', state: 'Parent', step: 'Call child', status: 'Waiting', session: null, initialMessage: { text: 'Started child review workflow.', truncated: false, maxChars: null }, finalResponse: null, responseUnavailable: 'Waiting for child workflow to finish.', commits: [] },
    ],
  };
}

function blockedInvalidXmlPresentationFixture(): WorkflowPresentationModel {
  const model = completedWorkflowPresentationFixture();
  return {
    ...model,
    instanceId: 'run-invalid-xml',
    workflowName: 'Simple Agent Decision',
    status: 'failed',
    completedAt: null,
    summary: { statusLabel: 'Needs attention', currentOwner: 'Agent', currentState: 'Work', currentStep: 'Decide', waitingReason: 'The agent response did not match the expected workflow decision contract after retries.', nextAction: 'Review the validation reason and decide how to continue.' },
    outputs: [],
    timeline: [
      { id: 'turn-invalid', role: 'Agent', title: 'Decision turn', kind: 'agent_turn', state: 'Work', step: 'Decide', status: 'Blocked', session: { label: 'Agent session', workspaceId: 'workspace-storybook', sessionId: 'session-agent' }, initialMessage: { text: 'Complete the work and return a valid workflow decision.', truncated: false, maxChars: null }, finalResponse: { text: 'Validation failed: expected one of the allowed actions.', truncated: false, maxChars: null }, responseUnavailable: null, commits: [] },
    ],
  };
}

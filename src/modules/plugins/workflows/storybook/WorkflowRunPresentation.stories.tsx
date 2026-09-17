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


export const DevReviewTesterLoopWithBeadContext: Story = {
  args: {
    presentation: drtLoopWithBeadContextFixture(),
    loading: false,
    error: null,
    onRefresh: () => undefined,
  },
};

export const CompletedWithoutBeadContext: Story = {
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



function drtLoopWithBeadContextFixture(): WorkflowPresentationModel {
  const model = completedWorkflowPresentationFixture();
  return {
    ...model,
    instanceId: 'run-drt-loop-beads',
    workflowName: 'Dev / Review / Tester',
    originalTask: 'Ship the workflow run page story.',
    beadContext: [
      { beadId: 'vibe-kanban-vscode-web-erf2', title: 'Clean trusted workflow run story page', status: 'in progress' },
      { beadId: 'vibe-kanban-vscode-web-npv', title: 'Overall Workflows IA recommendation', status: 'closed' },
    ],
    timeline: [
      { id: 'dev-implement-1', role: 'Dev', title: 'Dev implemented', kind: 'agent_turn', state: 'Dev', step: 'Implement', status: 'Complete', session: { label: 'Dev session', workspaceId: 'workspace-storybook', sessionId: 'session-dev' }, initialMessage: { text: 'Implement the run story page.', truncated: false, maxChars: null }, finalResponse: { text: 'Implemented the first version.', truncated: false, maxChars: null }, responseUnavailable: null, commits: [] },
      { id: 'dev-self-review-1', role: 'Dev', title: 'Dev self-reviewed', kind: 'decision', state: 'Dev → Review', step: 'Self review', action: 'Ready for review', status: 'Complete', session: null, initialMessage: null, finalResponse: { text: 'Action: Ready for review\nSummary: Ready for reviewer.', truncated: false, maxChars: null }, responseUnavailable: null, commits: [] },
      { id: 'review-changes', role: 'Review', title: 'Review requested changes', kind: 'decision', state: 'Review → Dev', step: 'Review', action: 'Request changes', status: 'Complete', isLoop: true, session: null, initialMessage: null, finalResponse: { text: 'Requested changes: clarify waiting state.', truncated: false, maxChars: null }, responseUnavailable: null, commits: [] },
      { id: 'dev-implement-2', role: 'Dev', title: 'Dev revised', kind: 'agent_turn', state: 'Dev', step: 'Implement', status: 'Complete', session: { label: 'Dev session', workspaceId: 'workspace-storybook', sessionId: 'session-dev' }, initialMessage: { text: 'Revise based on review requested changes.', truncated: false, maxChars: null }, finalResponse: { text: 'Revised the waiting state copy.', truncated: false, maxChars: null }, responseUnavailable: null, commits: [] },
      { id: 'review-approved', role: 'Review', title: 'Review approved', kind: 'decision', state: 'Review → Tester', step: 'Review', action: 'Approved', status: 'Complete', session: null, initialMessage: null, finalResponse: { text: 'Remarks: approved.', truncated: false, maxChars: null }, responseUnavailable: null, commits: [] },
      { id: 'tester-approved', role: 'Tester', title: 'Tester approved', kind: 'decision', state: 'Tester → Done', step: 'Test', action: 'Approved', status: 'Complete', session: null, initialMessage: null, finalResponse: { text: 'Test summary: all checks passed.', truncated: false, maxChars: null }, responseUnavailable: null, commits: [] },
    ],
  };
}

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

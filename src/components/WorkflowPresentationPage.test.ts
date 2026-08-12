import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WorkflowPresentationView } from './WorkflowPresentationPage';
import type { WorkflowPresentationModel } from '../lib/workflowPresentationApi';

const forbiddenDebugTerms = [
  'webhook',
  'HMAC',
  'delivery id',
  'trigger id',
  'queue item id',
  'execution process id',
  'WorkflowStepState',
  'runReady',
  'raw JSON',
  '<decision',
  'rawXml',
  'responseRef',
  'response-dev',
];

describe('WorkflowPresentationView', () => {
  it('renders the clean story timeline without debug vocabulary', () => {
    const html = renderToStaticMarkup(React.createElement(WorkflowPresentationView, {
      presentation: presentationFixture(),
      error: null,
      loading: false,
      onRefresh: () => {},
    }));

    expect(html).toContain('data-testid="standalone-dashboard-page"');
    expect(html).toContain('h-screen');
    expect(html).toContain('overflow-y-auto');
    expect(html).toContain('Two agent review round');
    expect(html).toContain('Run summary');
    expect(html).toContain('Who has the ball');
    expect(html).toContain('Reviewer');
    expect(html).toContain('Waiting for reviewer response.');
    expect(html).toContain('Next: The workflow resumes when the agent turn completes.');
    expect(html).toContain('Child workflows');
    expect(html).toContain('Open child run');
    expect(html).toContain('Outputs and artifacts');
    expect(html).toContain('Final summary');
    expect(html).toContain('Original task');
    expect(html).toContain('Build the clean workflow page');
    expect(html).toContain('Timeline');
    expect(html).toContain('Implementer');
    expect(html).toContain('Reviewer');
    expect(html).toContain('Initial message');
    expect(html).toContain('Final response');
    expect(html).toContain('Implemented the UI.');
    expect(html).toContain('Reviewed and approved.');
    expect(html).toContain('agent turn');
    expect(html).toContain('Open Implementer session');
    expect(html).toContain('Open Reviewer session');
    for (const term of forbiddenDebugTerms) {
      expect(html).not.toContain(term);
    }
  });

  it('renders product-level error and attention states', () => {
    const errorHtml = renderToStaticMarkup(React.createElement(WorkflowPresentationView, {
      presentation: null,
      error: 'Workflow not found',
      loading: false,
      onRefresh: () => {},
    }));
    expect(errorHtml).toContain('Workflow not found');

    const attentionHtml = renderToStaticMarkup(React.createElement(WorkflowPresentationView, {
      presentation: { ...presentationFixture(), humanStatus: 'waiting_for_user', attention: { title: 'Answer planning questions', description: 'Please fill out the form.', formRef: 'beads-form://attention', status: 'active' } },
      error: null,
      loading: false,
      onRefresh: () => {},
    }));
    expect(attentionHtml).toContain('Needs your input');
    expect(attentionHtml).toContain('Answer planning questions');
    for (const term of forbiddenDebugTerms) {
      expect(attentionHtml).not.toContain(term);
    }

    const answeredHtml = renderToStaticMarkup(React.createElement(WorkflowPresentationView, {
      presentation: {
        ...presentationFixture(),
        humanStatus: 'resolved',
        attention: { title: 'Answer planning questions', description: null, formRef: 'beads-form://attention', status: 'resolved' },
        timeline: [
          ...presentationFixture().timeline,
          {
            id: 'human-attention',
            role: 'User',
            title: 'Answer planning questions',
            status: 'Answered',
            session: null,
            initialMessage: null,
            finalResponse: { text: 'approved: true', truncated: false, maxChars: null },
            responseUnavailable: null,
            commits: [],
          },
        ],
      },
      error: null,
      loading: false,
      onRefresh: () => {},
    }));
    expect(answeredHtml).toContain('Answered');
    expect(answeredHtml).toContain('approved: true');
  });
});

function presentationFixture(): WorkflowPresentationModel {
  return {
    instanceId: 'instance_clean',
    workflowId: 'two-agent-review-round',
    workflowName: 'Two agent review round',
    status: 'completed',
    humanStatus: 'not_needed',
    originalTask: 'Build the clean workflow page',
    startedAt: 1,
    updatedAt: 2,
    completedAt: 2,
    summary: { statusLabel: 'In progress', currentOwner: 'Reviewer', currentState: 'Review', currentStep: 'Review turn', waitingReason: 'Waiting for reviewer response.', nextAction: 'The workflow resumes when the agent turn completes.' },
    callTree: [{ turnId: 'call-child', label: 'Child workflow', status: 'completed', childRunId: 'child-run', childUrl: '/dashboard/workflows/child-run', waitingReason: null, outputRef: 'workflow-run://child-run/output' }],
    outputs: [{ id: 'summary', label: 'Final summary', value: 'Workflow completed.', kind: 'summary' }],
    attention: null,
    timeline: [
      {
        id: 'implementer',
        role: 'Implementer',
        kind: 'agent_turn',
        state: 'Implement',
        step: 'Implementation turn',
        title: 'Implementation turn',
        status: 'Complete',
        session: { label: 'Implementer session', workspaceId: 'ws-1', sessionId: 'session-1' },
        initialMessage: { text: 'Please implement the page.', truncated: false, maxChars: 4096 },
        finalResponse: { text: 'Implemented the UI.', truncated: false, maxChars: 20_000 },
        responseUnavailable: null,
        commits: [{ before: 'aaaaaaaaaaaa', after: 'bbbbbbbbbbbb', merge: null }],
      },
      {
        id: 'reviewer',
        role: 'Reviewer',
        kind: 'agent_turn',
        state: 'Review',
        step: 'Review turn',
        title: 'Review turn',
        status: 'Complete',
        session: { label: 'Reviewer session', workspaceId: 'ws-2', sessionId: 'session-2' },
        initialMessage: { text: 'Please review the implementation.', truncated: false, maxChars: 4096 },
        finalResponse: { text: 'Reviewed and approved.', truncated: false, maxChars: 20_000 },
        responseUnavailable: null,
        commits: [],
      },
    ],
  };
}

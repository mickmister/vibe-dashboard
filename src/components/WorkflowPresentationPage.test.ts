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
];

describe('WorkflowPresentationView', () => {
  it('renders the clean story timeline without debug vocabulary', () => {
    const html = renderToStaticMarkup(React.createElement(WorkflowPresentationView, {
      presentation: presentationFixture(),
      error: null,
      loading: false,
      onRefresh: () => {},
    }));

    expect(html).toContain('Two agent review round');
    expect(html).toContain('Original task');
    expect(html).toContain('Build the clean workflow page');
    expect(html).toContain('Timeline');
    expect(html).toContain('Implementer');
    expect(html).toContain('Reviewer');
    expect(html).toContain('Initial message');
    expect(html).toContain('Final response');
    expect(html).toContain('Implemented the UI.');
    expect(html).toContain('Reviewed and approved.');
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
    attention: null,
    timeline: [
      {
        id: 'implementer',
        role: 'Implementer',
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

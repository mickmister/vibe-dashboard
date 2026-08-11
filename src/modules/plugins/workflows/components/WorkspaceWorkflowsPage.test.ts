import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WorkspaceWorkflowsHomeView } from './WorkspaceWorkflowsPage';
import type { WorkspaceWorkflowsHomeModel } from '../client/workflowsHomeApi';

const forbiddenTerms = ['webhook', 'HMAC', 'queue item', 'trigger', 'delivery ID', 'execution process ID', 'runReady', 'raw JSON', 'raw XML', 'WorkflowStepState'];

describe('WorkspaceWorkflowsHomeView', () => {
  it('renders a clean workspace workflows shell without debug terms', () => {
    const html = renderToStaticMarkup(React.createElement(WorkspaceWorkflowsHomeView, { home: fixture(), loading: false, error: null, onRefresh: () => {} }));
    expect(html).toContain('Workflows');
    expect(html).toContain('Available workflows');
    expect(html).toContain('Recent runs');
    expect(html).toContain('Needs your input');
    expect(html).toContain('Dev Review Tester');
    expect(html).toContain('Run');
    expect(html).toContain('Create form from agent');
    expect(html).toContain('Feature workflow run');
    expect(html).not.toContain('href="/dashboard/workflows/run-a"');
    expect(html).toContain('href="/dashboard/workflows/legacy-attention"');
    for (const term of forbiddenTerms) expect(html).not.toContain(term);
  });

  it('renders calm empty states and product error text', () => {
    const html = renderToStaticMarkup(React.createElement(WorkspaceWorkflowsHomeView, { home: { workspaceId: 'workspace-a', availableWorkflows: [], recentRuns: [], needsInput: [] }, loading: false, error: 'Workspace is required.', onRefresh: () => {} }));
    expect(html).toContain('No workflows are available yet.');
    expect(html).toContain('No workflow runs in this workspace yet.');
    expect(html).toContain('Nothing needs your input right now.');
    expect(html).toContain('Workspace is required.');
    for (const term of forbiddenTerms) expect(html).not.toContain(term);
  });
});

function fixture(): WorkspaceWorkflowsHomeModel {
  return {
    workspaceId: 'workspace-a',
    availableWorkflows: [
      { id: 'design-drt', title: 'Dev Review Tester', description: 'Feature work loop', source: 'published_design', status: 'ready', version: 1, unavailableReason: null, canRun: true, inputs: [{ id: 'featureRequest', type: 'markdown', required: true, description: null }], roles: [{ id: 'dev', label: 'Dev', description: null }] },
      { id: 'template-form', title: 'Create form from agent', description: null, source: 'template', status: 'ready', version: null, unavailableReason: null, canRun: false, inputs: [], roles: [] },
    ],
    recentRuns: [
      { runId: 'run-a', workflowName: 'Feature workflow run', status: 'running', startedAt: 1, updatedAt: 2, detailUrl: null },
    ],
    needsInput: [
      { attentionItemId: 'attention-a', title: 'Answer planning questions', description: 'Please fill out the form.', workflowName: 'Feature workflow run', createdAt: 3, detailUrl: '/dashboard/workflows/legacy-attention' },
    ],
  };
}

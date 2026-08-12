import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LaunchSummary, WorkspaceWorkflowsHomeView } from './WorkspaceWorkflowsPage';
import type { WorkspaceWorkflowsHomeModel } from '../client/workflowsHomeApi';

const forbiddenTerms = ['webhook', 'HMAC', 'queue item', 'trigger', 'delivery ID', 'execution process ID', 'runReady', 'raw JSON', 'raw XML', 'WorkflowStepState'];

describe('WorkspaceWorkflowsHomeView', () => {
  it('renders a clean workspace workflows shell without debug terms', () => {
    const html = renderToStaticMarkup(React.createElement(WorkspaceWorkflowsHomeView, { home: fixture(), loading: false, error: null, onRefresh: () => {} }));
    expect(html).toContain('data-testid="standalone-dashboard-page"');
    expect(html).toContain('h-screen');
    expect(html).toContain('overflow-y-auto');
    expect(html).toContain('Workflows');
    expect(html).toContain('Create workflow');
    expect(html).toContain('href="/dashboard/workflows/new?workspaceId=workspace-a"');
    expect(html).toContain('Your workflows');
    expect(html).toContain('Starter templates');
    expect(html).toContain('Recent batches');
    expect(html).toContain('Recent runs');
    expect(html).toContain('Needs your input');
    expect(html).toContain('Dev Review Tester');
    expect(html).toContain('Run');
    expect(html).toContain('Batch run');
    expect(html).toContain('Create copy');
    expect(html).toContain('Edit');
    expect(html).toContain('href="/dashboard/workflows/editor/design-drt"');
    expect(html).toContain('Starter template');
    expect(html).toContain('Create form from agent');
    expect(html).toContain('Feature workflow run');
    expect(html).toContain('1 complete · 1 running · 2 pending · 1 errors');
    expect(html).toContain('Open batch details');
    expect(html).toContain('href="/dashboard/workflow-batches/batch-a"');
    expect(html).toContain('Batch item details');
    expect(html).toContain('Line 2');
    expect(html).toContain('Batch item 2 is missing required workflow fields.');
    expect(html).toContain('featureRequest: This field is required.');
    expect(html).not.toContain('href="/dashboard/workflows/run-a"');
    expect(html).toContain('href="/dashboard/workflows/legacy-attention"');
    for (const term of forbiddenTerms) expect(html).not.toContain(term);
  });

  it('renders calm empty states and product error text', () => {
    const html = renderToStaticMarkup(React.createElement(WorkspaceWorkflowsHomeView, { home: { workspaceId: 'workspace-a', userWorkflows: [], starterTemplates: [], recentRuns: [], needsInput: [], recentBatches: [] }, loading: false, error: 'Workspace is required.', onRefresh: () => {} }));
    expect(html).toContain('No workflows yet. Create a copy from a starter template to make your first workflow.');
    expect(html).toContain('No starter templates are available right now.');
    expect(html).toContain('No workflow batches in this workspace yet.');
    expect(html).toContain('No workflow runs in this workspace yet.');
    expect(html).toContain('Nothing needs your input right now.');
    expect(html).toContain('Workspace is required.');
    for (const term of forbiddenTerms) expect(html).not.toContain(term);
  });

  it('TEST_CASE_M104_1A renders launch summary, run-scoped instructions context, and session choices', () => {
    const html = renderToStaticMarkup(React.createElement(LaunchSummary, {
      workflow: { id: 'design-drt', title: 'Dev Review Tester', description: null, source: 'published_design', status: 'ready', version: 2, unavailableReason: null, canRun: true, inputs: [], roles: [], launchSummary: { firstStateId: 'dev', firstActorRoleId: 'dev', firstActorLabel: 'Dev', mayNeedHumanInput: true, mayCallWorkflows: true } },
      inputs: [{ id: 'featureRequest', type: 'markdown', required: true, description: null }],
      selectedSessions: [{ role: { id: 'dev', label: 'Dev' }, text: 'Create or reuse “Dev”', warning: null }],
    }));
    expect(html).toContain('Launch summary');
    expect(html).toContain('Dev Review Tester · Published v2');
    expect(html).toContain('featureRequest');
    expect(html).toContain('Dev in dev');
    expect(html).toContain('This workflow may ask you for input.');
    expect(html).toContain('This workflow may call another workflow.');
    expect(html).toContain('Create or reuse');
  });
});

function fixture(): WorkspaceWorkflowsHomeModel {
  return {
    workspaceId: 'workspace-a',
    userWorkflows: [
      { id: 'design-drt', title: 'Dev Review Tester', description: 'Feature work loop', source: 'published_design', status: 'ready', version: 1, unavailableReason: null, canRun: true, inputs: [{ id: 'featureRequest', type: 'markdown', required: true, description: null }], roles: [{ id: 'dev', label: 'Dev', description: null }] },
      { id: 'design-draft', title: 'Planning Draft', description: 'Not published yet', source: 'published_design', status: 'unavailable', version: null, unavailableReason: 'Publish this workflow before running it.', canRun: false, inputs: [], roles: [] },
    ],
    starterTemplates: [
      { id: 'built-in/dev-review-tester', title: 'Dev / Review / Tester', description: null, source: 'template', status: 'ready', version: null, unavailableReason: null, canRun: false, inputs: [], roles: [] },
      { id: 'built-in/create-form-from-agent', title: 'Create form from agent', description: null, source: 'template', status: 'ready', version: null, unavailableReason: null, canRun: false, inputs: [], roles: [] },
    ],
    recentRuns: [
      { runId: 'run-a', workflowName: 'Feature workflow run', status: 'running', startedAt: 1, updatedAt: 2, detailUrl: null },
    ],
    recentBatches: [
      {
        batchId: 'batch-a',
        workflowName: 'Feature workflow run',
        status: 'running',
        counts: { total: 5, completed: 1, running: 1, pending: 2, failed: 1, blocked: 0, cancelled: 0 },
        items: [
          { batchItemId: 'batch-a-item-0', itemIndex: 0, status: 'completed', runId: 'run-0', error: null },
          { batchItemId: 'batch-a-item-1', itemIndex: 1, status: 'failed', runId: null, error: { code: 'workflow_launch_validation_failed', message: 'Batch item 2 is missing required workflow fields.', fieldErrors: { featureRequest: 'This field is required.' } } },
        ],
        updatedAt: 4,
        detailUrl: '/dashboard/workflow-batches/batch-a',
      },
    ],
    needsInput: [
      { attentionItemId: 'attention-a', title: 'Answer planning questions', description: 'Please fill out the form.', workflowName: 'Feature workflow run', createdAt: 3, detailUrl: '/dashboard/workflows/legacy-attention' },
    ],
  };
}

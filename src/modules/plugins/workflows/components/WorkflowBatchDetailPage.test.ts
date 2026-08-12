import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WorkflowBatchDetailView } from './WorkflowBatchDetailPage';
import type { WorkflowBatchDetailModel } from '../client/workflowsHomeApi';

const forbiddenTerms = ['webhook', 'HMAC', 'queue item', 'trigger', 'delivery ID', 'execution process ID', 'runReady', 'raw JSON', 'raw XML', 'WorkflowStepState'];

describe('WorkflowBatchDetailView', () => {
  it('TEST_CASE_M106_1A-E renders item detail, filters, capacity, run links, and no retry/cancel controls', () => {
    const html = renderToStaticMarkup(React.createElement(WorkflowBatchDetailView, { batch: fixture(), loading: false, error: null, onRefresh: () => {} }));

    expect(html).toContain('Workflow batch');
    expect(html).toContain('Dev Review Tester');
    expect(html).toContain('1 complete · 1 running · 1 pending · 1 failed/blocked');
    expect(html).toContain('Capacity and backpressure');
    expect(html).toContain('Workspace active runs');
    expect(html).toContain('1 / 1');
    expect(html).toContain('Pending items are waiting because this workspace already has 1 active run');
    expect(html).toContain('Batch items');
    expect(html).toContain('All');
    expect(html).toContain('Pending');
    expect(html).toContain('Running');
    expect(html).toContain('Complete');
    expect(html).toContain('Failed/blocked');
    expect(html).toContain('Line 1');
    expect(html).toContain('featureRequest: One');
    expect(html).toContain('href="/dashboard/workflows/run-1"');
    expect(html).toContain('Line 4');
    expect(html).toContain('Batch item 4 is missing required workflow fields.');
    expect(html).toContain('featureRequest: This field is required.');
    expect(html).toContain('Item recovery controls are intentionally deferred');
    expect(html).not.toContain('>Retry<');
    expect(html).not.toContain('>Cancel<');
    for (const term of forbiddenTerms) expect(html).not.toContain(term);
  });
});

function fixture(): WorkflowBatchDetailModel {
  return {
    batchId: 'batch-a',
    workflowName: 'Dev Review Tester',
    status: 'running',
    counts: { total: 4, completed: 1, running: 1, pending: 1, failed: 1, blocked: 0, cancelled: 0 },
    capacity: { workspaceActiveRuns: 1, workspaceActiveRunLimit: 1, globalActiveRuns: 2, globalActiveRunLimit: 4, explanation: 'Pending items are waiting because this workspace already has 1 active run; the workspace limit is 1.' },
    items: [
      { batchItemId: 'item-0', itemIndex: 0, lineNumber: 1, inputSummary: 'featureRequest: One', status: 'completed', runId: 'run-1', runUrl: '/dashboard/workflows/run-1', error: null, startedAt: 1, completedAt: 2, updatedAt: 2, pendingReason: null },
      { batchItemId: 'item-1', itemIndex: 1, lineNumber: 2, inputSummary: 'featureRequest: Two', status: 'running', runId: 'run-2', runUrl: '/dashboard/workflows/run-2', error: null, startedAt: 3, completedAt: null, updatedAt: 4, pendingReason: null },
      { batchItemId: 'item-2', itemIndex: 2, lineNumber: 3, inputSummary: 'featureRequest: Three', status: 'pending', runId: null, runUrl: null, error: null, startedAt: null, completedAt: null, updatedAt: 5, pendingReason: 'Pending items are waiting because this workspace already has 1 active run; the workspace limit is 1.' },
      { batchItemId: 'item-3', itemIndex: 3, lineNumber: 4, inputSummary: 'No input fields provided.', status: 'failed', runId: null, runUrl: null, error: { code: 'workflow_launch_validation_failed', message: 'Batch item 4 is missing required workflow fields.', fieldErrors: { featureRequest: 'This field is required.' } }, startedAt: null, completedAt: 6, updatedAt: 6, pendingReason: null },
    ],
    createdAt: 1,
    updatedAt: 6,
  };
}

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WorkflowCreationWizardView } from './WorkflowCreationWizardPage';
import type { WorkspaceWorkflowSummary } from '../client/workflowsHomeApi';

const forbiddenTerms = ['webhook', 'HMAC', 'queue item', 'trigger', 'delivery ID', 'execution process ID', 'runReady', 'raw JSON', 'raw XML', 'fire-and-forget', 'terminal handoff'];

describe('WorkflowCreationWizardView', () => {
  it('TEST_CASE_M107_1A-F renders wizard-first creation with lifecycle and graph preview', () => {
    const html = renderToStaticMarkup(React.createElement(WorkflowCreationWizardView, { workspaceId: 'workspace-a', userWorkflows: [workflow('design-drt', 'Dev Review Tester')], starterTemplates: [workflow('built-in/dev-review-tester', 'Dev / Review / Tester')] }));
    expect(html).toContain('Create workflow');
    expect(html).toContain('Choose a starting point');
    expect(html).toContain('Blank simple workflow');
    expect(html).toContain('Starter template');
    expect(html).toContain('Duplicate existing');
    expect(html).toContain('Name and purpose');
    expect(html).toContain('Inputs');
    expect(html).toContain('Roles');
    expect(html).toContain('Stages and supported steps');
    expect(html).toContain('Agent turn');
    expect(html).toContain('Human form');
    expect(html).toContain('Blocking workflow call');
    expect(html).toContain('Decisions and loops');
    expect(html).toContain('Review graph');
    expect(html).toContain('Save draft');
    expect(html).toContain('Save &amp; publish');
    expect(html).toContain('Drafts are editable but not runnable');
    expect(html).toContain('Graph editor remains available');
    for (const term of forbiddenTerms) expect(html).not.toContain(term);
  });
});

function workflow(id: string, title: string): WorkspaceWorkflowSummary {
  return { id, title, description: 'Workflow description', source: id.startsWith('built-in') ? 'template' : 'published_design', status: 'ready', version: 1, unavailableReason: null, canRun: true, inputs: [], roles: [] };
}

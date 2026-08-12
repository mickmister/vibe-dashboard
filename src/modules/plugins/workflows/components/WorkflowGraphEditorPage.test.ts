import { describe, expect, it } from 'vitest';
import { toFlowEdges, toFlowNodes } from './WorkflowGraphEditorPage';
import type { WorkflowGraphEdgeModel, WorkflowGraphNodeModel } from './graph/workflowGraphModel';

describe('WorkflowGraphEditorPage graph appearance', () => {
  it('uses dark-mode state node styles and distinguishes initial and terminal states', () => {
    const nodes = toFlowNodes([
      node({ id: 'dev', label: 'Dev', initial: true }),
      node({ id: 'done', label: 'Done', terminal: true }),
    ]);

    expect(nodes[0]).toMatchObject({
      id: 'dev',
      className: expect.stringContaining('workflow-state-node'),
      style: expect.objectContaining({ background: '#0f172a', color: '#e2e8f0', border: expect.stringContaining('#2563eb') }),
    });
    expect(String(nodes[0]?.className)).toContain('workflow-initial-node');
    expect(nodes[1]).toMatchObject({
      id: 'done',
      className: expect.stringContaining('workflow-terminal-node'),
      style: expect.objectContaining({ background: '#052e2b', color: '#d1fae5', border: expect.stringContaining('#10b981') }),
    });
  });

  it('uses readable dark edge labels and a distinct loop treatment', () => {
    const edges = toFlowEdges([
      { id: 'dev:ready', source: 'dev', target: 'review', actionId: 'ready', label: 'Ready', description: null },
      { id: 'dev:continue', source: 'dev', target: 'dev', actionId: 'continue', label: 'Keep working', description: null },
    ]);

    expect(edges[0]).toMatchObject({
      className: 'workflow-graph-edge',
      style: { stroke: '#38bdf8', strokeWidth: 2 },
      labelStyle: expect.objectContaining({ fill: '#e0f2fe' }),
      labelBgStyle: expect.objectContaining({ fill: '#0f172a' }),
    });
    expect(edges[1]).toMatchObject({
      animated: true,
      className: 'workflow-graph-edge workflow-loop-edge',
      style: { stroke: '#f59e0b', strokeWidth: 2.5 },
    });
  });
});

function node(patch: Partial<WorkflowGraphNodeModel>): WorkflowGraphNodeModel {
  return {
    id: 'state',
    label: 'State',
    ownerRoleId: null,
    ownerLabel: null,
    initial: false,
    terminal: false,
    steps: [],
    ...patch,
  };
}

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { WorkflowGraphEditorView } from './WorkflowGraphEditorPage';
import type { AgentWorkflowDefinitionV1 } from '@vibe-dashboard/workflow-core';

describe('WorkflowGraphEditorView prompt and skill picker', () => {
  it('TEST_CASE_M108_1A-E renders picker assets, selected refs, missing refs, and view-only JSON diagnostics', () => {
    const html = renderToStaticMarkup(React.createElement(WorkflowGraphEditorView, {
      editor: { designId: 'design-a', name: 'Workflow A', description: null, draftId: 'draft-a', version: 1, readonly: false, definition: promptDefinition(), validationStatus: 'valid', validationIssues: [] },
      definition: promptDefinition(),
      assets: {
        prompts: [{ kind: 'prompt', id: 'prompt.dev.instructions', version: 1, name: 'Dev instructions', description: 'Implementation prompt', source: 'built_in', preview: 'Implement carefully.' }],
        skills: [{ kind: 'skill', id: 'skill.testing.notes', version: 2, name: 'Testing notes', description: 'Markdown only', source: 'user', preview: 'Write focused tests.' }],
      },
      onDefinitionChange: () => {},
      onSave: () => {},
      onPublish: () => {},
    }));

    expect(html).toContain('Prompt and skill snippets');
    expect(html).toContain('Dev instructions');
    expect(html).toContain('v1 · Built-in');
    expect(html).toContain('Testing notes');
    expect(html).toContain('v2 · User');
    expect(html).toContain('Skills are markdown instruction snippets, not executable tools.');
    expect(html).toContain('Selected: prompt:prompt.dev.instructions@1, skill:skill.missing@1');
    expect(html).toContain('Missing prompt or skill refs: skill:skill.missing@1');
    expect(html).toContain('JSON diagnostics');
    expect(html).toContain('aria-readonly="true"');
    expect(html).not.toContain('prompt refs</span><input');
  });
});

function promptDefinition(): AgentWorkflowDefinitionV1 {
  return {
    schemaVersion: 1,
    name: 'Workflow A',
    inputs: { featureRequest: { type: 'markdown', required: true } },
    roles: { dev: { label: 'Dev' } },
    initialState: 'dev',
    states: {
      dev: {
        owner: 'dev',
        steps: [{ id: 'decide', type: 'agent_turn', turnType: 'decision', prompt: { template: 'Do work', refs: [{ kind: 'prompt', id: 'prompt.dev.instructions', version: 1 }, { kind: 'skill', id: 'skill.missing', version: 1 }] } as any, response: { format: 'xml', schema: { format: 'xsd', source: 'state_actions' }, invalidXmlRetry: { maxAttempts: 1, prompt: 'engine_default_with_validation_errors', onExhausted: 'blocked' }, storeRawXml: true, storeParsedFields: true, unknownFields: 'reject_unless_allowed_by_result_contract' } }],
        actions: { done: { label: 'Done', targetState: 'done' } },
      },
      done: { terminal: true },
    },
  };
}

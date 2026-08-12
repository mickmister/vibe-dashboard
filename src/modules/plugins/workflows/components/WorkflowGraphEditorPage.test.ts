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

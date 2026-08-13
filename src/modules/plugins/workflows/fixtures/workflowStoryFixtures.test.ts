import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WorkflowPresentationView } from '../../../../components/WorkflowPresentationPage';
import { WorkspaceWorkflowsHomeView } from '../components/WorkspaceWorkflowsPage';
import { WorkflowGraphEditorView } from '../components/WorkflowGraphEditorPage';
import { validateWorkflowGraph } from '../components/graph/workflowGraphModel';
import {
  completedWorkflowPresentationFixture,
  devReviewTesterWorkflowDefinition,
  githubCiWaitWorkflowDefinition,
  humanFormWorkflowDefinition,
  invalidWorkflowDefinition,
  runningCiPresentationFixture,
  simpleAgentWorkflowDefinition,
  workflowCallDefinition,
  workflowEditorFixture,
  workflowsHomeFixture,
  workflowStoryAssets,
  workflowStoryMatrix,
} from './workflowStoryFixtures';

describe('workflow Storybook fixtures', () => {
  it('M112 validates representative graph definitions and records future story matrix gaps', () => {
    for (const definition of [simpleAgentWorkflowDefinition(), devReviewTesterWorkflowDefinition(), humanFormWorkflowDefinition(), workflowCallDefinition(), githubCiWaitWorkflowDefinition()]) {
      expect(validateWorkflowGraph(definition)).toEqual([]);
    }
    expect(validateWorkflowGraph(invalidWorkflowDefinition())).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'WORKFLOW_GRAPH_CORE_INVALID' })]));
    expect(workflowStoryMatrix).toEqual(expect.arrayContaining([
      expect.objectContaining({ surface: 'Graph', story: 'GitHub CI wait', status: 'possible today' }),
      expect.objectContaining({ surface: 'Wizard/editor interactions', status: 'needs more work' }),
      expect.objectContaining({ surface: 'Centralized workflow page', status: 'concept only' }),
    ]));
  });

  it('M112 renders pure prop-based home and run views from fixtures without API/router dependencies', () => {
    const homeHtml = renderToStaticMarkup(React.createElement(WorkspaceWorkflowsHomeView, { home: workflowsHomeFixture(), loading: false, error: null, onRefresh: () => {}, embedded: true }));
    expect(homeHtml).toContain('Your workflows');
    expect(homeHtml).toContain('Starter templates');
    expect(homeHtml).toContain('Wait for GitHub CI');
    expect(homeHtml).not.toContain('webhook');
    expect(homeHtml).not.toContain('raw XML');

    const runHtml = renderToStaticMarkup(React.createElement(WorkflowPresentationView, { presentation: runningCiPresentationFixture(), loading: false, error: null, onRefresh: () => {} }));
    expect(runHtml).toContain('Waiting for GitHub CI to finish.');
    expect(runHtml).toContain('Wait for CI');
    expect(runHtml).not.toContain('webhook');
    expect(runHtml).not.toContain('rawXml');

    const completedHtml = renderToStaticMarkup(React.createElement(WorkflowPresentationView, { presentation: completedWorkflowPresentationFixture(), loading: false, error: null, onRefresh: () => {} }));
    expect(completedHtml).toContain('All checks passed');
    expect(completedHtml).toContain('Workflow is complete.');
  });

  it('M112 renders graph editor fixture with CI wait and prompt refs in dark workflow shell', () => {
    const definition = githubCiWaitWorkflowDefinition();
    const html = renderToStaticMarkup(React.createElement(WorkflowGraphEditorView, {
      editor: workflowEditorFixture(definition),
      definition,
      assets: workflowStoryAssets,
      onDefinitionChange: () => {},
      onSave: () => {},
      onPublish: () => {},
    }));
    expect(html).toContain('Graph');
    expect(html).toContain('Wait for CI');
    expect(html).toContain('Prompt and skill snippets');
    expect(html).toContain('CI wait prompt');
    expect(html).toContain('workflow-react-flow-canvas');
    expect(html).not.toContain('template is required');
  });
});

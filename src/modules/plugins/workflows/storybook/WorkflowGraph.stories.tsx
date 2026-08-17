import type { Meta, StoryObj } from '@storybook/react-vite';
import React, { useState } from 'react';
import type { AgentWorkflowDefinitionV1 } from '@vibe-dashboard/workflow-core';
import { WorkflowGraphEditorView } from '../components/WorkflowGraphEditorPage';
import {
  denseTransitionWorkflowDefinition,
  devReviewTesterWorkflowDefinition,
  githubCiWaitWorkflowDefinition,
  humanFormWorkflowDefinition,
  invalidWorkflowDefinition,
  simpleAgentWorkflowDefinition,
  workflowCallDefinition,
  workflowEditorFixture,
  workflowStoryAssets,
} from '../fixtures/workflowStoryFixtures';
import { StorybookVisualQaNotes, WorkflowStoryFrame } from './WorkflowStoryFrame';

const meta: Meta<typeof GraphStory> = {
  title: 'Workflows/Graph',
  component: GraphStory,
  parameters: {
    layout: 'fullscreen',
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const SimpleAgentWorkflow: Story = {
  args: {
    title: 'Simple agent workflow',
    definition: simpleAgentWorkflowDefinition(),
    initialGraphOpen: true,
  },
};

export const DevReviewTesterWorkflow: Story = {
  args: {
    title: 'Dev / Review / Tester workflow',
    description: 'Representative three-role graph with Review→Dev and Tester→Dev loops.',
    definition: devReviewTesterWorkflowDefinition(),
    initialGraphOpen: true,
  },
};

export const HumanFormWorkflow: Story = {
  args: {
    title: 'Human form workflow',
    description: 'Human form steps are visible as supported workflow steps and followed by a decision turn.',
    definition: humanFormWorkflowDefinition(),
    initialGraphOpen: true,
  },
};

export const BlockingWorkflowCall: Story = {
  args: {
    title: 'Blocking workflow call',
    description: 'Shows an executable blocking workflow_call step before the final decision turn.',
    definition: workflowCallDefinition(),
    initialGraphOpen: true,
  },
};

export const GitHubCiWaitAction: Story = {
  args: {
    title: 'GitHub CI wait action',
    description: 'M111 waitFor github_ci is represented as an action edge that waits before moving to Review.',
    definition: githubCiWaitWorkflowDefinition(),
    initialGraphOpen: true,
  },
};

export const DenseTransitionVisibility: Story = {
  args: {
    title: 'Dense transition visibility',
    description: 'Stress story for M113B: long labels, back edges, and multiple review paths should remain readable at default zoom.',
    definition: denseTransitionWorkflowDefinition(),
    initialGraphOpen: true,
  },
};

export const CompactContextualGraphCollapsed: Story = {
  args: {
    title: 'Compact contextual graph collapsed',
    description: 'ZJCB Slice 4: editor starts with the progressive outline as primary and graph preview collapsed.',
    definition: devReviewTesterWorkflowDefinition(),
    initialGraphOpen: false,
  },
};

export const InvalidDefinition: Story = {
  args: {
    title: 'Invalid workflow definition',
    description: 'Validation panel should show product-level graph/core issues without crashing the graph.',
    definition: invalidWorkflowDefinition(),
    initialGraphOpen: true,
  },
};

export const DarkModeVisualQa: Story = {
  args: { title: 'Graph dark-mode visual QA', definition: devReviewTesterWorkflowDefinition() },
  render: () => (
    <WorkflowStoryFrame
      title="Graph dark-mode visual QA"
      description="M112 manual review: dark slate graph canvas, readable labels, visible loop edges, selected/focus states, terminal states, and no harsh white default React Flow blocks."
    >
      <div className="space-y-5">
        <GraphStory title="Dev / Review / Tester dark mode" definition={devReviewTesterWorkflowDefinition()} initialGraphOpen />
        <GraphStory title="Dense transition visibility" definition={denseTransitionWorkflowDefinition()} initialGraphOpen />
        <StorybookVisualQaNotes
          items={[
            { label: 'Dark graph canvas', status: 'covered', note: 'Canvas uses slate/zinc surfaces and graph nodes use dark blue/slate styling.' },
            { label: 'Readable edge labels', status: 'covered', note: 'Edges use cyan labels with dark label backgrounds; loop edges use amber and animation.' },
            { label: 'Terminal state contrast', status: 'covered', note: 'Terminal states use emerald-on-dark treatment and are distinct from active states.' },
            { label: 'Interactive editing stories', status: 'later', note: 'Config-changing interaction stories need a controlled edit harness and action-state assertions; no live API/MSW needed yet.' },
          ]}
        />
      </div>
    </WorkflowStoryFrame>
  ),
};

function GraphStory({ title, description, definition, initialGraphOpen = false }: { title: string; description?: string; definition: AgentWorkflowDefinitionV1; initialGraphOpen?: boolean }): React.ReactElement {
  const [currentDefinition, setCurrentDefinition] = useState(definition);
  return (
    <WorkflowStoryFrame title={title} description={description} height="46rem">
      <WorkflowGraphEditorView
        editor={workflowEditorFixture(currentDefinition)}
        definition={currentDefinition}
        assets={workflowStoryAssets}
        onDefinitionChange={setCurrentDefinition}
        onSave={() => undefined}
        onPublish={() => undefined}
        initialGraphOpen={initialGraphOpen}
      />
    </WorkflowStoryFrame>
  );
}

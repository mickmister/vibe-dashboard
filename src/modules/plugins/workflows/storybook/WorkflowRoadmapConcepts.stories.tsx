import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { workflowStoryMatrix, workflowsHomeFixture, runningCiPresentationFixture } from '../fixtures/workflowStoryFixtures';
import { CentralizedWorkflowPageConcept } from './WorkflowConceptPage';
import { WorkflowStoryFrame } from './WorkflowStoryFrame';

const meta: Meta = {
  title: 'Workflows/Roadmap Concepts',
  parameters: { layout: 'fullscreen' },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const StoryMatrix: Story = {
  render: () => (
    <WorkflowStoryFrame title="Workflow Storybook matrix" description="M112-designed story matrix. Status indicates which stories are possible today versus future work.">
      <section className="mx-auto max-w-6xl overflow-hidden rounded-xl border border-slate-800 bg-slate-900/70">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-slate-950 text-xs uppercase tracking-wide text-zinc-400">
            <tr><th className="p-3">Surface</th><th className="p-3">Story</th><th className="p-3">Status</th><th className="p-3">Notes</th></tr>
          </thead>
          <tbody>
            {workflowStoryMatrix.map((item) => (
              <tr key={`${item.surface}:${item.story}`} className="border-t border-slate-800">
                <td className="p-3 text-zinc-100">{item.surface}</td>
                <td className="p-3 text-zinc-200">{item.story}</td>
                <td className="p-3"><span className="rounded-full border border-cyan-900 bg-cyan-950/30 px-2 py-0.5 text-xs text-cyan-200">{item.status}</span></td>
                <td className="p-3 text-zinc-300">{item.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </WorkflowStoryFrame>
  ),
};

export const CentralizedWorkflowPageConceptStory: Story = {
  name: 'Centralized workflow page concept',
  render: () => (
    <WorkflowStoryFrame title="Centralized workflow page concept" description="Concept-only Storybook surface for M113 discussion. No real product route, no live actions, no API/MSW.">
      <CentralizedWorkflowPageConcept home={workflowsHomeFixture()} selectedRun={runningCiPresentationFixture()} />
    </WorkflowStoryFrame>
  ),
};

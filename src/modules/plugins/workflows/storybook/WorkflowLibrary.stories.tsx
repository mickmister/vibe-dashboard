import type { Meta, StoryObj } from '@storybook/react-vite';
import { WorkflowLibraryView } from '../components/WorkflowLibraryPage';

const populatedAssets = {
  prompts: [
    { kind: 'prompt' as const, id: 'prompt.review.security', version: 1, name: 'Security review prompt', description: 'A reusable review behavior prompt.', source: 'user', preview: 'Review auth, data exposure, rollback, and abuse cases.', bodyMarkdown: 'Review auth, data exposure, rollback, and abuse cases.' },
    { kind: 'prompt' as const, id: 'prompt.review.product', version: 2, name: 'Product review prompt', description: 'A product-focused reviewer prompt.', source: 'user', preview: 'Review user value, edge cases, and clarity.', bodyMarkdown: 'Review user value, edge cases, and clarity.' },
  ],
  skills: [
    { kind: 'skill' as const, id: 'skill.testing.focused', version: 1, name: 'Focused testing', description: 'Markdown-only testing guidance.', source: 'user', preview: 'Write focused tests and call out untested paths.', bodyMarkdown: 'Write focused tests and call out untested paths.' },
  ],
  roleTemplates: [
    { id: 'role.review.security', version: 1, name: 'Security reviewer', description: 'A second review agent type with security-focused behavior.', source: 'user', promptPreview: 'Review for security risks and summarize concerns.', promptMarkdown: 'Review for security risks and summarize concerns.', promptRefs: [{ kind: 'prompt' as const, id: 'prompt.review.security', versionMode: 'latest' as const }], skillRefs: [{ kind: 'skill' as const, id: 'skill.testing.focused', version: 1, versionMode: 'pinned' as const }], executorPreference: { executorType: 'CODEX', model: 'gpt-5-codex', mode: 'preferred' }, active: true },
  ],
};

const meta = {
  title: 'Workflows/Library',
  component: WorkflowLibraryView,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof WorkflowLibraryView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {
  args: { assets: populatedAssets },
};

export const Empty: Story = {
  args: { assets: { prompts: [], skills: [], roleTemplates: [] } },
};

export const ErrorState: Story = {
  args: { assets: { prompts: [], skills: [], roleTemplates: [] }, error: 'Workflow library provider is unavailable.' },
};

export const EditingRoleTemplate: Story = {
  args: { assets: populatedAssets, initialMode: { kind: 'role', source: populatedAssets.roleTemplates[0] } },
};

export const EditingPromptAsNewVersion: Story = {
  args: { assets: populatedAssets, initialMode: { kind: 'prompt', source: populatedAssets.prompts[0] } },
};

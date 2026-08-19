import type { Meta, StoryObj } from '@storybook/react-vite';
import { HeroUIProvider } from '@heroui/react';
import { ExternalBeadsBoardContent } from './ExternalBeadsBoardView';
import type { ExternalBeadsBoardViewDto } from '../externalTrackerBoardApi';

const meta: Meta<typeof ExternalBeadsBoardContent> = {
  title: 'External Kanban/Beads Board',
  component: ExternalBeadsBoardContent,
  decorators: [
    (Story) => (
      <HeroUIProvider>
        <Story />
      </HeroUIProvider>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof ExternalBeadsBoardContent>;

const beadsBoard: ExternalBeadsBoardViewDto = {
  provider: 'beads',
  viewMode: 'board',
  sourceUrl: 'beads:///repos/vibe-kanban-vscode-web',
  siteHostname: '/repos/vibe-kanban-vscode-web',
  resource: { id: '/repos/vibe-kanban-vscode-web', name: 'vibe-kanban-vscode-web', url: '/repos/vibe-kanban-vscode-web', sourceDirectory: '/repos/vibe-kanban-vscode-web' },
  board: { id: 'default', name: 'Beads workflow', type: 'beads-status-board' },
  columns: [
    { id: 'open', title: 'Open', statusIds: ['open'] },
    { id: 'in_progress', title: 'In Progress', statusIds: ['in_progress'] },
    { id: 'blocked', title: 'Blocked', statusIds: ['blocked'] },
  ],
  cards: [
    {
      id: 'vkvw-hifa.12',
      key: 'vkvw-hifa.12',
      title: 'Add Beads provider configurable workflow Kanban views',
      url: 'beads://vkvw-hifa.12',
      columnId: 'in_progress',
      statusId: 'in_progress',
      statusName: 'In Progress',
      priority: '1',
      assignee: { displayName: 'Vibe Kanban' },
      labels: ['beads', 'kanban', 'workflow'],
      relatedWorkspaces: [{ workspaceId: '80ff6694-a5a9-4449-90db-ce594494a29a', displayName: 'VD - Kanban Integration', isPrimary: true }],
      rank: 0,
      metadata: { dependencyCount: 0, dependentCount: 2, ageDays: 1 },
    },
    {
      id: 'vkvw-hifa.12-docs',
      key: 'vkvw-hifa.12-docs',
      title: 'Document saved Beads workflow view rules',
      url: 'beads://vkvw-hifa.12-docs',
      columnId: 'open',
      statusId: 'open',
      statusName: 'Open',
      labels: ['docs'],
      rank: 1,
      metadata: { dependencyCount: 1, dependentCount: 0, ageDays: 3 },
    },
  ],
  swimlanes: { fidelity: 'none', lanes: [] },
  pagination: { pageCount: 1, issueCount: 2, maxResults: 2 },
  diagnostics: { source: 'bd-export', cache: 'fresh', lastFetchedAt: '2026-08-19T00:00:00.000Z', statusSource: 'bd-statuses', hiddenCompletedCount: 12 },
};

export const DefaultStatusBoard: Story = {
  args: {
    boardView: beadsBoard,
    showCompleted: false,
    onShowCompletedChange: () => undefined,
    onRefresh: () => undefined,
  },
};

export const EmptyAfterCompletedHidden: Story = {
  args: {
    boardView: {
      ...beadsBoard,
      cards: [],
      pagination: { pageCount: 1, issueCount: 0, maxResults: 0 },
      diagnostics: { ...beadsBoard.diagnostics!, hiddenCompletedCount: 12 },
    },
    showCompleted: false,
    onShowCompletedChange: () => undefined,
    onRefresh: () => undefined,
  },
};

import type { Meta, StoryObj } from '@storybook/react-vite';
import { HeroUIProvider } from '@heroui/react';
import { ExternalLinearBoardContent } from './ExternalLinearBoardView';
import type { ExternalLinearBoardViewDto } from '../externalTrackerBoardApi';

const meta: Meta<typeof ExternalLinearBoardContent> = {
  title: 'External Kanban/Linear Board',
  component: ExternalLinearBoardContent,
  decorators: [
    (Story) => (
      <HeroUIProvider>
        <Story />
      </HeroUIProvider>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof ExternalLinearBoardContent>;

const fullCircleInspiredBoard: ExternalLinearBoardViewDto = {
  provider: 'linear',
  sourceUrl: 'https://linear.app/jamtools/team/VD/all',
  siteHostname: 'linear.app/jamtools',
  resource: { id: 'jamtools', name: 'jamtools', url: 'https://linear.app/jamtools' },
  board: { id: 'jamtools:team:VD', name: 'Linear team VD', type: 'team', projectKey: 'VD' },
  columns: [
    { id: 'backlog', title: 'Backlog', statusIds: ['backlog'] },
    { id: 'todo', title: 'Todo', statusIds: ['todo'] },
    { id: 'started', title: 'In Progress', statusIds: ['started'] },
    { id: 'done', title: 'Done', statusIds: ['done'] },
  ],
  cards: [
    {
      id: 'issue-1',
      key: 'VD-101',
      title: 'Record FullCircle fixture for Linear team view',
      url: 'https://linear.app/jamtools/issue/VD-101/record-fullcircle-fixture',
      statusId: 'todo',
      statusName: 'Todo',
      columnId: 'todo',
      labels: ['fixtures'],
      relatedBeads: [{ id: 'vkvw-linear-fixture', title: 'Create Linear fixture task', status: 'open', externalIssue: { provider: 'linear', key: 'VD-101', url: 'https://linear.app/jamtools/issue/VD-101/record-fullcircle-fixture', site: 'linear.app/jamtools' } }],
      rank: 0,
      metadata: { projectName: 'Linear provider' },
    },
    {
      id: 'issue-2',
      key: 'VD-102',
      title: 'Render Linear workflow states as columns',
      url: 'https://linear.app/jamtools/issue/VD-102/render-linear-workflow-states',
      statusId: 'started',
      statusName: 'In Progress',
      columnId: 'started',
      labels: ['provider', 'ui'],
      relatedWorkspaces: [{ workspaceId: 'ws-linear-provider', displayName: 'Linear Provider Workspace', isPrimary: true, metadata: { filesChanged: 8, linesChanged: 240 } }],
      rank: 1,
      metadata: { projectName: 'Linear provider' },
    },
    {
      id: 'issue-3',
      key: 'VD-103',
      title: 'Document LINEAR_KANBAN_API_KEY setup',
      url: 'https://linear.app/jamtools/issue/VD-103/document-linear-api-key',
      statusId: 'done',
      statusName: 'Done',
      columnId: 'done',
      labels: ['docs'],
      relatedBeads: [{ id: 'vkvw-linear-docs', title: 'Docs task', status: 'closed', externalIssue: { provider: 'linear', key: 'VD-103', url: 'https://linear.app/jamtools/issue/VD-103/document-linear-api-key', site: 'linear.app/jamtools' } }],
      rank: 2,
      metadata: { projectName: 'Linear provider' },
    },
  ],
  swimlanes: { fidelity: 'none', lanes: [] },
  pagination: { pageCount: 1, issueCount: 3, maxResults: 50 },
  diagnostics: { authSource: 'api_key', linearMode: 'issues', locatorViewKind: 'team', workspaceSlug: 'jamtools', teamKey: 'VD', issueCount: 3 },
};

export const TeamWorkflowBoard: Story = {
  args: {
    boardView: fullCircleInspiredBoard,
  },
};

export const EmptyLinearView: Story = {
  args: {
    boardView: {
      ...fullCircleInspiredBoard,
      cards: [],
      pagination: { pageCount: 1, issueCount: 0, maxResults: 50 },
      diagnostics: { ...fullCircleInspiredBoard.diagnostics!, issueCount: 0 },
    },
  },
};

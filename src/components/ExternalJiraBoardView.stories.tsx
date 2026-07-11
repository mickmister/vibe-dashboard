import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { ExternalJiraBoardContent, ExternalTrackerMessage } from './ExternalJiraBoardView';
import type { ExternalJiraBoardViewDto, ExternalKanbanCardDto } from '../lib/externalTrackerBoardApi';

const baseCard: ExternalKanbanCardDto = {
  id: '10001',
  key: 'VD-1',
  title: 'Replicate Jira board in VD',
  url: 'https://team.atlassian.net/browse/VD-1',
  statusId: '10000',
  statusName: 'To Do',
  columnId: 'todo-10000',
  issueType: 'Task',
  priority: 'High',
  assignee: { accountId: 'user-1', displayName: 'Ada Lovelace' },
  labels: ['external-trackers'],
  rank: 0,
  metadata: {},
};

const doneCard: ExternalKanbanCardDto = {
  id: '10002',
  key: 'VD-2',
  title: 'Keep the smoke test deterministic',
  url: 'https://team.atlassian.net/browse/VD-2',
  statusId: '10002',
  statusName: 'Done',
  columnId: 'done-10002',
  issueType: 'Task',
  labels: [],
  rank: 1,
  metadata: {},
};

const baseBoardView: ExternalJiraBoardViewDto = {
  provider: 'jira',
  sourceUrl: 'https://team.atlassian.net/jira/software/projects/VD/boards/42',
  siteHostname: 'team.atlassian.net',
  resource: { id: 'cloud-1', name: 'Team Jira', url: 'https://team.atlassian.net' },
  board: { id: '42', name: 'VD Integration Board', type: 'kanban', projectKey: 'VD' },
  columns: [
    { id: 'todo-10000', title: 'To Do', statusIds: ['10000'] },
    { id: 'done-10002', title: 'Done', statusIds: ['10002'] },
  ],
  cards: [baseCard, doneCard],
  swimlanes: { fidelity: 'none', lanes: [], reason: 'No swimlane configuration available in this fixture.' },
  pagination: { pageCount: 1, issueCount: 2, maxResults: 50 },
};

function makeCard(index: number, overrides: Partial<ExternalKanbanCardDto> = {}): ExternalKanbanCardDto {
  const isDone = index % 3 === 0;
  const key = `VD-${index}`;
  return {
    ...baseCard,
    id: `100${String(index).padStart(2, '0')}`,
    key,
    title: `Mobile scrolling fixture issue ${index}`,
    url: `https://team.atlassian.net/browse/${key}`,
    statusId: isDone ? '10002' : '10000',
    statusName: isDone ? 'Done' : 'To Do',
    columnId: isDone ? 'done-10002' : 'todo-10000',
    labels: index % 2 === 0 ? ['external-trackers'] : [],
    rank: index,
    relatedBeads: undefined,
    relatedWorkspaces: undefined,
    ...overrides,
  };
}

const manyCards = Array.from({ length: 18 }, (_, index) => makeCard(index + 1));

const mixedDecorationCards: ExternalKanbanCardDto[] = [
  makeCard(1, {
    title: 'No linked beads or workspace yet',
  }),
  makeCard(2, {
    title: 'Has two beads with one completed',
    relatedBeads: [
      {
        id: 'vkvw-card-2a',
        title: 'Create backend adapter',
        status: 'closed',
        externalIssue: { provider: 'jira', key: 'VD-2', url: 'https://team.atlassian.net/browse/VD-2', site: 'team.atlassian.net' },
      },
      {
        id: 'vkvw-card-2b',
        title: 'Polish card states',
        status: 'open',
        externalIssue: { provider: 'jira', key: 'VD-2', url: 'https://team.atlassian.net/browse/VD-2', site: 'team.atlassian.net' },
      },
    ],
  }),
  makeCard(3, {
    title: 'Has an existing workspace',
    relatedWorkspaces: [
      { workspaceId: 'ws-card-3', workspaceDir: '/repos/Vktest', displayName: 'Vktest workspace', isPrimary: true },
    ],
  }),
  makeCard(4, {
    title: 'Rare multiple-workspace mapping',
    relatedWorkspaces: [
      { workspaceId: 'ws-card-4a', workspaceDir: '/repos/Vktest', displayName: 'Primary workspace', isPrimary: true },
      { workspaceId: 'ws-card-4b', workspaceDir: '/repos/Vktest-spike', displayName: 'Spike workspace', isPrimary: false },
    ],
    relatedBeads: [
      {
        id: 'vkvw-card-4',
        title: 'Verify uncommon multi-workspace card',
        status: 'done',
        externalIssue: { provider: 'jira', key: 'VD-4', url: 'https://team.atlassian.net/browse/VD-4', site: 'team.atlassian.net' },
      },
    ],
  }),
  ...Array.from({ length: 10 }, (_, index) => makeCard(index + 5)),
];

function board(overrides: Partial<ExternalJiraBoardViewDto>): ExternalJiraBoardViewDto {
  return { ...baseBoardView, ...overrides };
}

function StoryFrame({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="h-dvh overflow-y-auto overscroll-contain bg-neutral-950"
      style={{ WebkitOverflowScrolling: 'touch' }}
    >
      {children}
    </div>
  );
}

const meta: Meta<typeof ExternalJiraBoardContent> = {
  title: 'External Trackers/Jira Board View',
  component: ExternalJiraBoardContent,
  parameters: {
    layout: 'fullscreen',
  },
  decorators: [
    (Story) => (
      <StoryFrame>
        <Story />
      </StoryFrame>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const NormalBoard: Story = {
  args: { boardView: baseBoardView },
};

export const EmptyBoard: Story = {
  args: {
    boardView: board({
      cards: [],
      pagination: { ...baseBoardView.pagination, issueCount: 0 },
    }),
  },
};

export const UnmappedCards: Story = {
  args: {
    boardView: board({
      cards: [{ ...baseCard, columnId: 'missing-column', statusName: 'Needs triage' }],
      pagination: { ...baseBoardView.pagination, issueCount: 1 },
    }),
  },
};

export const PartialSwimlaneFallback: Story = {
  args: {
    boardView: board({
      swimlanes: {
        fidelity: 'partial',
        lanes: [{ id: 'EPIC-1', title: 'EPIC-1: External tracker integration', issueKeys: ['VD-1'] }],
        reason: 'Fixture models best-effort Jira swimlane inference.',
      },
    }),
  },
};

export const MobileScrollManyCards: Story = {
  args: {
    boardView: board({
      board: { ...baseBoardView.board, name: 'VD Integration Board — Mobile scroll fixture' },
      cards: manyCards,
      pagination: { ...baseBoardView.pagination, issueCount: manyCards.length },
    }),
  },
};

export const MixedDecorationStates: Story = {
  args: {
    boardView: board({
      board: { ...baseBoardView.board, name: 'VD Integration Board — Mixed decorations' },
      cards: mixedDecorationCards,
      pagination: { ...baseBoardView.pagination, issueCount: mixedDecorationCards.length },
      swimlanes: {
        fidelity: 'partial',
        lanes: [{ id: 'EPIC-MIXED', title: 'EPIC-MIXED: Cards with explicit links', issueKeys: ['VD-2', 'VD-3', 'VD-4'] }],
        reason: 'Mixed fixture leaves most cards in Other issues to show fallback plus mobile vertical scroll.',
      },
    }),
  },
};

export const RelatedWorkspaces: Story = {
  args: {
    boardView: board({
      cards: [
        {
          ...baseCard,
          relatedWorkspaces: [
            { workspaceId: 'ws-1', workspaceDir: '/repos/Vktest', displayName: 'Vktest workspace', isPrimary: true },
            { workspaceId: 'ws-2', workspaceDir: '/repos/Vktest-experiment', displayName: 'Experiment workspace', isPrimary: false },
          ],
        },
        doneCard,
      ],
    }),
  },
};

export const RelatedBeads: Story = {
  args: {
    boardView: board({
      cards: [
        {
          ...baseCard,
          relatedBeads: [
            {
              id: 'vkvw-573j.8',
              title: 'End-to-end Jira board replication smoke test',
              status: 'closed',
              externalIssue: { provider: 'jira', key: 'VD-1', url: 'https://team.atlassian.net/browse/VD-1', site: 'team.atlassian.net' },
            },
          ],
        },
        doneCard,
      ],
    }),
  },
};

export const UnsupportedUrl = {
  render: () => (
    <ExternalTrackerMessage
      title="Unsupported external view"
      message="The external URL was malformed."
      action="Open a supported Jira board URL and launch VD again."
      code="malformed_url"
    />
  ),
};

export const ApiError = {
  render: () => (
    <ExternalTrackerMessage
      title="Could not load Jira board"
      message="Jira is not connected for this user."
      action="Connect Jira for your account and try again."
      code="jira_not_connected"
    />
  ),
};

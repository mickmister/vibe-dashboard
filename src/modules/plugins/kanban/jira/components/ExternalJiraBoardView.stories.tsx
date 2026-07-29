import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { ExternalJiraBoardContent, ExternalTrackerMessage } from './ExternalJiraBoardView';
import type { ExternalJiraBoardViewDto, ExternalKanbanCardDto } from '../externalTrackerBoardApi';
import { getGeneratedExternalJiraStorybookFixture } from '../storybook/externalJiraGeneratedFixtures';

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

const backlogCard: ExternalKanbanCardDto = {
  ...baseCard,
  id: '10000',
  key: 'VD-0',
  title: 'Plan external Kanban scope',
  url: 'https://team.atlassian.net/browse/VD-0',
  statusId: '99999',
  statusName: 'Backlog',
  columnId: 'backlog-99999',
  rank: -1,
};

const baseBoardView: ExternalJiraBoardViewDto = {
  provider: 'jira',
  sourceUrl: 'https://team.atlassian.net/jira/software/projects/VD/boards/42',
  siteHostname: 'team.atlassian.net',
  resource: { id: 'cloud-1', name: 'Team Jira', url: 'https://team.atlassian.net' },
  board: { id: '42', name: 'VD Integration Board', type: 'kanban', projectKey: 'VD' },
  columns: [
    { id: 'backlog-99999', title: 'Backlog', statusIds: ['99999'] },
    { id: 'todo-10000', title: 'To Do', statusIds: ['10000'] },
    { id: 'done-10002', title: 'Done', statusIds: ['10002'] },
  ],
  cards: [backlogCard, baseCard, doneCard],
  swimlanes: { fidelity: 'none', lanes: [], reason: 'No swimlane configuration available in this fixture.' },
  pagination: { pageCount: 1, issueCount: 3, maxResults: 50 },
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
    title: 'No linked tasks or workspace yet',
  }),
  makeCard(2, {
    title: 'Has two tasks with one completed',
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
        status: 'in_progress',
        externalIssue: { provider: 'jira', key: 'VD-2', url: 'https://team.atlassian.net/browse/VD-2', site: 'team.atlassian.net', metadata: { assignedToCurrentUser: true } },
      },
    ],
  }),
  makeCard(3, {
    title: 'Has an existing workspace',
    relatedWorkspaces: [
      { workspaceId: 'ws-card-3', workspaceDir: '/repos/Vktest', displayName: 'Vktest workspace', isPrimary: true, metadata: { filesChanged: 6, linesChanged: 148, agentSessions: 2, agentMessages: 37 } },
    ],
  }),
  makeCard(4, {
    title: 'Rare multiple-workspace mapping',
    relatedWorkspaces: [
      { workspaceId: 'ws-card-4a', workspaceDir: '/repos/Vktest', displayName: 'Primary workspace', isPrimary: true, metadata: { filesChanged: 12, linesChanged: 320, agentSessions: 3, agentMessages: 84 } },
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

const generatedJiraFixture = getGeneratedExternalJiraStorybookFixture();

export const GeneratedLocalJiraFixture: Story = {
  args: generatedJiraFixture ? { boardView: generatedJiraFixture.boardView } : { boardView: baseBoardView },
  render: (args) => generatedJiraFixture ? (
    <ExternalJiraBoardContent {...args} />
  ) : (
    <ExternalTrackerMessage
      title="No generated Jira fixture found"
      message="Run npm run storybook:jira-fixture with an Atlassian OAuth access token and Jira board URL, then restart Storybook."
      action="Static Jira stories are still available below."
    />
  ),
  parameters: {
    docs: {
      description: {
        story: 'Uses src/storybook-fixtures/external-jira/*.generated.json when present. The fixture is generated locally and gitignored.',
      },
    },
  },
};

export const NormalBoard: Story = {
  args: { boardView: baseBoardView },
  parameters: {
    docs: {
      description: {
        story: 'Backlog and Done are hidden by default; use the header controls to show them.',
      },
    },
  },
};

export const BacklogAndDoneShown: Story = {
  args: {
    boardView: baseBoardView,
    initialColumnVisibility: { showBacklog: true, showDone: true },
  },
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

export const ExplicitGroupingSwimlaneFallback: Story = {
  args: {
    boardView: board({
      swimlanes: {
        fidelity: 'partial',
        lanes: [{ id: 'EPIC-1', title: 'EPIC-1: External tracker integration', issueKeys: ['VD-1'] }],
        reason: 'Fixture models explicit user-selected grouping; Jira swimlanes are not inferred automatically.',
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
        reason: 'Mixed fixture uses explicit user-selected grouping and leaves most cards in Other issues to show fallback plus mobile vertical scroll.',
      },
    }),
  },
};

export const SidePanelClosed: Story = {
  args: {
    boardView: board({
      cards: mixedDecorationCards,
      pagination: { ...baseBoardView.pagination, issueCount: mixedDecorationCards.length },
    }),
  },
};

export const SidePanelOpen: Story = {
  args: {
    boardView: board({
      cards: mixedDecorationCards,
      pagination: { ...baseBoardView.pagination, issueCount: mixedDecorationCards.length },
    }),
    initialSidePanelWorkspaceId: 'ws-card-3',
  },
};

export const MobileSidePanel: Story = {
  args: {
    boardView: board({
      cards: mixedDecorationCards,
      pagination: { ...baseBoardView.pagination, issueCount: mixedDecorationCards.length },
    }),
    initialSidePanelWorkspaceId: 'ws-card-3',
  },
  parameters: {
    viewport: {
      defaultViewport: 'mobile1',
    },
  },
};

export const CardWithWorkspaceSession: Story = {
  args: {
    boardView: board({
      cards: [mixedDecorationCards[2]!],
      pagination: { ...baseBoardView.pagination, issueCount: 1 },
    }),
    initialSidePanelWorkspaceId: 'ws-card-3',
  },
};

export const CardWithoutWorkspaceSession: Story = {
  args: {
    boardView: board({
      cards: [mixedDecorationCards[0]!],
      pagination: { ...baseBoardView.pagination, issueCount: 1 },
    }),
  },
};

export const SidePanelWithIssueDetails: Story = {
  args: {
    boardView: board({
      cards: mixedDecorationCards,
      pagination: { ...baseBoardView.pagination, issueCount: mixedDecorationCards.length },
    }),
    initialSelectedCardId: mixedDecorationCards[2]?.id,
    initialSidePanelWorkspaceId: 'ws-card-3',
  },
};

export const NoWorkspaceNoTasks: Story = {
  args: {
    boardView: board({
      cards: [makeCard(31, { title: 'No workspace and no linked tasks' })],
      pagination: { ...baseBoardView.pagination, issueCount: 1 },
    }),
  },
};

export const WorkspaceMetrics: Story = {
  args: {
    boardView: board({
      cards: [mixedDecorationCards[2]!],
      pagination: { ...baseBoardView.pagination, issueCount: 1 },
    }),
  },
};


export const WorkspaceMetricsUnavailable: Story = {
  args: {
    boardView: board({
      cards: [makeCard(35, {
        title: 'Existing workspace with metrics still loading or unavailable',
        relatedWorkspaces: [
          { workspaceId: 'ws-card-35', workspaceDir: '/repos/Vktest-unavailable', displayName: 'Workspace without activity metrics', isPrimary: true },
        ],
      })],
      pagination: { ...baseBoardView.pagination, issueCount: 1 },
    }),
  },
};

export const TaskCompletion: Story = {
  args: {
    boardView: board({
      cards: [mixedDecorationCards[1]!],
      pagination: { ...baseBoardView.pagination, issueCount: 1 },
    }),
  },
};

export const InProgressAndNextUpTasks: Story = {
  args: {
    boardView: board({
      cards: [
        makeCard(32, {
          title: 'In-progress and next-up task summary',
          relatedBeads: [
            { id: 'vkvw-progress', title: 'Implement detail sheet polish', status: 'in_progress', externalIssue: { provider: 'jira', key: 'VD-32', url: 'https://team.atlassian.net/browse/VD-32', site: 'team.atlassian.net' } },
            { id: 'vkvw-next', title: 'Add mobile QA pass', status: 'open', externalIssue: { provider: 'jira', key: 'VD-32', url: 'https://team.atlassian.net/browse/VD-32', site: 'team.atlassian.net' } },
          ],
        }),
      ],
      pagination: { ...baseBoardView.pagination, issueCount: 1 },
    }),
  },
};

export const UserAssignedAndImplicitReviewTasks: Story = {
  args: {
    boardView: board({
      cards: [
        makeCard(33, {
          title: 'User assigned task emphasized',
          relatedBeads: [
            { id: 'vkvw-yours', title: 'Review user-facing card copy', status: 'open', externalIssue: { provider: 'jira', key: 'VD-33', url: 'https://team.atlassian.net/browse/VD-33', site: 'team.atlassian.net', metadata: { assignedToCurrentUser: true } } },
            { id: 'vkvw-done', title: 'Ship task count summary', status: 'closed', externalIssue: { provider: 'jira', key: 'VD-33', url: 'https://team.atlassian.net/browse/VD-33', site: 'team.atlassian.net' } },
          ],
        }),
        makeCard(34, {
          title: 'Implicit review suggested from latest completed task',
          relatedBeads: [
            { id: 'vkvw-done-only', title: 'Complete workspace metrics fixture', status: 'closed', externalIssue: { provider: 'jira', key: 'VD-34', url: 'https://team.atlassian.net/browse/VD-34', site: 'team.atlassian.net' } },
          ],
        }),
      ],
      pagination: { ...baseBoardView.pagination, issueCount: 2 },
    }),
  },
};

export const OpenDetailSheet: Story = {
  args: {
    boardView: board({
      cards: mixedDecorationCards,
      pagination: { ...baseBoardView.pagination, issueCount: mixedDecorationCards.length },
    }),
    initialSelectedCardId: mixedDecorationCards[1]?.id,
  },
};

export const MobileFullScreenDetailSheet: Story = {
  args: {
    boardView: board({
      cards: mixedDecorationCards,
      pagination: { ...baseBoardView.pagination, issueCount: mixedDecorationCards.length },
    }),
    initialSelectedCardId: mixedDecorationCards[2]?.id,
  },
  parameters: {
    viewport: {
      defaultViewport: 'mobile1',
    },
  },
};

export const DesktopSideDetailSheet: Story = {
  args: {
    boardView: board({
      cards: mixedDecorationCards,
      pagination: { ...baseBoardView.pagination, issueCount: mixedDecorationCards.length },
    }),
    initialSelectedCardId: mixedDecorationCards[3]?.id,
  },
};

export const DetailSheetPagingBoundaries: Story = {
  args: {
    boardView: board({
      cards: [makeCard(1), makeCard(2), makeCard(3)],
      pagination: { ...baseBoardView.pagination, issueCount: 3 },
    }),
    initialSelectedCardId: makeCard(1).id,
  },
};

export const LongIssueDetailSheet: Story = {
  args: {
    boardView: board({
      cards: [
        makeCard(21, {
          title: 'Long issue title that wraps across multiple lines to demonstrate mobile detail sheet scrolling and readable issue context inside VD',
          labels: ['external-trackers', 'jira', 'mobile', 'storybook', 'single-pane-of-glass', 'long-content'],
          relatedBeads: [
            {
              id: 'vkvw-long-1',
              title: 'Collect long issue detail requirements',
              status: 'closed',
              externalIssue: { provider: 'jira', key: 'VD-21', url: 'https://team.atlassian.net/browse/VD-21', site: 'team.atlassian.net' },
            },
            {
              id: 'vkvw-long-2',
              title: 'Validate full-screen mobile panel behavior',
              status: 'open',
              externalIssue: { provider: 'jira', key: 'VD-21', url: 'https://team.atlassian.net/browse/VD-21', site: 'team.atlassian.net' },
            },
          ],
          relatedWorkspaces: [
            { workspaceId: 'ws-long', workspaceDir: '/repos/Vktest/mobile-detail-sheet', displayName: 'Mobile detail workspace', isPrimary: true },
          ],
        }),
        ...manyCards.slice(0, 5),
      ],
      pagination: { ...baseBoardView.pagination, issueCount: 6 },
    }),
    initialSelectedCardId: '10021',
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

export const RelatedTasks: Story = {
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

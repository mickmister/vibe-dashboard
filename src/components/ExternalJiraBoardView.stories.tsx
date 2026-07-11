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

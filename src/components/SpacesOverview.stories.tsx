import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  SpacesOverviewView,
  type DashboardWorkspace,
} from './SpacesOverview';
import {
  storybookRepos,
  storybookRepoBranches,
  storybookSavedSessions,
  storybookSpaces,
  storybookVKWorkspaces,
  storybookWorkspace,
  storybookWorkspaceSummaries,
} from '../stories/fixtures';

const dashboardWorkspaces: DashboardWorkspace[] = storybookVKWorkspaces.map(
  (workspace) => {
    const summary = storybookWorkspaceSummaries.find(
      (candidate) => candidate.workspace_id === workspace.id,
    );
    return {
      id: workspace.id,
      name: workspace.name || workspace.branch,
      branch: workspace.branch,
      pinned: workspace.pinned,
      created_at: workspace.created_at,
      updated_at: workspace.updated_at,
      task_id: workspace.task_id,
      container_ref: workspace.container_ref,
      files_changed: summary?.files_changed ?? null,
      lines_added: summary?.lines_added ?? null,
      lines_removed: summary?.lines_removed ?? null,
      latest_process_status: summary?.latest_process_status ?? null,
      latest_process_completed_at: summary?.latest_process_completed_at ?? null,
      has_pending_approval: summary?.has_pending_approval ?? false,
      has_running_dev_server: summary?.has_running_dev_server ?? false,
      has_unseen_turns: summary?.has_unseen_turns ?? false,
      pr_status: summary?.pr_status ?? null,
      repos: storybookRepoBranches[workspace.id] ?? [],
    };
  },
);

const unlinkedWorkspace: DashboardWorkspace = {
  id: 'ws_story_unlinked',
  name: 'Kanban polish',
  branch: 'vk/story-kanban-polish',
  pinned: false,
  created_at: '2026-06-27T09:00:00.000Z',
  updated_at: '2026-06-27T12:15:00.000Z',
  task_id: 'task_kanban_polish',
  container_ref: 'story-kanban-container',
  files_changed: 2,
  lines_added: 37,
  lines_removed: 9,
  latest_process_status: 'completed',
  latest_process_completed_at: '2026-06-27T12:10:00.000Z',
  has_pending_approval: false,
  has_running_dev_server: false,
  has_unseen_turns: false,
  pr_status: 'unknown',
  repos: [
    {
      id: 'repo_kanban',
      name: 'vibe-kanban',
      display_name: 'Vibe Kanban',
      target_branch: 'main',
    },
  ],
};

const populatedWorkspaces = [...dashboardWorkspaces, unlinkedWorkspace];

const meta: Meta<typeof SpacesOverviewView> = {
  title: 'Scenes/SpacesOverview',
  component: SpacesOverviewView,
  decorators: [
    (Story) => (
      <div className="h-[760px] w-full overflow-hidden bg-zinc-900">
        <Story />
      </div>
    ),
  ],
  args: {
    workspace: storybookWorkspace,
    savedSessions: storybookSavedSessions,
    currentSessionId: storybookSavedSessions[0]?.id,
    workspaces: populatedWorkspaces,
    repos: storybookRepos,
    loading: false,
    error: null,
    stoppingDevServerIds: new Set<string>(),
    onResumeSession: (sessionId) => console.info('resume voyage', sessionId),
    onRenameSession: (sessionId, name) =>
      console.info('rename voyage', { sessionId, name }),
    onDeleteSession: (sessionId) => console.info('delete voyage', sessionId),
    onStartNewSession: () => console.info('start new voyage'),
    onNavigateToTabGroup: (spaceId, tabGroupId) =>
      console.info('navigate to craft', { spaceId, tabGroupId }),
    onStopDevServer: async (workspaceId) =>
      console.info('stop dev server', workspaceId),
    onOpenWorkspaceInSpace: async (workspace, spaceId) =>
      console.info('open workspace in space', { workspace, spaceId }),
  },
} satisfies Meta<typeof SpacesOverviewView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {};

export const Loading: Story = {
  args: {
    loading: true,
    workspaces: [],
  },
};

export const BackendError: Story = {
  args: {
    loading: false,
    error: 'Failed to load workspaces',
    workspaces: [],
  },
};

export const Empty: Story = {
  args: {
    workspaces: [],
    repos: [],
  },
};

export const RepoFiltered: Story = {
  args: {
    initialSelectedRepoId: 'repo_kanban',
  },
};

export const RunningDevServer: Story = {
  args: {
    workspaces: populatedWorkspaces.filter(
      (workspace) => workspace.has_running_dev_server,
    ),
  },
};

export const LinkedAndOpenCraftActions: Story = {
  args: {
    workspaces: populatedWorkspaces,
  },
};

export const SpacePickerOpen: Story = {
  args: {
    initialSpacePickerTargetId: unlinkedWorkspace.id,
  },
};

export const SpacePickerMutationError: Story = {
  args: {
    initialSpacePickerTargetId: unlinkedWorkspace.id,
    initialOpenCraftActionError: 'Open Craft failed. Please retry or cancel.',
    onOpenWorkspaceInSpace: async () => {
      throw new Error('Open Craft failed. Please retry or cancel.');
    },
  },
};

export const PendingStopDevServer: Story = {
  args: {
    stoppingDevServerIds: new Set(['ws_story_auth']),
  },
};

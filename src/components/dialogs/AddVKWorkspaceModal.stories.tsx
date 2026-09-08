import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  AddVKWorkspaceModalView,
  type WorkspaceOption,
} from './AddVKWorkspaceModal';
import {
  asyncNoopAction,
  storybookRepoBranches,
  storybookSpaces,
  storybookVKWorkspaces,
  storybookWorkspace,
} from '../../stories/fixtures';

const workspaceOptions: WorkspaceOption[] = storybookVKWorkspaces.map((workspace) => ({
  ...workspace,
  repos: storybookRepoBranches[workspace.id] ?? [],
}));

const unlinkedWorkspace: WorkspaceOption = {
  id: 'ws_story_polish',
  task_id: 'task_polish',
  container_ref: 'story-polish-container',
  branch: 'vk/story-kanban-polish',
  agent_working_dir: '/workspace/kanban-polish',
  created_at: '2026-06-27T09:00:00.000Z',
  updated_at: '2026-06-27T12:15:00.000Z',
  archived: false,
  pinned: false,
  name: 'Kanban polish',
  repos: [
    {
      id: 'repo_kanban',
      name: 'vibe-kanban',
      display_name: 'Vibe Kanban',
      target_branch: 'main',
    },
  ],
};

const allWorkspaceOptions = [...workspaceOptions, unlinkedWorkspace];

const meta: Meta<typeof AddVKWorkspaceModalView> = {
  title: 'Dialogs/AddVKWorkspaceModal',
  component: AddVKWorkspaceModalView,
  decorators: [
    (Story) => (
      <div className="min-h-[720px] bg-zinc-950 p-6 text-neutral-100">
        <Story />
      </div>
    ),
  ],
  args: {
    isOpen: true,
    workspaceOptions: allWorkspaceOptions,
    workspaceState: storybookWorkspace,
    loading: false,
    refreshing: false,
    error: null,
    allowCustomPath: true,
    pendingWorkspaceId: null,
    isActionPending: false,
    actionError: null,
    onClose: () => console.info('close modal'),
    onComplete: () => console.info('complete modal action'),
    onAddWorkspace: async (workspace) => console.info('add workspace', workspace),
    onAddWorkspaceToSpace: async (workspace, spaceId) =>
      console.info('add workspace to space', { workspace, spaceId }),
    onNavigateToWorkspace: async (spaceId, tabGroupId, workspace) =>
      console.info('navigate to workspace', { spaceId, tabGroupId, workspace }),
    onAddWithPath: asyncNoopAction,
  },
} satisfies Meta<typeof AddVKWorkspaceModalView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const PopulatedList: Story = {};

export const Loading: Story = {
  args: {
    workspaceOptions: [],
    loading: true,
  },
};

export const Empty: Story = {
  args: {
    workspaceOptions: [],
  },
};

export const RefreshingResults: Story = {
  args: {
    refreshing: true,
  },
};

export const LoadError: Story = {
  args: {
    workspaceOptions: [],
    error: 'Failed to load workspaces.',
  },
};

export const SearchFiltered: Story = {
  args: {
    initialSearchQuery: 'docs',
  },
};

export const RepoFiltered: Story = {
  args: {
    initialSelectedRepo: 'vibe-kanban',
  },
};

export const AlreadyOpenWorkspace: Story = {
  args: {
    workspaceOptions,
  },
};

export const SpacePicker: Story = {
  args: {
    initialSpacePickerTargetId: unlinkedWorkspace.id,
  },
};

export const CustomPath: Story = {
  args: {
    initialShowPathInput: true,
    initialCustomName: 'Local checkout',
    initialCustomPath: '/workspace/local-checkout',
  },
};

export const PendingAdd: Story = {
  args: {
    pendingWorkspaceId: 'ws_story_polish',
    isActionPending: true,
  },
};

export const ActionError: Story = {
  args: {
    actionError: 'Failed to open craft. Please retry or choose another space.',
  },
};

export const NoSpacesAvailable: Story = {
  args: {
    workspaceState: {
      ...storybookWorkspace,
      spaces: [],
    },
    initialSpacePickerTargetId: unlinkedWorkspace.id,
  },
};

import type { Meta, StoryObj } from '@storybook/react-vite';
import { AddTabModal } from './AddTabModal';
import { AddVKWorkspaceModalView, type WorkspaceOption } from './dialogs/AddVKWorkspaceModal';
import type {
  TabGroupFactoryContribution,
  TabPresetContribution,
} from '../modules/plugins/vibe-dashboard/types';
import {
  storybookRepoBranches,
  storybookVKWorkspaces,
  storybookWorkspace,
} from '../stories/fixtures';

const storybookTabPresets: TabPresetContribution[] = [
  {
    key: 'code-server/editor',
    title: 'Code Server',
    description: 'VS Code editor with custom folder path',
    mode: 'urlPrompt',
    urlTemplate: '{{origin}}/?folder=',
    defaultTitle: 'Code Server',
    order: 20,
  },
  {
    key: 'vibe-dashboard/home',
    title: 'Vibe Dashboard',
    description: 'Open the dashboard home view',
    mode: 'immediate',
    urlTemplate: '{{origin}}/',
    order: 30,
  },
];

const storybookTabGroupFactories: TabGroupFactoryContribution[] = [
  {
    key: 'app-development/open-existing-workspace',
    title: 'Open Existing Workspace',
    description: 'Add workspace with Agent + Code split view',
    launchMode: 'vk-workspace',
    order: 10,
    workspaceComposition: {
      primaryTabKey: 'agent',
      defaultPairTabKeys: ['agent', 'code'],
      tabs: [
        {
          key: 'agent',
          title: 'Agent',
          urlTemplate: '{{origin}}/workspaces/{{workspaceId}}',
        },
        {
          key: 'code',
          title: 'Code',
          urlTemplate: '{{origin}}/?folder={{containerRef}}',
        },
      ],
    },
  },
];

const workspaceOptions: WorkspaceOption[] = storybookVKWorkspaces.map((workspace) => ({
  ...workspace,
  repos: storybookRepoBranches[workspace.id] ?? [],
}));

const meta: Meta<typeof AddTabModal> = {
  title: 'Dialogs/AddTabModal',
  component: AddTabModal,
  decorators: [
    (Story) => (
      <div className="min-h-[720px] bg-zinc-950 p-6 text-neutral-100">
        <Story />
      </div>
    ),
  ],
  args: {
    isOpen: true,
    workspace: storybookWorkspace,
    pendingWorkspaceId: null,
    isActionPending: false,
    actionError: null,
    tabPresets: storybookTabPresets,
    tabGroupFactories: storybookTabGroupFactories,
    onClose: () => console.info('close add tab'),
    onAdd: (title, url) => console.info('add view', { title, url }),
    onAddTabGroup: (label) => console.info('add craft', label),
    onAddVKWorkspace: async (taskAttemptId, name, containerRef) =>
      console.info('add VK workspace', { taskAttemptId, name, containerRef }),
    onAddVKWorkspaceToSpace: async (taskAttemptId, name, containerRef, spaceId) =>
      console.info('add VK workspace to space', {
        taskAttemptId,
        name,
        containerRef,
        spaceId,
      }),
    onNavigateToTabGroup: async (spaceId, tabGroupId, workspace) =>
      console.info('navigate to craft', { spaceId, tabGroupId, workspace }),
    onResetAction: () => console.info('reset add action'),
    renderVKWorkspaceModal: ({
      isOpen,
      onClose,
      onComplete,
      onAdd,
      onAddToSpace,
      onNavigateToTabGroup,
      workspaceState,
      pendingWorkspaceId,
      isActionPending,
      actionError,
    }) => (
      <AddVKWorkspaceModalView
        isOpen={isOpen}
        onClose={onClose}
        onComplete={onComplete}
        workspaceOptions={workspaceOptions}
        workspaceState={workspaceState}
        pendingWorkspaceId={pendingWorkspaceId}
        isActionPending={isActionPending}
        actionError={actionError}
        onAddWorkspace={async (workspace) => {
          await onAdd(
            workspace.id,
            workspace.name || 'Untitled Workspace',
            workspace.container_ref ?? '',
          );
        }}
        onAddWorkspaceToSpace={
          onAddToSpace
            ? async (workspace, spaceId) => {
                await onAddToSpace(
                  workspace.id,
                  workspace.name || 'Untitled Workspace',
                  workspace.container_ref ?? '',
                  spaceId,
                );
              }
            : undefined
        }
        onNavigateToWorkspace={onNavigateToTabGroup}
      />
    ),
  },
} satisfies Meta<typeof AddTabModal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Presets: Story = {};

export const CustomUrl: Story = {
  args: {
    initialView: 'custom',
    initialTitle: 'Preview app',
    initialUrl: 'https://preview.example.test',
  },
};

export const NewCraft: Story = {
  args: {
    initialView: 'tab-group',
    initialTabGroupLabel: 'Feature polish',
  },
};

export const OpenCraft: Story = {
  args: {
    initialView: 'vk-workspace',
  },
};

export const OpenCraftPending: Story = {
  args: {
    initialView: 'vk-workspace',
    pendingWorkspaceId: 'ws_story_auth',
    isActionPending: true,
  },
};

export const OpenCraftError: Story = {
  args: {
    initialView: 'vk-workspace',
    actionError: 'The selected craft could not be opened.',
  },
};

import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  SpacesOverviewView,
  type DashboardWorkspace,
  type SpacesOverviewPresentation,
  type SpacesOverviewViewProps,
} from './SpacesOverview';
import {
  DEFAULT_VD_SKIN_ID,
  lightStudioSkin,
  highContrastTerminalSkin,
  type VDSkinState,
} from '../theme/skins';
import {
  storybookRepos,
  storybookRepoBranches,
  storybookSavedSessions,
  storybookSpaces,
  storybookVKWorkspaces,
  storybookWorkspace,
  storybookWorkspaceSummaries,
} from '../stories/fixtures';
import { DefaultSpacesOverviewLayout } from './spaces-overview/DefaultSpacesOverview.view';
import { denseWorkspaceListSpacesOverviewUI } from './spaces-overview/SpacesOverview.alternates';
import { SpacesOverviewStoryFrame } from './spaces-overview/SpacesOverviewStoryFrame.view';
import {
  createSkinLabStories,
  type SkinLabOption,
} from '../stories/skinLab';

type SpacesOverviewSkinPreset =
  | 'default'
  | 'light-studio'
  | 'high-contrast-terminal';
type SpacesOverviewViewPackPreset = 'default' | 'dense-workspace-list';
type SpacesOverviewDensityPreset = 'desktop' | 'mobile';
type SpacesOverviewStoryArgs = Omit<
  SpacesOverviewViewProps,
  'presentation' | 'skinState'
> & {
  densityPreset: SpacesOverviewDensityPreset;
  skinPreset: SpacesOverviewSkinPreset;
  viewPackPreset: SpacesOverviewViewPackPreset;
};

const densePresentation: SpacesOverviewPresentation = (props) => (
  <DefaultSpacesOverviewLayout
    {...props}
    ui={denseWorkspaceListSpacesOverviewUI}
    viewPackId="dense-workspace-list"
  />
);

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

function createStorySkinState(
  activeGlobalSkinId: VDSkinState['activeGlobalSkinId'],
): VDSkinState {
  return {
    version: 1,
    userSkins: [],
    activeGlobalSkinId,
  };
}

const skinStateByPreset: Record<SpacesOverviewSkinPreset, VDSkinState> = {
  default: createStorySkinState(DEFAULT_VD_SKIN_ID),
  'high-contrast-terminal': createStorySkinState(highContrastTerminalSkin.id),
  'light-studio': createStorySkinState(lightStudioSkin.id),
};

const presentationByPreset: Record<
  SpacesOverviewViewPackPreset,
  SpacesOverviewPresentation | undefined
> = {
  default: undefined,
  'dense-workspace-list': densePresentation,
};

function SpacesOverviewSkinLabStory({
  densityPreset = 'desktop',
  skinPreset = 'default',
  viewPackPreset = 'default',
  ...props
}: SpacesOverviewStoryArgs) {
  return (
    <div
      className={
        densityPreset === 'mobile'
          ? 'mx-auto h-full min-h-[720px] w-[390px] max-w-full overflow-hidden'
          : 'h-full w-full'
      }
      data-storybook-density={densityPreset}
    >
      <SpacesOverviewView
        {...props}
        presentation={presentationByPreset[viewPackPreset]}
        skinState={skinStateByPreset[skinPreset]}
      />
    </div>
  );
}

const baseArgs: SpacesOverviewStoryArgs = {
  workspace: storybookWorkspace,
  savedSessions: storybookSavedSessions,
  currentSessionId: storybookSavedSessions[0]?.id,
  workspaces: populatedWorkspaces,
  repos: storybookRepos,
  loading: false,
  error: null,
  stoppingDevServerIds: new Set<string>(),
  densityPreset: 'desktop',
  skinPreset: 'default',
  viewPackPreset: 'default',
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
};

const meta: Meta<typeof SpacesOverviewSkinLabStory> = {
  title: 'Scenes/SpacesOverview',
  component: SpacesOverviewSkinLabStory,
  decorators: [
    (Story) => (
      <SpacesOverviewStoryFrame>
        <Story />
      </SpacesOverviewStoryFrame>
    ),
  ],
  args: baseArgs,
  argTypes: {
    densityPreset: {
      control: 'select',
      options: ['desktop', 'mobile'],
      description:
        'Storybook SkinLab density control. Mobile also applies a mobile viewport parameter in generated mobile stories.',
    },
    skinPreset: {
      control: 'select',
      options: ['default', 'light-studio', 'high-contrast-terminal'],
      description:
        'Storybook SkinLab global skin control backed by the same SkinRoot runtime as production views.',
    },
    viewPackPreset: {
      control: 'select',
      options: ['default', 'dense-workspace-list'],
      description:
        'Storybook SkinLab view-pack control for swapping presentation without controller edits.',
    },
  },
  parameters: {
    docs: {
      description: {
        component:
          'SkinLab-generated coverage for the migrated SpacesOverview surface. The controls expose state fixtures through story args plus skin, view-pack, and density presets while preserving Design Directions/Spaces Overview as reference explorations.',
      },
    },
  },
} satisfies Meta<typeof SpacesOverviewSkinLabStory>;

export default meta;
type Story = StoryObj<typeof meta>;

const stateOptions: Array<SkinLabOption<SpacesOverviewStoryArgs>> = [
  { id: 'populated', label: 'Populated' },
  {
    id: 'loading',
    label: 'Loading',
    args: {
      loading: true,
      workspaces: [],
    },
  },
  {
    id: 'backend-error',
    label: 'Backend error',
    args: {
      loading: false,
      error: 'Failed to load workspaces',
      workspaces: [],
    },
  },
  {
    id: 'empty',
    label: 'Empty',
    args: {
      workspaces: [],
      repos: [],
    },
  },
  {
    id: 'repo-filtered',
    label: 'Repo filtered',
    args: {
      initialSelectedRepoId: 'repo_kanban',
    },
  },
  {
    id: 'running-dev-server',
    label: 'Running dev server',
    args: {
      workspaces: populatedWorkspaces.filter(
        (workspace) => workspace.has_running_dev_server,
      ),
    },
  },
  {
    id: 'linked-and-open-craft-actions',
    label: 'Linked and Open Craft actions',
    args: {
      workspaces: populatedWorkspaces,
    },
  },
  {
    id: 'space-picker-open',
    label: 'Space picker open',
    args: {
      initialSpacePickerTargetId: unlinkedWorkspace.id,
    },
  },
  {
    id: 'space-picker-mutation-error',
    label: 'Space picker mutation error',
    args: {
      initialSpacePickerTargetId: unlinkedWorkspace.id,
      initialOpenCraftActionError: 'Open Craft failed. Please retry or cancel.',
      onOpenWorkspaceInSpace: async () => {
        throw new Error('Open Craft failed. Please retry or cancel.');
      },
    },
  },
  {
    id: 'pending-stop-dev-server',
    label: 'Pending stop dev server',
    args: {
      stoppingDevServerIds: new Set(['ws_story_auth']),
    },
  },
];

const skinOptions: Array<SkinLabOption<SpacesOverviewStoryArgs>> = [
  { id: 'default', label: 'Default Dark', args: { skinPreset: 'default' } },
  {
    id: 'light-studio',
    label: 'Light Studio',
    args: { skinPreset: 'light-studio' },
  },
  {
    id: 'high-contrast-terminal',
    label: 'High Contrast Terminal',
    args: { skinPreset: 'high-contrast-terminal' },
  },
];

const viewPackOptions: Array<SkinLabOption<SpacesOverviewStoryArgs>> = [
  { id: 'default', label: 'Default', args: { viewPackPreset: 'default' } },
  {
    id: 'dense-workspace-list',
    label: 'Dense workspace list',
    args: { viewPackPreset: 'dense-workspace-list' },
  },
];

const densityOptions: Array<SkinLabOption<SpacesOverviewStoryArgs>> = [
  {
    id: 'desktop',
    label: 'Desktop',
    args: { densityPreset: 'desktop' },
    parameters: { viewport: { defaultViewport: 'responsive' } },
  },
  {
    id: 'mobile',
    label: 'Mobile',
    args: { densityPreset: 'mobile' },
    parameters: { viewport: { defaultViewport: 'mobile1' } },
  },
];

const skinLabStories = createSkinLabStories<SpacesOverviewStoryArgs>({
  baseArgs,
  densities: densityOptions,
  legacyReferenceStories: ['Design Directions/Spaces Overview'],
  skins: skinOptions,
  states: stateOptions,
  stories: [
    {
      density: 'desktop',
      id: 'populated',
      label: 'Populated',
      skin: 'default',
      state: 'populated',
      viewPack: 'default',
    },
    {
      density: 'desktop',
      id: 'light-studio-skin',
      label: 'Light Studio skin',
      description:
        'Proof that a built-in alternate global skin materially changes SpacesOverview through CSS variables only.',
      skin: 'light-studio',
      state: 'populated',
      viewPack: 'default',
    },
    {
      density: 'desktop',
      id: 'dense-workspace-list-view-pack',
      label: 'Dense workspace list view pack',
      description:
        'Proof that the WorkspaceListSection can be swapped as a view-pack slice while keeping controller behavior unchanged.',
      skin: 'default',
      state: 'populated',
      viewPack: 'dense-workspace-list',
    },
    {
      density: 'desktop',
      id: 'high-contrast-dense-view-pack',
      label: 'High contrast dense view pack',
      description:
        'Proof that skin selection and view-pack selection compose independently.',
      skin: 'high-contrast-terminal',
      state: 'populated',
      viewPack: 'dense-workspace-list',
    },
    {
      density: 'mobile',
      id: 'mobile-light-studio',
      label: 'Mobile light studio',
      description:
        'Proof that the same migrated surface can be previewed with a mobile density frame and alternate skin.',
      skin: 'light-studio',
      state: 'populated',
      viewPack: 'default',
    },
    {
      density: 'desktop',
      id: 'loading',
      label: 'Loading',
      skin: 'default',
      state: 'loading',
      viewPack: 'default',
    },
    {
      density: 'desktop',
      id: 'backend-error',
      label: 'Backend error',
      skin: 'default',
      state: 'backend-error',
      viewPack: 'default',
    },
    {
      density: 'desktop',
      id: 'empty',
      label: 'Empty',
      skin: 'default',
      state: 'empty',
      viewPack: 'default',
    },
    {
      density: 'desktop',
      id: 'repo-filtered',
      label: 'Repo filtered',
      skin: 'default',
      state: 'repo-filtered',
      viewPack: 'default',
    },
    {
      density: 'desktop',
      id: 'running-dev-server',
      label: 'Running dev server',
      skin: 'default',
      state: 'running-dev-server',
      viewPack: 'default',
    },
    {
      density: 'desktop',
      id: 'linked-and-open-craft-actions',
      label: 'Linked and Open Craft actions',
      skin: 'default',
      state: 'linked-and-open-craft-actions',
      viewPack: 'default',
    },
    {
      density: 'desktop',
      id: 'space-picker-open',
      label: 'Space picker open',
      skin: 'default',
      state: 'space-picker-open',
      viewPack: 'default',
    },
    {
      density: 'desktop',
      id: 'space-picker-mutation-error',
      label: 'Space picker mutation error',
      skin: 'default',
      state: 'space-picker-mutation-error',
      viewPack: 'default',
    },
    {
      density: 'desktop',
      id: 'pending-stop-dev-server',
      label: 'Pending stop dev server',
      skin: 'default',
      state: 'pending-stop-dev-server',
      viewPack: 'default',
    },
  ],
  surfaceId: 'spaces-overview',
  viewPacks: viewPackOptions,
});

export const Populated: Story = skinLabStories.Populated as Story;

export const LightStudioSkin: Story = skinLabStories.LightStudioSkin as Story;

export const DenseWorkspaceListViewPack: Story =
  skinLabStories.DenseWorkspaceListViewPack as Story;

export const HighContrastDenseViewPack: Story =
  skinLabStories.HighContrastDenseViewPack as Story;

export const MobileLightStudio: Story = skinLabStories.MobileLightStudio as Story;

export const Loading: Story = skinLabStories.Loading as Story;

export const BackendError: Story = skinLabStories.BackendError as Story;

export const Empty: Story = skinLabStories.Empty as Story;

export const RepoFiltered: Story = {
  ...(skinLabStories.RepoFiltered as Story),
};

export const RunningDevServer: Story = {
  ...(skinLabStories.RunningDevServer as Story),
};

export const LinkedAndOpenCraftActions: Story = {
  ...(skinLabStories.LinkedAndOpenCraftActions as Story),
};

export const SpacePickerOpen: Story = {
  ...(skinLabStories.SpacePickerOpen as Story),
};

export const SpacePickerMutationError: Story = {
  ...(skinLabStories.SpacePickerMutationError as Story),
};

export const PendingStopDevServer: Story = {
  ...(skinLabStories.PendingStopDevServer as Story),
};

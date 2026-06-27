import type {
  SavedWorkspaceSession,
  Space,
  TabGroup,
  VoyageEntry,
  WorkspaceState,
} from '../types';
import type { Repo, RepoWithBranch, Workspace, WorkspaceSummary } from '../lib/vk-client';

export const storybookSpaces = {
  home: {
    id: 'space_home',
    name: 'Home',
    icon: 'home',
    tabGroupIds: ['tg_home'],
    isSystem: true,
  },
  product: {
    id: 'space_product',
    name: 'Product',
    icon: 'default',
    tabGroupIds: ['tg_agent', 'tg_docs'],
  },
  design: {
    id: 'space_design',
    name: 'Design',
    icon: 'preview',
    tabGroupIds: ['tg_design'],
  },
} satisfies Record<string, Space>;

export const storybookTabGroups = {
  home: {
    id: 'tg_home',
    label: 'Overview',
    tabs: [
      {
        id: 'tab_overview',
        title: 'Spaces',
        url: 'internal://spaces-overview',
        pinned: true,
      },
    ],
    pairs: [],
    order: 0,
    createdAt: '2026-06-27T12:00:00.000Z',
    lastVisitedAt: '2026-06-27T13:05:00.000Z',
  },
  agent: {
    id: 'tg_agent',
    label: 'Auth bug fix',
    mobileLabel: 'Auth',
    mobileEmoji: '🛠️',
    tabs: [
      {
        id: 'tab_agent',
        title: 'Agent',
        url: '/workspaces/ws_story_auth',
        pinned: true,
      },
      {
        id: 'tab_code',
        title: 'Code',
        url: '/?folder=/workspace/auth-bug-fix',
      },
      {
        id: 'tab_preview',
        title: 'Preview',
        url: 'https://preview.example.test/auth',
      },
    ],
    pairs: [
      {
        id: 'pair_agent_code',
        tabIds: ['tab_agent', 'tab_code'],
        ratios: [55, 45],
      },
    ],
    order: 1,
    createdAt: '2026-06-26T19:30:00.000Z',
    lastVisitedAt: '2026-06-27T13:30:00.000Z',
    starred: true,
  },
  docs: {
    id: 'tg_docs',
    label: 'Docs refresh',
    mobileLabel: 'Docs',
    mobileEmoji: '📚',
    tabs: [
      {
        id: 'tab_docs_agent',
        title: 'Agent',
        url: '/workspaces/ws_story_docs',
        pinned: true,
      },
      {
        id: 'tab_docs',
        title: 'Docs site',
        url: 'https://docs.example.test',
      },
    ],
    pairs: [],
    order: 2,
    createdAt: '2026-06-25T17:15:00.000Z',
    lastVisitedAt: '2026-06-27T11:45:00.000Z',
  },
  design: {
    id: 'tg_design',
    label: 'Launch design',
    mobileLabel: 'Design',
    mobileEmoji: '🎨',
    tabs: [
      {
        id: 'tab_figma',
        title: 'Figma',
        url: 'https://figma.example.test/file/storybook',
      },
      {
        id: 'tab_notes',
        title: 'Notes',
        url: 'https://notes.example.test/launch',
      },
    ],
    pairs: [],
    order: 3,
    createdAt: '2026-06-24T15:00:00.000Z',
    lastVisitedAt: '2026-06-26T20:00:00.000Z',
  },
} satisfies Record<string, TabGroup>;

export const storybookWorkspace: WorkspaceState = {
  spaces: [storybookSpaces.home, storybookSpaces.product, storybookSpaces.design],
  tabGroups: [
    storybookTabGroups.home,
    storybookTabGroups.agent,
    storybookTabGroups.docs,
    storybookTabGroups.design,
  ],
  nextId: 100,
};

export const storybookVoyageEntries: VoyageEntry[] = [
  {
    id: 'voyage_entry_agent',
    tabGroupId: storybookTabGroups.agent.id,
    viewIds: ['tab_agent', 'tab_code'],
  },
  {
    id: 'voyage_entry_docs',
    tabGroupId: storybookTabGroups.docs.id,
    viewIds: ['tab_docs_agent'],
  },
];

export const storybookSavedSessions: SavedWorkspaceSession[] = [
  {
    id: 'voyage_current',
    slug: 'current-launch',
    name: 'Current launch',
    createdAt: '2026-06-27T12:00:00.000Z',
    updatedAt: '2026-06-27T13:30:00.000Z',
    activeVoyageEntryId: 'voyage_entry_agent',
    voyageEntries: storybookVoyageEntries,
    activeSpaceId: storybookSpaces.product.id,
    activeTabGroupId: storybookTabGroups.agent.id,
    activeItemsByVoyageEntryId: {
      voyage_entry_agent: 'pair_agent_code',
      voyage_entry_docs: 'tab_docs_agent',
    },
    visitedTabGroupIds: [storybookTabGroups.agent.id, storybookTabGroups.docs.id],
  },
  {
    id: 'voyage_design_review',
    slug: 'design-review',
    name: 'Design review',
    createdAt: '2026-06-26T10:00:00.000Z',
    updatedAt: '2026-06-26T20:00:00.000Z',
    activeVoyageEntryId: 'voyage_entry_design',
    voyageEntries: [
      {
        id: 'voyage_entry_design',
        tabGroupId: storybookTabGroups.design.id,
        viewIds: ['tab_figma'],
      },
    ],
    activeSpaceId: storybookSpaces.design.id,
    activeTabGroupId: storybookTabGroups.design.id,
    activeItemsByVoyageEntryId: {
      voyage_entry_design: 'tab_figma',
    },
    visitedTabGroupIds: [storybookTabGroups.design.id],
  },
];

export const storybookRepos: Repo[] = [
  { id: 'repo_dashboard', name: 'vibe-dashboard', display_name: 'Vibe Dashboard' },
  { id: 'repo_kanban', name: 'vibe-kanban', display_name: 'Vibe Kanban' },
];

export const storybookRepoBranches: Record<string, RepoWithBranch[]> = {
  ws_story_auth: [
    {
      id: 'repo_dashboard',
      name: 'vibe-dashboard',
      display_name: 'Vibe Dashboard',
      target_branch: 'main',
    },
  ],
  ws_story_docs: [
    {
      id: 'repo_dashboard',
      name: 'vibe-dashboard',
      display_name: 'Vibe Dashboard',
      target_branch: 'docs',
    },
  ],
};

export const storybookVKWorkspaces: Workspace[] = [
  {
    id: 'ws_story_auth',
    task_id: 'task_auth',
    container_ref: 'story-auth-container',
    branch: 'vk/story-auth-bug',
    agent_working_dir: '/workspace/auth-bug-fix',
    created_at: '2026-06-26T19:30:00.000Z',
    updated_at: '2026-06-27T13:30:00.000Z',
    archived: false,
    pinned: true,
    name: 'Auth bug fix',
  },
  {
    id: 'ws_story_docs',
    task_id: 'task_docs',
    container_ref: 'story-docs-container',
    branch: 'vk/story-docs-refresh',
    agent_working_dir: '/workspace/docs-refresh',
    created_at: '2026-06-25T17:15:00.000Z',
    updated_at: '2026-06-27T11:45:00.000Z',
    archived: false,
    pinned: false,
    name: 'Docs refresh',
  },
];

export const storybookWorkspaceSummaries: WorkspaceSummary[] = [
  {
    workspace_id: 'ws_story_auth',
    has_pending_approval: true,
    files_changed: 7,
    lines_added: 210,
    lines_removed: 42,
    latest_process_completed_at: '2026-06-27T13:25:00.000Z',
    latest_process_status: 'running',
    has_running_dev_server: true,
    has_unseen_turns: true,
    pr_status: 'open',
  },
  {
    workspace_id: 'ws_story_docs',
    has_pending_approval: false,
    files_changed: 3,
    lines_added: 64,
    lines_removed: 18,
    latest_process_completed_at: '2026-06-27T11:40:00.000Z',
    latest_process_status: 'completed',
    has_running_dev_server: false,
    has_unseen_turns: false,
    pr_status: 'unknown',
  },
];

export const noopAction = () => undefined;
export const asyncNoopAction = async () => undefined;

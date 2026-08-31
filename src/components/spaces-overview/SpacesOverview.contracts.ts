import type { ComponentType } from "react";
import type {
  SavedWorkspaceSession,
  TabGroup,
  WorkspaceState,
} from "../../types";
import type { Repo, RepoWithBranch } from "../../lib/vk-client";

export type SpacesOverviewRepo = Repo;
export type SpacesOverviewWorkspaceState = WorkspaceState;
export type SpacesOverviewTabGroup = TabGroup;

export interface DashboardWorkspace {
  id: string;
  name: string;
  branch: string;
  pinned: boolean;
  created_at: string;
  updated_at: string;
  task_id: string;
  container_ref: string | null;
  files_changed: number | null;
  lines_added: number | null;
  lines_removed: number | null;
  latest_process_status: "running" | "completed" | "failed" | "killed" | null;
  latest_process_completed_at: string | null;
  has_pending_approval: boolean;
  has_running_dev_server: boolean;
  has_unseen_turns: boolean;
  pr_status: "open" | "merged" | "closed" | "unknown" | null;
  repos: RepoWithBranch[];
}

export interface SpacesOverviewProps {
  workspace: WorkspaceState;
  savedSessions: SavedWorkspaceSession[];
  currentSessionId?: string;
  onResumeSession: (sessionId: string) => void;
  onRenameSession: (sessionId: string, name: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onStartNewSession: () => void;
  onNavigateToTabGroup: (spaceId: string, tabGroupId: string) => void;
  onOpenVKWorkspace?: (
    workspaceId: string,
    name: string,
    containerRef: string,
    spaceId: string,
  ) => void | Promise<void>;
}

export interface SpacesOverviewViewProps extends SpacesOverviewProps {
  workspaces: DashboardWorkspace[];
  repos: Repo[];
  loading: boolean;
  error: string | null;
  stoppingDevServerIds?: Set<string>;
  onStopDevServer?: (workspaceId: string) => void | Promise<void>;
  onOpenWorkspaceInSpace?: (
    workspace: DashboardWorkspace,
    spaceId: string,
  ) => void | Promise<void>;
  initialSelectedRepoId?: string | null;
  initialSpacePickerTargetId?: string | null;
  initialOpenCraftActionError?: string | null;
  presentation?: SpacesOverviewPresentation;
}

export type TabGroupWithSpace = {
  space: { id: string; name: string };
  tg: TabGroup;
};

export interface SpacesOverviewViewModel {
  workspace: WorkspaceState;
  savedSessions: SavedWorkspaceSession[];
  currentSessionId?: string;
  workspaces: DashboardWorkspace[];
  effectiveRepos: SpacesOverviewRepo[];
  loading: boolean;
  error: string | null;
  selectedRepoId: string | null;
  sortedWorkspaces: DashboardWorkspace[];
  pagedWorkspaces: DashboardWorkspace[];
  workspacePage: number;
  workspaceTotalPages: number;
  stoppingDevServerIds: Set<string>;
  tabGroupDisplayLabelById: Map<string, string>;
  workspaceTabGroupMap: Map<
    string,
    { spaceId: string; tabGroupId: string; label: string }
  >;
  hasSpaces: boolean;
  sortedSessions: SavedWorkspaceSession[];
  expandedSessionId: string | null;
  editingSessionId: string | null;
  sessionNameDraft: string;
  starredTabGroups: TabGroupWithSpace[];
  recentlyVisited: {
    items: TabGroupWithSpace[];
    page: number;
    totalPages: number;
  };
  recentlyCreated: {
    items: TabGroupWithSpace[];
    page: number;
    totalPages: number;
  };
  spacesWithTabGroups: Array<{
    space: SpacesOverviewWorkspaceState["spaces"][number];
    tabGroups: SpacesOverviewTabGroup[];
  }>;
  spacePickerTarget: DashboardWorkspace | null;
  pendingOpenCraftRequest: {
    workspace: DashboardWorkspace;
    spaceId: string;
  } | null;
  openCraftRetryRequest: {
    workspace: DashboardWorkspace;
    spaceId: string;
  } | null;
  openCraftActionError: string | null;
  isOpenCraftPending: boolean;
  canOpenWorkspaceInSpace: boolean;
}

export interface SpacesOverviewViewActions {
  resumeSession(sessionId: string): void;
  renameSession(sessionId: string, name: string): void;
  deleteSession(sessionId: string): void;
  startNewSession(): void;
  navigateToTabGroup(spaceId: string, tabGroupId: string): void;
  selectRepo(repoId: string | null): void;
  setWorkspacePage(page: number): void;
  stopDevServer(workspaceId: string): void;
  openSpacePickerForWorkspace(workspace: DashboardWorkspace): void;
  runOpenCraftRequest(request: {
    workspace: DashboardWorkspace;
    spaceId: string;
  }): void;
  closeSpacePicker(): void;
  retryOpenCraftRequest(): void;
  toggleExpandedSession(sessionId: string): void;
  startRenameSession(sessionId: string, name: string): void;
  setSessionNameDraft(name: string): void;
  submitRenameSession(sessionId: string): void;
  cancelRenameSession(): void;
  setRecentlyVisitedPage(page: number): void;
  setRecentlyCreatedPage(page: number): void;
}

export interface SpacesOverviewComponentProps {
  model: SpacesOverviewViewModel;
  actions: SpacesOverviewViewActions;
}

export interface SpacesOverviewUIPack {
  PageHeader: ComponentType<SpacesOverviewComponentProps>;
  RecentSessionsSection: ComponentType<SpacesOverviewComponentProps>;
  StarredCraftSection: ComponentType<SpacesOverviewComponentProps>;
  RunningDevServersSection: ComponentType<SpacesOverviewComponentProps>;
  RecentlyVisitedCraftSection: ComponentType<SpacesOverviewComponentProps>;
  RecentlyCreatedCraftSection: ComponentType<SpacesOverviewComponentProps>;
  WorkspaceListSection: ComponentType<SpacesOverviewComponentProps>;
  SpacesSection: ComponentType<SpacesOverviewComponentProps>;
  SpacePickerModal: ComponentType<SpacesOverviewComponentProps>;
}

export type SpacesOverviewPresentation =
  ComponentType<SpacesOverviewComponentProps>;

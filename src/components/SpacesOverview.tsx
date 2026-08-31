import { useCallback, useEffect, useMemo, useState } from "react";
import type { ComponentType } from "react";
import type {
  WorkspaceState,
  TabGroup,
  SavedWorkspaceSession,
} from "../types";
import {
  vkClient,
  type WorkspaceSummary,
  type Repo,
  type RepoWithBranch,
} from "../lib/vk-client";
import { selectedSpacesOverviewView } from "./SpacesOverview.selected";

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
  effectiveRepos: Repo[];
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
    space: WorkspaceState["spaces"][number];
    tabGroups: TabGroup[];
  }>;
  spacePickerTarget: DashboardWorkspace | null;
  pendingOpenCraftRequest: { workspace: DashboardWorkspace; spaceId: string } | null;
  openCraftRetryRequest: { workspace: DashboardWorkspace; spaceId: string } | null;
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

export type SpacesOverviewPresentation = ComponentType<{
  model: SpacesOverviewViewModel;
  actions: SpacesOverviewViewActions;
}>;

const PAGE_SIZE = 20;
const TAB_GROUP_PAGE_SIZE = 10;

function sortDashboardWorkspaces(workspaces: DashboardWorkspace[]) {
  return [...workspaces].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    const aTime = new Date(
      a.latest_process_completed_at || a.updated_at,
    ).getTime();
    const bTime = new Date(
      b.latest_process_completed_at || b.updated_at,
    ).getTime();
    return bTime - aTime;
  });
}

function getTabGroupWorkspaceId(tabGroup: TabGroup): string | null {
  for (const tab of tabGroup.tabs) {
    const match = tab.url.match(/\/workspaces\/([^/?#]+)/);
    if (match?.[1]) return decodeURIComponent(match[1]);
  }
  return null;
}

function getTabGroupDisplayLabel(
  tabGroup: TabGroup,
  workspaceNameById: Map<string, string>,
): string {
  const workspaceId = getTabGroupWorkspaceId(tabGroup);
  const workspaceName = workspaceId
    ? workspaceNameById.get(workspaceId)
    : undefined;
  return tabGroup.label.includes("...") && workspaceName
    ? workspaceName
    : tabGroup.label;
}

function getNonSystemTabGroups(workspace: WorkspaceState): TabGroupWithSpace[] {
  const seen = new Set<string>();
  const items: TabGroupWithSpace[] = [];
  for (const space of workspace.spaces) {
    if (space.isSystem) continue;
    for (const tgId of space.tabGroupIds) {
      if (seen.has(tgId)) continue;
      seen.add(tgId);
      const tg = workspace.tabGroups.find((group) => group.id === tgId);
      if (tg) items.push({ space, tg });
    }
  }
  return items;
}

function useVKDashboardData() {
  const [workspaces, setWorkspaces] = useState<DashboardWorkspace[]>([]);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    setError(null);

    try {
      const [allWorkspaces, summaryResult, reposResult] =
        await Promise.allSettled([
          vkClient.getWorkspaces(),
          vkClient.getWorkspaceSummaries(false),
          vkClient.getRepos(),
        ]);

      if (allWorkspaces.status === "rejected") {
        throw new Error("Failed to load workspaces");
      }

      const activeWorkspaces = allWorkspaces.value.filter((w) => !w.archived);
      const summaryMap = new Map<string, WorkspaceSummary>();
      if (summaryResult.status === "fulfilled") {
        for (const summary of summaryResult.value.summaries) {
          summaryMap.set(summary.workspace_id, summary);
        }
      }

      const allRepos =
        reposResult.status === "fulfilled" ? reposResult.value : [];
      const repoResults = await Promise.allSettled(
        activeWorkspaces.map((ws) =>
          vkClient
            .getWorkspaceRepos(ws.id)
            .then((repos) => ({ wsId: ws.id, repos })),
        ),
      );

      const wsRepoMap = new Map<string, RepoWithBranch[]>();
      for (const result of repoResults) {
        if (result.status === "fulfilled") {
          wsRepoMap.set(result.value.wsId, result.value.repos);
        }
      }

      setWorkspaces(
        activeWorkspaces.map((ws) => {
          const summary = summaryMap.get(ws.id);
          return {
            id: ws.id,
            name: ws.name || ws.branch,
            branch: ws.branch,
            pinned: ws.pinned,
            created_at: ws.created_at,
            updated_at: ws.updated_at,
            task_id: ws.task_id,
            container_ref: ws.container_ref,
            files_changed: summary?.files_changed ?? null,
            lines_added: summary?.lines_added ?? null,
            lines_removed: summary?.lines_removed ?? null,
            latest_process_status: summary?.latest_process_status ?? null,
            latest_process_completed_at:
              summary?.latest_process_completed_at ?? null,
            has_pending_approval: summary?.has_pending_approval ?? false,
            has_running_dev_server: summary?.has_running_dev_server ?? false,
            has_unseen_turns: summary?.has_unseen_turns ?? false,
            pr_status: summary?.pr_status ?? null,
            repos: wsRepoMap.get(ws.id) ?? [],
          };
        }),
      );
      setRepos(allRepos);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(() => fetchData(true), 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  return { workspaces, repos, loading, error, refetch: fetchData };
}

export function SpacesOverview(props: SpacesOverviewProps) {
  const { workspaces, repos, loading, error, refetch } = useVKDashboardData();
  const [stoppingDevServerIds, setStoppingDevServerIds] = useState<Set<string>>(
    new Set(),
  );

  const handleStopDevServer = useCallback(
    async (workspaceId: string) => {
      if (stoppingDevServerIds.has(workspaceId)) return;
      setStoppingDevServerIds((prev) => new Set(prev).add(workspaceId));

      let clearDelayMs = 5000;
      try {
        await vkClient.stopWorkspaceExecution(workspaceId);
        setTimeout(() => refetch(true), 1000);
      } catch (err) {
        clearDelayMs = 0;
        console.error("Failed to stop dev server:", err);
      } finally {
        setTimeout(() => {
          setStoppingDevServerIds((prev) => {
            const next = new Set(prev);
            next.delete(workspaceId);
            return next;
          });
        }, clearDelayMs);
      }
    },
    [refetch, stoppingDevServerIds],
  );

  return (
    <SpacesOverviewView
      {...props}
      workspaces={workspaces}
      repos={repos}
      loading={loading}
      error={error}
      stoppingDevServerIds={stoppingDevServerIds}
      onStopDevServer={handleStopDevServer}
      {...(props.onOpenVKWorkspace
        ? {
            onOpenWorkspaceInSpace: (
              targetWorkspace: DashboardWorkspace,
              spaceId: string,
            ) =>
              props.onOpenVKWorkspace?.(
                targetWorkspace.id,
                targetWorkspace.name,
                targetWorkspace.container_ref || "",
                spaceId,
              ),
          }
        : {})}
    />
  );
}

export function SpacesOverviewView({
  workspace,
  savedSessions,
  currentSessionId,
  onResumeSession,
  onRenameSession,
  onDeleteSession,
  onStartNewSession,
  onNavigateToTabGroup,
  workspaces,
  repos,
  loading,
  error,
  stoppingDevServerIds: externalStoppingDevServerIds,
  onStopDevServer,
  onOpenWorkspaceInSpace,
  initialSelectedRepoId = null,
  initialSpacePickerTargetId = null,
  initialOpenCraftActionError = null,
  presentation: Presentation = selectedSpacesOverviewView,
}: SpacesOverviewViewProps) {
  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(
    initialSelectedRepoId,
  );
  const [workspacePage, setWorkspacePage] = useState(0);
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(
    null,
  );
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [sessionNameDraft, setSessionNameDraft] = useState("");
  const [recentlyVisitedPage, setRecentlyVisitedPage] = useState(0);
  const [recentlyCreatedPage, setRecentlyCreatedPage] = useState(0);
  const initialSpacePickerTarget = useMemo(() => {
    if (!initialSpacePickerTargetId) return null;
    return (
      workspaces.find(
        (candidate) => candidate.id === initialSpacePickerTargetId,
      ) ?? null
    );
  }, [initialSpacePickerTargetId, workspaces]);
  const [spacePickerTarget, setSpacePickerTarget] =
    useState<DashboardWorkspace | null>(initialSpacePickerTarget);
  const [pendingOpenCraftRequest, setPendingOpenCraftRequest] =
    useState<{ workspace: DashboardWorkspace; spaceId: string } | null>(null);
  const [openCraftRetryRequest, setOpenCraftRetryRequest] =
    useState<{ workspace: DashboardWorkspace; spaceId: string } | null>(null);
  const [openCraftActionError, setOpenCraftActionError] = useState<
    string | null
  >(initialOpenCraftActionError);
  const stoppingDevServerIds = externalStoppingDevServerIds ?? new Set<string>();

  useEffect(() => {
    setSpacePickerTarget(initialSpacePickerTarget);
  }, [initialSpacePickerTarget]);

  useEffect(() => {
    setOpenCraftActionError(initialOpenCraftActionError);
  }, [initialOpenCraftActionError]);

  useEffect(() => {
    setSelectedRepoId(initialSelectedRepoId);
  }, [initialSelectedRepoId]);

  useEffect(() => {
    setWorkspacePage(0);
  }, [selectedRepoId]);

  const runOpenCraftRequest = useCallback(
    async (request: { workspace: DashboardWorkspace; spaceId: string }) => {
      if (!onOpenWorkspaceInSpace) {
        setOpenCraftActionError("Open Craft is unavailable.");
        return;
      }

      setPendingOpenCraftRequest(request);
      setOpenCraftRetryRequest(request);
      setOpenCraftActionError(null);
      try {
        await onOpenWorkspaceInSpace(request.workspace, request.spaceId);
        setSpacePickerTarget(null);
        setOpenCraftRetryRequest(null);
      } catch (err) {
        setOpenCraftActionError(getDashboardOpenCraftErrorMessage(err));
      } finally {
        setPendingOpenCraftRequest(null);
      }
    },
    [onOpenWorkspaceInSpace],
  );

  const model = useMemo<SpacesOverviewViewModel>(() => {
    const workspaceNameById = new Map<string, string>();
    for (const item of workspaces) {
      workspaceNameById.set(item.id, item.name || item.branch);
    }

    const tabGroupDisplayLabelById = new Map<string, string>();
    for (const tabGroup of workspace.tabGroups) {
      tabGroupDisplayLabelById.set(
        tabGroup.id,
        getTabGroupDisplayLabel(tabGroup, workspaceNameById),
      );
    }

    const effectiveRepos =
      repos.length > 0
        ? repos
        : Array.from(
            workspaces
              .flatMap((ws) => ws.repos)
              .reduce((seen, repo) => {
                if (!seen.has(repo.id)) {
                  seen.set(repo.id, {
                    id: repo.id,
                    name: repo.name,
                    display_name: repo.display_name,
                  });
                }
                return seen;
              }, new Map<string, Repo>())
              .values(),
          );

    const sortedWorkspaces = sortDashboardWorkspaces(
      selectedRepoId
        ? workspaces.filter((ws) =>
            ws.repos.some((repo) => repo.id === selectedRepoId),
          )
        : workspaces,
    );
    const workspaceTotalPages = Math.ceil(sortedWorkspaces.length / PAGE_SIZE);
    const pagedWorkspaces = sortedWorkspaces.slice(
      workspacePage * PAGE_SIZE,
      (workspacePage + 1) * PAGE_SIZE,
    );

    const workspaceTabGroupMap = new Map<
      string,
      { spaceId: string; tabGroupId: string; label: string }
    >();
    for (const space of workspace.spaces) {
      const tabGroups = workspace.tabGroups.filter((tabGroup) =>
        space.tabGroupIds.includes(tabGroup.id),
      );
      for (const tabGroup of tabGroups) {
        for (const tab of tabGroup.tabs) {
          const match = tab.url.match(/\/workspaces\/([^/?#]+)/);
          if (match?.[1]) {
            workspaceTabGroupMap.set(match[1], {
              spaceId: space.id,
              tabGroupId: tabGroup.id,
              label: tabGroup.label,
            });
          }
        }
      }
    }

    const allTabGroups = getNonSystemTabGroups(workspace);
    const recentlyVisitedItems = allTabGroups
      .filter(({ tg }) => tg.lastVisitedAt)
      .sort(
        (left, right) =>
          new Date(right.tg.lastVisitedAt!).getTime() -
          new Date(left.tg.lastVisitedAt!).getTime(),
      );
    const recentlyCreatedItems = allTabGroups
      .filter(({ tg }) => tg.createdAt)
      .sort(
        (left, right) =>
          new Date(right.tg.createdAt!).getTime() -
          new Date(left.tg.createdAt!).getTime(),
      );

    return {
      workspace,
      savedSessions,
      currentSessionId,
      workspaces,
      effectiveRepos,
      loading,
      error,
      selectedRepoId,
      sortedWorkspaces,
      pagedWorkspaces,
      workspacePage,
      workspaceTotalPages,
      stoppingDevServerIds,
      tabGroupDisplayLabelById,
      workspaceTabGroupMap,
      hasSpaces: workspace.spaces.some((space) => !space.isSystem),
      sortedSessions: [...savedSessions].sort(
        (left, right) =>
          Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
      ),
      expandedSessionId,
      editingSessionId,
      sessionNameDraft,
      starredTabGroups: allTabGroups.filter(({ tg }) => tg.starred),
      recentlyVisited: {
        items: recentlyVisitedItems.slice(
          recentlyVisitedPage * TAB_GROUP_PAGE_SIZE,
          (recentlyVisitedPage + 1) * TAB_GROUP_PAGE_SIZE,
        ),
        page: recentlyVisitedPage,
        totalPages: Math.ceil(recentlyVisitedItems.length / TAB_GROUP_PAGE_SIZE),
      },
      recentlyCreated: {
        items: recentlyCreatedItems.slice(
          recentlyCreatedPage * TAB_GROUP_PAGE_SIZE,
          (recentlyCreatedPage + 1) * TAB_GROUP_PAGE_SIZE,
        ),
        page: recentlyCreatedPage,
        totalPages: Math.ceil(recentlyCreatedItems.length / TAB_GROUP_PAGE_SIZE),
      },
      spacesWithTabGroups: workspace.spaces
        .filter((space) => !space.isSystem)
        .map((space) => ({
          space,
          tabGroups: workspace.tabGroups
            .filter((tabGroup) => space.tabGroupIds.includes(tabGroup.id))
            .sort((left, right) => left.order - right.order),
        })),
      spacePickerTarget,
      pendingOpenCraftRequest,
      openCraftRetryRequest,
      openCraftActionError,
      isOpenCraftPending: pendingOpenCraftRequest != null,
      canOpenWorkspaceInSpace: Boolean(onOpenWorkspaceInSpace),
    };
  }, [
    currentSessionId,
    editingSessionId,
    error,
    expandedSessionId,
    loading,
    onOpenWorkspaceInSpace,
    openCraftActionError,
    openCraftRetryRequest,
    pendingOpenCraftRequest,
    recentlyCreatedPage,
    recentlyVisitedPage,
    repos,
    savedSessions,
    selectedRepoId,
    sessionNameDraft,
    spacePickerTarget,
    stoppingDevServerIds,
    workspace,
    workspacePage,
    workspaces,
  ]);

  const actions = useMemo<SpacesOverviewViewActions>(
    () => ({
      resumeSession: onResumeSession,
      renameSession: onRenameSession,
      deleteSession: onDeleteSession,
      startNewSession: onStartNewSession,
      navigateToTabGroup: onNavigateToTabGroup,
      selectRepo: setSelectedRepoId,
      setWorkspacePage,
      stopDevServer: (workspaceId) => {
        void onStopDevServer?.(workspaceId);
      },
      openSpacePickerForWorkspace: (targetWorkspace) => {
        setOpenCraftActionError(null);
        setOpenCraftRetryRequest(null);
        setSpacePickerTarget(targetWorkspace);
      },
      runOpenCraftRequest: (request) => {
        void runOpenCraftRequest(request);
      },
      closeSpacePicker: () => {
        if (pendingOpenCraftRequest) return;
        setSpacePickerTarget(null);
        setOpenCraftActionError(null);
        setOpenCraftRetryRequest(null);
      },
      retryOpenCraftRequest: () => {
        if (openCraftRetryRequest) {
          void runOpenCraftRequest(openCraftRetryRequest);
        }
      },
      toggleExpandedSession: (sessionId) => {
        setExpandedSessionId((previous) =>
          previous === sessionId ? null : sessionId,
        );
      },
      startRenameSession: (sessionId, name) => {
        setEditingSessionId(sessionId);
        setSessionNameDraft(name);
      },
      setSessionNameDraft,
      submitRenameSession: (sessionId) => {
        if (sessionNameDraft.trim()) {
          onRenameSession(sessionId, sessionNameDraft.trim());
        }
        setEditingSessionId(null);
        setSessionNameDraft("");
      },
      cancelRenameSession: () => {
        setEditingSessionId(null);
        setSessionNameDraft("");
      },
      setRecentlyVisitedPage,
      setRecentlyCreatedPage,
    }),
    [
      onDeleteSession,
      onNavigateToTabGroup,
      onRenameSession,
      onResumeSession,
      onStartNewSession,
      onStopDevServer,
      openCraftRetryRequest,
      pendingOpenCraftRequest,
      runOpenCraftRequest,
      sessionNameDraft,
    ],
  );

  return <Presentation model={model} actions={actions} />;
}

function getDashboardOpenCraftErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return "Open Craft failed. Please retry or cancel.";
}

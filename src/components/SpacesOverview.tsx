import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import type {
  WorkspaceState,
  TabGroup,
  SavedWorkspaceSession,
} from "../types";
import {
  vkClient,
  type Workspace,
  type WorkspaceSummary,
  type Repo,
  type RepoWithBranch,
} from "../lib/vk-client";

interface DashboardWorkspace {
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

// ── Utilities ───────────────────────────────────────────────────────────────

function formatRelativeTime(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  if (isNaN(then)) return "";
  const diffMs = now - then;
  if (diffMs < 0) return "just now";

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

const PAGE_SIZE = 20;

// ── Data fetching hook ──────────────────────────────────────────────────────

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
  const workspaceName = workspaceId ? workspaceNameById.get(workspaceId) : undefined;
  return tabGroup.label.includes('...') && workspaceName ? workspaceName : tabGroup.label;
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
      // Fetch workspaces, summaries, and repos in parallel
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

      // Parse summaries (non-critical — default to empty if fails)
      const summaryMap = new Map<string, WorkspaceSummary>();
      if (summaryResult.status === "fulfilled") {
        for (const s of summaryResult.value.summaries) {
          summaryMap.set(s.workspace_id, s);
        }
      }

      // Parse repos list (non-critical)
      const allRepos =
        reposResult.status === "fulfilled" ? reposResult.value : [];

      // Batch-fetch per-workspace repos
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

      // Merge into DashboardWorkspace[]
      const merged: DashboardWorkspace[] = activeWorkspaces.map((ws) => {
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
      });

      setWorkspaces(merged);
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

// ── Sub-components ──────────────────────────────────────────────────────────

function StatusBadge({
  status,
  hasPendingApproval,
}: {
  status: DashboardWorkspace["latest_process_status"];
  hasPendingApproval: boolean;
}) {
  if (hasPendingApproval) {
    return (
      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/15 text-amber-400 border border-amber-500/30">
        Waiting
      </span>
    );
  }

  switch (status) {
    case "running":
      return (
        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-500/15 text-green-400 border border-green-500/30 flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
          Running
        </span>
      );
    case "completed":
      return (
        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-500/15 text-blue-400 border border-blue-500/30">
          Done
        </span>
      );
    case "failed":
    case "killed":
      return (
        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/15 text-red-400 border border-red-500/30">
          {status === "failed" ? "Failed" : "Killed"}
        </span>
      );
    default:
      return null;
  }
}

function PRBadge({
  status,
}: {
  status: "open" | "merged" | "closed" | "unknown";
}) {
  const styles = {
    open: "bg-green-500/15 text-green-400 border-green-500/30",
    merged: "bg-purple-500/15 text-purple-400 border-purple-500/30",
    closed: "bg-red-500/15 text-red-400 border-red-500/30",
    unknown: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
  };

  return (
    <span className={`px-1.5 py-0.5 rounded text-xs border ${styles[status]}`}>
      PR {status}
    </span>
  );
}

function RepoFilterBar({
  repos,
  selectedRepoId,
  onSelectRepo,
}: {
  repos: Repo[];
  selectedRepoId: string | null;
  onSelectRepo: (repoId: string | null) => void;
}) {
  const active =
    "px-3 py-1 rounded-full text-xs font-medium bg-white/10 text-white border border-white/20";
  const inactive =
    "px-3 py-1 rounded-full text-xs font-medium bg-zinc-800 text-zinc-400 border border-transparent hover:bg-zinc-700 hover:text-zinc-300 transition-colors";

  return (
    <div className="flex gap-2 overflow-x-auto pb-3 mb-4 scrollbar-none">
      <button
        className={selectedRepoId === null ? active : inactive}
        onClick={() => onSelectRepo(null)}
      >
        All
      </button>
      {repos.map((repo) => (
        <button
          key={repo.id}
          className={selectedRepoId === repo.id ? active : inactive}
          onClick={() => onSelectRepo(repo.id)}
        >
          {repo.display_name || repo.name}
        </button>
      ))}
    </div>
  );
}

function WorkspaceRow({
  workspace: ws,
  tabGroupNav,
  onOpenInNewTabGroup,
  isStoppingDevServer,
  onStopDevServer,
}: {
  workspace: DashboardWorkspace;
  tabGroupNav?: {
    spaceId: string;
    tabGroupId: string;
    label: string;
    onNavigate: () => void;
  };
  onOpenInNewTabGroup?: () => void;
  isStoppingDevServer?: boolean;
  onStopDevServer?: () => void;
}) {
  const activityTime = ws.latest_process_completed_at || ws.updated_at;
  const hasDiffStats =
    ws.files_changed != null ||
    ws.lines_added != null ||
    ws.lines_removed != null;
  const showsDevServerControls =
    ws.has_running_dev_server || isStoppingDevServer;

  return (
    <div className="flex flex-col gap-3 px-4 py-3 bg-zinc-800/50 rounded-lg border border-zinc-700/50 hover:border-zinc-600 transition-colors sm:flex-row sm:items-start">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        {/* Unseen dot */}
        <div className="w-2 shrink-0 pt-2">
          {ws.has_unseen_turns && (
            <span className="block w-2 h-2 rounded-full bg-blue-400" />
          )}
        </div>

        {/* Name + metadata */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
            {ws.pinned && <span className="text-amber-400 text-xs">*</span>}
            <span className="min-w-0 text-sm text-white font-medium break-words">
              {ws.name}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
            <span className="font-mono break-all">{ws.branch}</span>
            {ws.repos.map((r) => (
              <span
                key={r.id}
                className="rounded bg-zinc-700 px-1.5 py-0.5 text-zinc-400"
              >
                {r.display_name || r.name}
              </span>
            ))}
            {hasDiffStats && (
              <>
                {ws.files_changed != null && (
                  <span>{ws.files_changed} file{ws.files_changed !== 1 ? "s" : ""}</span>
                )}
                {ws.lines_added != null && ws.lines_added > 0 && (
                  <span className="font-mono text-green-500">+{ws.lines_added}</span>
                )}
                {ws.lines_removed != null && ws.lines_removed > 0 && (
                  <span className="font-mono text-red-500">-{ws.lines_removed}</span>
                )}
              </>
            )}
            {showsDevServerControls && (
              <span className="inline-flex items-center gap-1 rounded-full border border-cyan-500/30 bg-cyan-500/15 px-2 py-0.5 font-medium text-cyan-400">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                Dev server
              </span>
            )}
            {ws.pr_status && ws.pr_status !== "unknown" && (
              <PRBadge status={ws.pr_status} />
            )}
            {(ws.latest_process_status || ws.has_pending_approval) && (
              <StatusBadge
                status={ws.latest_process_status}
                hasPendingApproval={ws.has_pending_approval}
              />
            )}
            <span>{formatRelativeTime(activityTime)}</span>
          </div>
        </div>
      </div>

      <div className="flex w-full shrink-0 flex-wrap justify-start gap-2 pl-5 sm:w-auto sm:justify-end sm:pl-0">
        {showsDevServerControls && onStopDevServer && (
          <button
            onClick={onStopDevServer}
            disabled={isStoppingDevServer}
            className="px-2 py-1 rounded text-xs font-medium bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/25 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isStoppingDevServer ? "Stopping..." : "Stop server"}
          </button>
        )}


        {tabGroupNav ? (
          <button
            onClick={tabGroupNav.onNavigate}
            title={`Go to "${tabGroupNav.label}"`}
            className="px-2 py-1 rounded text-xs font-medium bg-indigo-500/15 text-indigo-400 border border-indigo-500/30 hover:bg-indigo-500/25 transition-colors"
          >
            Go to craft
          </button>
        ) : onOpenInNewTabGroup ? (
          <button
            onClick={onOpenInNewTabGroup}
            aria-label={`Open ${ws.name}`}
            className="px-2 py-1 rounded text-xs font-medium bg-zinc-700 text-zinc-300 border border-zinc-600 hover:bg-zinc-600 hover:text-white transition-colors"
          >
            Open
          </button>
        ) : null}
      </div>
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-between mt-4">
      <span className="text-xs text-zinc-500">
        Page {page + 1} of {totalPages}
      </span>
      <div className="flex gap-2">
        <button
          disabled={page === 0}
          onClick={() => onPageChange(page - 1)}
          className="px-3 py-1 rounded text-xs font-medium bg-zinc-800 text-zinc-400 border border-zinc-700 hover:bg-zinc-700 hover:text-zinc-300 transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-zinc-800 disabled:hover:text-zinc-400"
        >
          Previous
        </button>
        <button
          disabled={page >= totalPages - 1}
          onClick={() => onPageChange(page + 1)}
          className="px-3 py-1 rounded text-xs font-medium bg-zinc-800 text-zinc-400 border border-zinc-700 hover:bg-zinc-700 hover:text-zinc-300 transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-zinc-800 disabled:hover:text-zinc-400"
        >
          Next
        </button>
      </div>
    </div>
  );
}

function SpacePickerModal({
  workspace: ws,
  targetWorkspace,
  onSelect,
  onClose,
  pendingSpaceId,
  actionError,
  onRetry,
}: {
  workspace: WorkspaceState;
  targetWorkspace: DashboardWorkspace;
  onSelect: (spaceId: string) => void;
  onClose: () => void;
  pendingSpaceId?: string | null;
  actionError?: string | null;
  onRetry?: () => void;
}) {
  const spaces = ws.spaces;
  const isPending = Boolean(pendingSpaceId);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={() => {
        if (!isPending) onClose();
      }}
    >
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-full max-w-sm mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-5 pb-3">
          <h3 className="text-sm font-semibold text-white">
            Open craft in space
          </h3>
          <p className="text-xs text-zinc-500 mt-1 truncate">
            {targetWorkspace.name}
          </p>
        </div>
        {actionError && (
          <div
            role="alert"
            className="mx-5 mb-3 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-200"
          >
            <div>{actionError}</div>
            {onRetry && (
              <button
                className="mt-2 rounded border border-red-400/50 px-2 py-1 font-medium text-red-100 transition-colors hover:bg-red-500/20"
                onClick={onRetry}
              >
                Retry
              </button>
            )}
          </div>
        )}
        <div className="px-3 pb-3 max-h-64 overflow-y-auto">
          {spaces.length === 0 ? (
            <p className="text-xs text-zinc-500 px-2 py-4 text-center">
              No spaces available. Create a space first.
            </p>
          ) : (
            <div className="space-y-1">
              {spaces.map((space) => (
                <button
                  key={space.id}
                  onClick={() => onSelect(space.id)}
                  disabled={isPending}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-zinc-800 transition-colors text-left disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent"
                >
                  <span className="text-sm text-white">{space.name}</span>
                  {pendingSpaceId === space.id && (
                    <span className="text-xs text-cyan-300">Opening…</span>
                  )}
                  <span className="text-xs text-zinc-600 ml-auto">
                    {
                      ws.tabGroups.filter((tg) =>
                        space.tabGroupIds.includes(tg.id),
                      ).length
                    }{" "}
                    craft
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="px-5 pb-4 pt-2 border-t border-zinc-800">
          <button
            onClick={onClose}
            disabled={isPending}
            className="w-full px-3 py-1.5 rounded text-xs font-medium bg-zinc-800 text-zinc-400 border border-zinc-700 hover:bg-zinc-700 hover:text-zinc-300 transition-colors disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-zinc-800 disabled:hover:text-zinc-400"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Running Dev Servers Section ──────────────────────────────────────────────

function RunningDevServersSection({
  workspaces,
  loading,
  onStop,
  stoppingIds,
  workspaceTabGroupMap,
  onNavigateToTabGroup,
  onRequestOpenWorkspace,
}: {
  workspaces: DashboardWorkspace[];
  loading: boolean;
  onStop: (workspaceId: string) => Promise<void>;
  stoppingIds: Set<string>;
  workspaceTabGroupMap: Map<
    string,
    { spaceId: string; tabGroupId: string; label: string }
  >;
  onNavigateToTabGroup: (spaceId: string, tabGroupId: string) => void;
  onRequestOpenWorkspace?: (workspace: DashboardWorkspace) => void;
}) {
  const devServerWorkspaces = sortDashboardWorkspaces(
    workspaces.filter(
      (ws) => ws.has_running_dev_server || stoppingIds.has(ws.id),
    ),
  );

  if (loading || devServerWorkspaces.length === 0) return null;

  return (
    <div className="mb-8 rounded-xl border border-cyan-500/30 bg-cyan-500/5 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
          <h2 className="text-lg font-semibold text-white">
            Running Dev Servers
          </h2>
        </div>
        <span className="text-xs text-zinc-500">
          {devServerWorkspaces.length} workspace
          {devServerWorkspaces.length !== 1 ? "s" : ""}
        </span>
      </div>
      <div className="space-y-1">
        {devServerWorkspaces.map((ws) => {
          const nav = workspaceTabGroupMap.get(ws.id);
          const tabGroupNav = nav
            ? {
                ...nav,
                onNavigate: () =>
                  onNavigateToTabGroup(nav.spaceId, nav.tabGroupId),
              }
            : null;
          return (
            <WorkspaceRow
              key={ws.id}
              workspace={ws}
              isStoppingDevServer={stoppingIds.has(ws.id)}
              onStopDevServer={() => onStop(ws.id)}
              {...(tabGroupNav ? { tabGroupNav } : {})}
              {...(!tabGroupNav && onRequestOpenWorkspace
                ? {
                    onOpenInNewTabGroup: () => onRequestOpenWorkspace(ws),
                  }
                : {})}
            />
          );
        })}
      </div>
    </div>
  );
}

// ── Craft Row ───────────────────────────────────────────────────────────

function TabGroupRow({
  space,
  tg,
  onNavigate,
  timeLabel,
  label,
}: {
  space: { id: string; name: string };
  tg: TabGroup;
  onNavigate: () => void;
  timeLabel?: string | undefined;
  label?: string | undefined;
}) {
  return (
    <button
      onClick={onNavigate}
      className="w-full flex items-start gap-3 px-4 py-2.5 rounded-lg bg-zinc-800/50 border border-zinc-700/50 hover:border-zinc-600 transition-colors group text-left"
    >
      <div className="min-w-0 flex-1">
        <span className="text-sm font-medium text-white break-words block">
          {label ?? tg.label}
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
          <span>{space.name}</span>
          <span>
            {tg.tabs.length} view{tg.tabs.length !== 1 ? "s" : ""}
            {tg.pairs.length > 0 &&
              ` / ${tg.pairs.length} pair${tg.pairs.length !== 1 ? "s" : ""}`}
          </span>
          {timeLabel && <span>{timeLabel}</span>}
        </span>
      </div>
      <svg
        className="mt-1 w-3.5 h-3.5 text-zinc-600 group-hover:text-white transition-colors shrink-0"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M9 5l7 7-7 7"
        />
      </svg>
    </button>
  );
}


// ── Recent Craft ───────────────────────────────────────────────────────

const TAB_GROUP_PAGE_SIZE = 10;

type TabGroupWithSpace = { space: { id: string; name: string }; tg: TabGroup };

function useNonSystemTabGroups(workspace: WorkspaceState): TabGroupWithSpace[] {
  return useMemo(() => {
    const seen = new Set<string>();
    const items: TabGroupWithSpace[] = [];
    for (const space of workspace.spaces) {
      if (space.isSystem) continue;
      for (const tgId of space.tabGroupIds) {
        if (seen.has(tgId)) continue;
        seen.add(tgId);
        const tg = workspace.tabGroups.find((g) => g.id === tgId);
        if (tg) items.push({ space, tg });
      }
    }
    return items;
  }, [workspace.spaces, workspace.tabGroups]);
}

function StarredTabGroups({
  workspace,
  onNavigateToTabGroup,
  tabGroupDisplayLabelById,
}: {
  workspace: WorkspaceState;
  onNavigateToTabGroup: (spaceId: string, tabGroupId: string) => void;
  tabGroupDisplayLabelById: Map<string, string>;
}) {
  const allItems = useNonSystemTabGroups(workspace);

  const starred = useMemo(() => {
    return allItems.filter(({ tg }) => tg.starred);
  }, [allItems]);

  if (starred.length === 0) return null;

  return (
    <div className="mb-8">
      <h2 className="text-lg font-semibold text-white mb-3">Starred</h2>
      <div className="space-y-1">
        {starred.map(({ space, tg }) => (
          <TabGroupRow
            key={tg.id}
            space={space}
            tg={tg}
            onNavigate={() => onNavigateToTabGroup(space.id, tg.id)}
            label={tabGroupDisplayLabelById.get(tg.id)}
          />
        ))}
      </div>
    </div>
  );
}

function RecentSessionsSection({
  workspace,
  savedSessions,
  currentSessionId,
  onResumeSession,
  onRenameSession,
  onDeleteSession,
  onStartNewSession,
  onNavigateToTabGroup,
  tabGroupDisplayLabelById,
}: {
  workspace: WorkspaceState;
  savedSessions: SavedWorkspaceSession[];
  currentSessionId?: string;
  onResumeSession: (sessionId: string) => void;
  onRenameSession: (sessionId: string, name: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onStartNewSession: () => void;
  onNavigateToTabGroup: (spaceId: string, tabGroupId: string) => void;
  tabGroupDisplayLabelById: Map<string, string>;
}) {
  const sortedSessions = useMemo(() => {
    return [...savedSessions]
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  }, [savedSessions]);
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [sessionNameDraft, setSessionNameDraft] = useState('');

  if (sortedSessions.length === 0) return null;

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-3 gap-3">
        <h2 className="text-lg font-semibold text-white">All Voyages</h2>
        <button
          onClick={onStartNewSession}
          className="px-3 py-1.5 rounded text-xs font-medium bg-zinc-800 text-zinc-300 border border-zinc-700 hover:bg-zinc-700 hover:text-white transition-colors"
        >
          New Voyage
        </button>
      </div>
      <div className="space-y-1">
        {sortedSessions.map((session) => {
          const space = workspace.spaces.find((item) => item.id === session.activeSpaceId);
          const tg = workspace.tabGroups.find((item) => item.id === session.activeTabGroupId);

          const sessionName =
            session.name?.trim() ||
            tg?.label ||
            session.slug ||
            'Saved voyage';
          const sessionLocation =
            space && tg
              ? `${space.name} / ${tg.label}`
              : 'Recoverable voyage — saved craft is no longer available';
          const isExpanded = expandedSessionId === session.id;
          const sessionTabGroupIds =
            session.voyageEntries?.map((entry) => entry.tabGroupId) ||
            session.visitedTabGroupIds;
          const tabGroups = sessionTabGroupIds
            .map((tabGroupId, index) => {
              const tabGroup = workspace.tabGroups.find((item) => item.id === tabGroupId);
              if (!tabGroup) return null;
              const ownerSpace = workspace.spaces.find((item) =>
                item.tabGroupIds.includes(tabGroupId),
              );
              if (!ownerSpace) return null;
              return { tabGroup: tabGroup, space: ownerSpace, key: `${tabGroupId}-${index}` };
            })
            .filter(
              (
                item,
              ): item is {
                tabGroup: TabGroup;
                space: WorkspaceState['spaces'][number];
                key: string;
              } =>
                item != null,
            );

          return (
            <div
              key={session.id}
              className="rounded-lg bg-zinc-800/50 border border-zinc-700/50 overflow-hidden"
            >
              <div
                className="flex flex-col gap-2 px-4 py-2.5 cursor-pointer sm:flex-row sm:items-start"
                onClick={() => onResumeSession(session.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onResumeSession(session.id);
                  }
                }}
              >
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <button
                    type="button"
                    className="mt-0.5 text-zinc-500 hover:text-white transition-colors shrink-0"
                    aria-label={isExpanded ? 'Collapse voyage' : 'Expand voyage'}
                    onClick={(event) => {
                      event.stopPropagation();
                      setExpandedSessionId((prev) =>
                        prev === session.id ? null : session.id,
                      );
                    }}
                  >
                    {isExpanded ? '▾' : '▸'}
                  </button>
                  <div className="min-w-0 flex-1 text-left">
                  {editingSessionId === session.id ? (
                    <input
                      type="text"
                      value={sessionNameDraft}
                      onChange={(event) => setSessionNameDraft(event.target.value)}
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => {
                        event.stopPropagation();
                        if (event.key === 'Enter' && sessionNameDraft.trim()) {
                          onRenameSession(session.id, sessionNameDraft.trim());
                          setEditingSessionId(null);
                          setSessionNameDraft('');
                        }
                        if (event.key === 'Escape') {
                          setEditingSessionId(null);
                          setSessionNameDraft('');
                        }
                      }}
                      onBlur={() => {
                        if (sessionNameDraft.trim()) {
                          onRenameSession(session.id, sessionNameDraft.trim());
                        }
                        setEditingSessionId(null);
                        setSessionNameDraft('');
                      }}
                      className="w-full rounded border border-zinc-600 bg-zinc-900 px-2 py-1 text-sm text-white"
                      autoFocus
                    />
                  ) : (
                    <>
                      <span className="text-sm font-medium text-white break-words block">
                        {sessionName}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
                        <span>{sessionLocation}</span>
                        <span>{formatRelativeTime(session.updatedAt)}</span>
                        {session.id === currentSessionId && (
                          <span className="text-primary-300">Current</span>
                        )}
                      </span>
                    </>
                  )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-2 pl-6 sm:pl-0 sm:justify-end">
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      setEditingSessionId(session.id);
                      setSessionNameDraft(sessionName);
                    }}
                    className="text-xs text-zinc-400 hover:text-white shrink-0"
                  >
                    Rename
                  </button>
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      if (
                        confirm(
                          `Delete voyage "${sessionName}"? This won't delete any spaces or craft.`,
                        )
                      ) {
                        onDeleteSession(session.id);
                      }
                    }}
                    className="text-xs text-red-400 hover:text-red-300 shrink-0"
                  >
                    Delete
                  </button>
                </div>
              </div>
              {isExpanded && (
                <div className="border-t border-zinc-700/50 px-4 py-3 space-y-1 bg-zinc-900/40">
                  {tabGroups.length > 0 ? (
                    tabGroups.map(({ tabGroup, space: ownerSpace, key }) => (
                      <button
                        key={key}
                        onClick={() => onNavigateToTabGroup(ownerSpace.id, tabGroup.id)}
                        className="w-full flex items-start justify-between gap-3 px-3 py-2 rounded bg-zinc-800/70 hover:bg-zinc-700/70 text-left"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-sm text-white break-words">
                            {tabGroup.label}
                            {tabGroup.id === session.activeTabGroupId ? (
                              <span className="ml-2 text-xs text-primary-300">Active</span>
                            ) : null}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
                            {ownerSpace.name}
                            <span>
                              {tabGroup.tabs.length} view{tabGroup.tabs.length !== 1 ? 's' : ''}
                            </span>
                          </div>
                        </div>
                      </button>
                    ))
                  ) : (
                    <div className="text-xs text-zinc-500">
                      No available craft found for this voyage. Resume will recover it with a fallback craft.
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RecentlyVisitedTabGroups({
  workspace,
  onNavigateToTabGroup,
  tabGroupDisplayLabelById,
}: {
  workspace: WorkspaceState;
  onNavigateToTabGroup: (spaceId: string, tabGroupId: string) => void;
  tabGroupDisplayLabelById: Map<string, string>;
}) {
  const allItems = useNonSystemTabGroups(workspace);
  const [page, setPage] = useState(0);

  const recentlyVisited = useMemo(() => {
    return allItems
      .filter(({ tg }) => tg.lastVisitedAt)
      .sort(
        (a, b) =>
          new Date(b.tg.lastVisitedAt!).getTime() -
          new Date(a.tg.lastVisitedAt!).getTime(),
      );
  }, [allItems]);

  const totalPages = Math.ceil(recentlyVisited.length / TAB_GROUP_PAGE_SIZE);
  const paged = recentlyVisited.slice(
    page * TAB_GROUP_PAGE_SIZE,
    (page + 1) * TAB_GROUP_PAGE_SIZE,
  );

  if (recentlyVisited.length === 0) return null;

  return (
    <div className="mb-8">
      <h2 className="text-lg font-semibold text-white mb-3">
        Recently Visited
      </h2>
      <div className="space-y-1">
        {paged.map(({ space, tg }) => (
          <TabGroupRow
            key={tg.id}
            space={space}
            tg={tg}
            onNavigate={() => onNavigateToTabGroup(space.id, tg.id)}
            timeLabel={
              tg.lastVisitedAt
                ? formatRelativeTime(tg.lastVisitedAt)
                : undefined
            }
            label={tabGroupDisplayLabelById.get(tg.id)}
          />
        ))}
      </div>
      <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
    </div>
  );
}

function RecentlyCreatedTabGroups({
  workspace,
  onNavigateToTabGroup,
  tabGroupDisplayLabelById,
}: {
  workspace: WorkspaceState;
  onNavigateToTabGroup: (spaceId: string, tabGroupId: string) => void;
  tabGroupDisplayLabelById: Map<string, string>;
}) {
  const allItems = useNonSystemTabGroups(workspace);
  const [page, setPage] = useState(0);

  const recentlyCreated = useMemo(() => {
    return allItems
      .filter(({ tg }) => tg.createdAt)
      .sort(
        (a, b) =>
          new Date(b.tg.createdAt!).getTime() -
          new Date(a.tg.createdAt!).getTime(),
      );
  }, [allItems]);

  const totalPages = Math.ceil(recentlyCreated.length / TAB_GROUP_PAGE_SIZE);
  const paged = recentlyCreated.slice(
    page * TAB_GROUP_PAGE_SIZE,
    (page + 1) * TAB_GROUP_PAGE_SIZE,
  );

  if (recentlyCreated.length === 0) return null;

  return (
    <div className="mb-8">
      <h2 className="text-lg font-semibold text-white mb-3">
        Recently Created
      </h2>
      <div className="space-y-1">
        {paged.map(({ space, tg }) => (
          <TabGroupRow
            key={tg.id}
            space={space}
            tg={tg}
            onNavigate={() => onNavigateToTabGroup(space.id, tg.id)}
            timeLabel={
              tg.createdAt ? formatRelativeTime(tg.createdAt) : undefined
            }
            label={tabGroupDisplayLabelById.get(tg.id)}
          />
        ))}
      </div>
      <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
    </div>
  );
}

// ── Spaces Section ──────────────────────────────────────────────────────────

function SpacesSection({
  workspace,
  onNavigateToTabGroup,
  tabGroupDisplayLabelById,
}: {
  workspace: WorkspaceState;
  onNavigateToTabGroup: (spaceId: string, tabGroupId: string) => void;
  tabGroupDisplayLabelById: Map<string, string>;
}) {
  const spacesWithTabGroups = workspace.spaces
    .filter((space) => !space.isSystem)
    .map((space) => ({
      space,
      tabGroups: workspace.tabGroups
        .filter((tg) => space.tabGroupIds.includes(tg.id))
        .sort((a, b) => a.order - b.order),
    }));

  if (spacesWithTabGroups.length === 0) return null;

  return (
    <div>
      <h2 className="text-lg font-semibold text-white mb-3">All Spaces</h2>
      <div className="space-y-1">
        {spacesWithTabGroups.map(({ space, tabGroups }) => (
          <div key={space.id}>
            {/* Space header row */}
            <div className="flex items-center gap-3 px-4 py-2 mt-3 first:mt-0">
              <span className="text-sm font-semibold text-zinc-300">
                {space.name}
              </span>
              <span className="text-xs text-zinc-600">
                {tabGroups.length} craft
              </span>
            </div>
            {/* Tab group rows */}
            {tabGroups.map((tg) => (
              <button
                key={tg.id}
                onClick={() => onNavigateToTabGroup(space.id, tg.id)}
                className="w-full flex items-start gap-3 px-4 py-2.5 rounded-lg bg-zinc-800/50 border border-zinc-700/50 hover:border-zinc-600 transition-colors group text-left"
              >
                <div className="min-w-0 flex-1">
                  <span className="text-sm text-white font-medium break-words block">
                    {tabGroupDisplayLabelById.get(tg.id) ?? tg.label}
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
                    <span>
                      {tg.tabs.length} view{tg.tabs.length !== 1 ? "s" : ""}
                    </span>
                    {tg.pairs.length > 0 && (
                      <span>
                        {tg.pairs.length} pair{tg.pairs.length !== 1 ? "s" : ""}
                      </span>
                    )}
                  </span>
                </div>
                <svg
                  className="mt-1 w-3.5 h-3.5 text-zinc-600 group-hover:text-white transition-colors shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────

interface SpacesOverviewProps {
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

export function SpacesOverview({
  workspace,
  savedSessions,
  currentSessionId,
  onResumeSession,
  onRenameSession,
  onDeleteSession,
  onStartNewSession,
  onNavigateToTabGroup,
  onOpenVKWorkspace,
}: SpacesOverviewProps) {
  const { workspaces, repos, loading, error, refetch } = useVKDashboardData();
  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [spacePickerTarget, setSpacePickerTarget] =
    useState<DashboardWorkspace | null>(null);
  const openCraftMutation = useMutation<
    void,
    Error,
    {
      workspace: DashboardWorkspace;
      spaceId: string;
    }
  >({
    mutationFn: async ({ workspace: targetWorkspace, spaceId }) => {
      if (!onOpenVKWorkspace) {
        throw new Error("Open Craft is unavailable.");
      }

      await onOpenVKWorkspace(
        targetWorkspace.id,
        targetWorkspace.name,
        targetWorkspace.container_ref || "",
        spaceId,
      );
    },
    onSuccess: () => {
      setSpacePickerTarget(null);
    },
  });
  const [stoppingDevServerIds, setStoppingDevServerIds] = useState<Set<string>>(
    new Set(),
  );
  const workspaceNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of workspaces) {
      map.set(item.id, item.name || item.branch);
    }
    return map;
  }, [workspaces]);
  const tabGroupDisplayLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const tabGroup of workspace.tabGroups) {
      map.set(tabGroup.id, getTabGroupDisplayLabel(tabGroup, workspaceNameById));
    }
    return map;
  }, [workspace.tabGroups, workspaceNameById]);

  const handleStopDevServer = useCallback(
    async (workspaceId: string) => {
      if (stoppingDevServerIds.has(workspaceId)) return;

      setStoppingDevServerIds((prev) => new Set(prev).add(workspaceId));

      let clearDelayMs = 5000;
      try {
        await vkClient.stopWorkspaceExecution(workspaceId);
        // Refresh data after a short delay to let the backend update
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

  const openSpacePickerForWorkspace = (targetWorkspace: DashboardWorkspace) => {
    openCraftMutation.reset();
    setSpacePickerTarget(targetWorkspace);
  };

  // Derive repos from workspace data if /api/repos returned empty
  const effectiveRepos = useMemo(() => {
    if (repos.length > 0) return repos;
    const seen = new Map<string, Repo>();
    for (const ws of workspaces) {
      for (const r of ws.repos) {
        if (!seen.has(r.id)) {
          seen.set(r.id, {
            id: r.id,
            name: r.name,
            display_name: r.display_name,
          });
        }
      }
    }
    return Array.from(seen.values());
  }, [repos, workspaces]);

  // Reset page when filter changes
  useEffect(() => {
    setPage(0);
  }, [selectedRepoId]);

  const sortedWorkspaces = useMemo(() => {
    let filtered = workspaces;
    if (selectedRepoId) {
      filtered = workspaces.filter((w) =>
        w.repos.some((r) => r.id === selectedRepoId),
      );
    }
    return sortDashboardWorkspaces(filtered);
  }, [workspaces, selectedRepoId]);

  const totalPages = Math.ceil(sortedWorkspaces.length / PAGE_SIZE);
  const pagedWorkspaces = sortedWorkspaces.slice(
    page * PAGE_SIZE,
    (page + 1) * PAGE_SIZE,
  );

  // Map workspace IDs to their open craft by scanning view URLs for /workspaces/{id}
  const workspaceTabGroupMap = useMemo(() => {
    const map = new Map<
      string,
      { spaceId: string; tabGroupId: string; label: string }
    >();
    for (const space of workspace.spaces) {
      const tgs = workspace.tabGroups.filter((tg) =>
        space.tabGroupIds.includes(tg.id),
      );
      for (const tg of tgs) {
        for (const tab of tg.tabs) {
          const match = tab.url.match(/\/workspaces\/([^/?#]+)/);
          if (match && match[1]) {
            map.set(match[1], {
              spaceId: space.id,
              tabGroupId: tg.id,
              label: tg.label,
            });
          }
        }
      }
    }
    return map;
  }, [workspace.spaces, workspace.tabGroups]);

  const hasSpaces = workspace.spaces.some((s) => !s.isSystem);

  return (
    <div className="h-full w-full overflow-auto bg-zinc-900 p-6 md:p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-sm text-zinc-500 mt-1">Workspace activity feed</p>
        </div>

        {/* Voyages */}
        <RecentSessionsSection
          workspace={workspace}
          savedSessions={savedSessions}
          currentSessionId={currentSessionId}
          onResumeSession={onResumeSession}
          onRenameSession={onRenameSession}
          onDeleteSession={onDeleteSession}
          onStartNewSession={onStartNewSession}
          onNavigateToTabGroup={onNavigateToTabGroup}
          tabGroupDisplayLabelById={tabGroupDisplayLabelById}
        />

        {/* Starred Craft */}
        <StarredTabGroups
          workspace={workspace}
          onNavigateToTabGroup={onNavigateToTabGroup}
          tabGroupDisplayLabelById={tabGroupDisplayLabelById}
        />

        {/* Running Dev Servers */}
        <RunningDevServersSection
          workspaces={workspaces}
          loading={loading}
          onStop={handleStopDevServer}
          stoppingIds={stoppingDevServerIds}
          workspaceTabGroupMap={workspaceTabGroupMap}
          onNavigateToTabGroup={onNavigateToTabGroup}
          onRequestOpenWorkspace={
            onOpenVKWorkspace ? openSpacePickerForWorkspace : undefined
          }
        />

        {/* Recently Visited Craft */}
        <RecentlyVisitedTabGroups
          workspace={workspace}
          onNavigateToTabGroup={onNavigateToTabGroup}
          tabGroupDisplayLabelById={tabGroupDisplayLabelById}
        />

        {/* Recently Created Craft */}
        <RecentlyCreatedTabGroups
          workspace={workspace}
          onNavigateToTabGroup={onNavigateToTabGroup}
          tabGroupDisplayLabelById={tabGroupDisplayLabelById}
        />

        {/* VK Workspaces Section */}
        <div className="mb-10">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-white">VK Workspaces</h2>
            {!loading && sortedWorkspaces.length > 0 && (
              <span className="text-xs text-zinc-500">
                {sortedWorkspaces.length} workspace
                {sortedWorkspaces.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>

          <RepoFilterBar
            repos={effectiveRepos}
            selectedRepoId={selectedRepoId}
            onSelectRepo={setSelectedRepoId}
          />

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-2 border-zinc-600 border-t-zinc-300 rounded-full animate-spin" />
            </div>
          ) : error ? (
            <div className="text-center py-8">
              <p className="text-zinc-500 text-sm">{error}</p>
              <p className="text-zinc-600 text-xs mt-1">
                VK backend may not be running
              </p>
            </div>
          ) : sortedWorkspaces.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-zinc-500 text-sm">
                {selectedRepoId
                  ? "No workspaces for this repository"
                  : "No active workspaces"}
              </p>
            </div>
          ) : (
            <>
              <div className="space-y-1">
                {pagedWorkspaces.map((ws) => {
                  const nav = workspaceTabGroupMap.get(ws.id);
                  const tabGroupNav = nav
                    ? {
                        ...nav,
                        onNavigate: () =>
                          onNavigateToTabGroup(nav.spaceId, nav.tabGroupId),
                      }
                    : null;
                  return (
                    <WorkspaceRow
                      key={ws.id}
                      workspace={ws}
                      isStoppingDevServer={stoppingDevServerIds.has(ws.id)}
                      onStopDevServer={
                        ws.has_running_dev_server ||
                        stoppingDevServerIds.has(ws.id)
                          ? () => handleStopDevServer(ws.id)
                          : undefined
                      }
                      {...(tabGroupNav ? { tabGroupNav } : {})}
                      {...(!tabGroupNav && onOpenVKWorkspace
                        ? {
                            onOpenInNewTabGroup: () =>
                              openSpacePickerForWorkspace(ws),
                          }
                        : {})}
                    />
                  );
                })}
              </div>
              <Pagination
                page={page}
                totalPages={totalPages}
                onPageChange={setPage}
              />
            </>
          )}
        </div>

        {/* Divider + Spaces */}
        {hasSpaces && (
          <>
            <div className="border-t border-zinc-800 my-8" />
            <SpacesSection
              workspace={workspace}
              onNavigateToTabGroup={onNavigateToTabGroup}
              tabGroupDisplayLabelById={tabGroupDisplayLabelById}
            />
          </>
        )}
      </div>

      {/* Space picker modal */}
      {spacePickerTarget && onOpenVKWorkspace && (
        <SpacePickerModal
          workspace={workspace}
          targetWorkspace={spacePickerTarget}
          onSelect={(spaceId) => {
            openCraftMutation.mutate({
              workspace: spacePickerTarget,
              spaceId,
            });
          }}
          onClose={() => {
            if (openCraftMutation.isPending) return;
            setSpacePickerTarget(null);
            openCraftMutation.reset();
          }}
          pendingSpaceId={
            openCraftMutation.isPending
              ? openCraftMutation.variables?.spaceId ?? null
              : null
          }
          actionError={
            openCraftMutation.isError
              ? getDashboardOpenCraftErrorMessage(openCraftMutation.error)
              : null
          }
          onRetry={
            openCraftMutation.variables
              ? () => openCraftMutation.mutate(openCraftMutation.variables!)
              : undefined
          }
        />
      )}
    </div>
  );
}

function getDashboardOpenCraftErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return "Open Craft failed. Please retry or cancel.";
}

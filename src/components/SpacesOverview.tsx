import React, { useState, useEffect, useMemo, useCallback } from 'react';
import type { WorkspaceState, TabGroup } from '../types';

// ── VK Backend types (subset needed for dashboard) ──────────────────────────

interface VKWorkspace {
  id: string;
  task_id: string;
  container_ref: string | null;
  branch: string;
  agent_working_dir: string | null;
  created_at: string;
  updated_at: string;
  archived: boolean;
  pinned: boolean;
  name: string | null;
}

interface VKWorkspaceSummary {
  workspace_id: string;
  has_pending_approval: boolean;
  files_changed: number | null;
  lines_added: number | null;
  lines_removed: number | null;
  latest_process_completed_at?: string;
  latest_process_status: 'running' | 'completed' | 'failed' | 'killed' | null;
  has_running_dev_server: boolean;
  has_unseen_turns: boolean;
  pr_status: 'open' | 'merged' | 'closed' | 'unknown' | null;
}

interface VKRepo {
  id: string;
  name: string;
  display_name: string;
}

interface VKRepoWithBranch {
  id: string;
  name: string;
  display_name: string;
  target_branch: string;
}

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
  latest_process_status: 'running' | 'completed' | 'failed' | 'killed' | null;
  latest_process_completed_at: string | null;
  has_pending_approval: boolean;
  has_running_dev_server: boolean;
  has_unseen_turns: boolean;
  pr_status: 'open' | 'merged' | 'closed' | 'unknown' | null;
  repos: VKRepoWithBranch[];
}

// ── Utilities ───────────────────────────────────────────────────────────────

function formatRelativeTime(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  if (isNaN(then)) return '';
  const diffMs = now - then;
  if (diffMs < 0) return 'just now';

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return 'just now';
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

function useVKDashboardData() {
  const [workspaces, setWorkspaces] = useState<DashboardWorkspace[]>([]);
  const [repos, setRepos] = useState<VKRepo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    setError(null);

    try {
      // Fetch workspaces, summaries, and repos in parallel
      const [wsRes, summaryRes, reposRes] = await Promise.all([
        fetch('/api/task-attempts'),
        fetch('/api/task-attempts/summary', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ archived: false }),
        }),
        fetch('/api/repos'),
      ]);

      if (!wsRes.ok) throw new Error('Failed to load workspaces');

      const wsData = await wsRes.json();
      if (!wsData.success || !Array.isArray(wsData.data)) {
        throw new Error('Invalid workspace response');
      }

      const activeWorkspaces: VKWorkspace[] = wsData.data.filter(
        (w: VKWorkspace) => !w.archived
      );

      // Parse summaries (non-critical — default to empty if fails)
      let summaryMap = new Map<string, VKWorkspaceSummary>();
      if (summaryRes.ok) {
        try {
          const summaryData = await summaryRes.json();
          if (summaryData.success && summaryData.data?.summaries) {
            for (const s of summaryData.data.summaries) {
              summaryMap.set(s.workspace_id, s);
            }
          }
        } catch { /* ignore */ }
      }

      // Parse repos list (non-critical)
      let allRepos: VKRepo[] = [];
      if (reposRes.ok) {
        try {
          const reposData = await reposRes.json();
          if (reposData.success && Array.isArray(reposData.data)) {
            allRepos = reposData.data;
          }
        } catch { /* ignore */ }
      }

      // Batch-fetch per-workspace repos
      const repoResults = await Promise.allSettled(
        activeWorkspaces.map((ws) =>
          fetch(`/api/task-attempts/${ws.id}/repos`)
            .then((r) => (r.ok ? r.json() : { success: false }))
            .then((d) => ({
              wsId: ws.id,
              repos: d.success && Array.isArray(d.data) ? d.data : [],
            }))
        )
      );

      const wsRepoMap = new Map<string, VKRepoWithBranch[]>();
      for (const result of repoResults) {
        if (result.status === 'fulfilled') {
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
      setError(err instanceof Error ? err.message : 'Failed to load data');
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
  status: DashboardWorkspace['latest_process_status'];
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
    case 'running':
      return (
        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-500/15 text-green-400 border border-green-500/30 flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
          Running
        </span>
      );
    case 'completed':
      return (
        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-500/15 text-blue-400 border border-blue-500/30">
          Done
        </span>
      );
    case 'failed':
    case 'killed':
      return (
        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/15 text-red-400 border border-red-500/30">
          {status === 'failed' ? 'Failed' : 'Killed'}
        </span>
      );
    default:
      return null;
  }
}

function PRBadge({ status }: { status: 'open' | 'merged' | 'closed' | 'unknown' }) {
  const styles = {
    open: 'bg-green-500/15 text-green-400 border-green-500/30',
    merged: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
    closed: 'bg-red-500/15 text-red-400 border-red-500/30',
    unknown: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30',
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
  repos: VKRepo[];
  selectedRepoId: string | null;
  onSelectRepo: (repoId: string | null) => void;
}) {
  const active = 'px-3 py-1 rounded-full text-xs font-medium bg-white/10 text-white border border-white/20';
  const inactive =
    'px-3 py-1 rounded-full text-xs font-medium bg-zinc-800 text-zinc-400 border border-transparent hover:bg-zinc-700 hover:text-zinc-300 transition-colors';

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
}: {
  workspace: DashboardWorkspace;
  tabGroupNav?: { spaceId: string; tabGroupId: string; label: string; onNavigate: () => void };
}) {
  const activityTime = ws.latest_process_completed_at || ws.updated_at;
  const hasDiffStats =
    ws.files_changed != null || ws.lines_added != null || ws.lines_removed != null;

  return (
    <div className="flex items-center gap-4 px-4 py-3 bg-zinc-800/50 rounded-lg border border-zinc-700/50 hover:border-zinc-600 transition-colors">
      {/* Unseen dot */}
      <div className="w-2 shrink-0">
        {ws.has_unseen_turns && (
          <span className="block w-2 h-2 rounded-full bg-blue-400" />
        )}
      </div>

      {/* Name + branch */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {ws.pinned && <span className="text-amber-400 text-xs">*</span>}
          <span className="text-sm text-white font-medium truncate">
            {ws.name}
          </span>
        </div>
        <span className="text-xs text-zinc-500 font-mono truncate block">
          {ws.branch}
        </span>
      </div>

      {/* Repos */}
      <div className="hidden md:flex gap-1 shrink-0">
        {ws.repos.map((r) => (
          <span
            key={r.id}
            className="px-1.5 py-0.5 bg-zinc-700 rounded text-xs text-zinc-400 truncate max-w-20"
          >
            {r.display_name || r.name}
          </span>
        ))}
      </div>

      {/* Diff stats */}
      {hasDiffStats && (
        <div className="hidden sm:flex items-center gap-2 text-xs shrink-0">
          {ws.files_changed != null && (
            <span className="text-zinc-400">
              {ws.files_changed}f
            </span>
          )}
          {ws.lines_added != null && ws.lines_added > 0 && (
            <span className="text-green-500 font-mono">+{ws.lines_added}</span>
          )}
          {ws.lines_removed != null && ws.lines_removed > 0 && (
            <span className="text-red-500 font-mono">-{ws.lines_removed}</span>
          )}
        </div>
      )}

      {/* PR badge */}
      {ws.pr_status && ws.pr_status !== 'unknown' && (
        <div className="shrink-0">
          <PRBadge status={ws.pr_status} />
        </div>
      )}

      {/* Go to tab group */}
      {tabGroupNav && (
        <button
          onClick={tabGroupNav.onNavigate}
          title={`Go to "${tabGroupNav.label}"`}
          className="shrink-0 px-2 py-1 rounded text-xs font-medium bg-indigo-500/15 text-indigo-400 border border-indigo-500/30 hover:bg-indigo-500/25 transition-colors"
        >
          Open
        </button>
      )}

      {/* Status */}
      <div className="shrink-0">
        <StatusBadge
          status={ws.latest_process_status}
          hasPendingApproval={ws.has_pending_approval}
        />
      </div>

      {/* Time */}
      <span className="text-xs text-zinc-500 whitespace-nowrap shrink-0 w-16 text-right">
        {formatRelativeTime(activityTime)}
      </span>
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

// ── Recent Tab Groups ───────────────────────────────────────────────────────

function RecentTabGroups({
  workspace,
  onNavigateToTabGroup,
}: {
  workspace: WorkspaceState;
  onNavigateToTabGroup: (spaceId: string, tabGroupId: string) => void;
}) {
  const recentGroups = useMemo(() => {
    const items: { space: (typeof workspace.spaces)[0]; tg: TabGroup }[] = [];

    for (const space of workspace.spaces) {
      if (space.isSystem) continue;
      const tgs = workspace.tabGroups
        .filter((tg) => space.tabGroupIds.includes(tg.id))
        .sort((a, b) => a.order - b.order);
      for (const tg of tgs) {
        items.push({ space, tg });
      }
    }

    return items.reverse().slice(0, 8);
  }, [workspace.spaces, workspace.tabGroups]);

  if (recentGroups.length === 0) return null;

  return (
    <div className="mb-10">
      <h2 className="text-lg font-semibold text-white mb-3">Recent Tab Groups</h2>
      <div className="space-y-1">
        {recentGroups.map(({ space, tg }) => (
          <button
            key={tg.id}
            onClick={() => onNavigateToTabGroup(space.id, tg.id)}
            className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg bg-zinc-800/50 border border-zinc-700/50 hover:border-zinc-600 transition-colors group text-left"
          >
            <div className="min-w-0 flex-1">
              <span className="text-sm font-medium text-white truncate block">{tg.label}</span>
            </div>
            <span className="text-xs text-zinc-500 shrink-0">{space.name}</span>
            <span className="text-xs text-zinc-600 shrink-0">
              {tg.tabs.length} tab{tg.tabs.length !== 1 ? 's' : ''}
              {tg.pairs.length > 0 &&
                ` / ${tg.pairs.length} pair${tg.pairs.length !== 1 ? 's' : ''}`}
            </span>
            <svg
              className="w-3.5 h-3.5 text-zinc-600 group-hover:text-white transition-colors shrink-0"
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
    </div>
  );
}

// ── Spaces Section ──────────────────────────────────────────────────────────

function SpacesSection({
  workspace,
  onNavigateToTabGroup,
}: {
  workspace: WorkspaceState;
  onNavigateToTabGroup: (spaceId: string, tabGroupId: string) => void;
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
              <span className="text-sm font-semibold text-zinc-300">{space.name}</span>
              <span className="text-xs text-zinc-600">
                {tabGroups.length} tab group{tabGroups.length !== 1 ? 's' : ''}
              </span>
            </div>
            {/* Tab group rows */}
            {tabGroups.map((tg) => (
              <button
                key={tg.id}
                onClick={() => onNavigateToTabGroup(space.id, tg.id)}
                className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg bg-zinc-800/50 border border-zinc-700/50 hover:border-zinc-600 transition-colors group text-left"
              >
                <div className="min-w-0 flex-1">
                  <span className="text-sm text-white font-medium truncate block">{tg.label}</span>
                </div>
                <span className="text-xs text-zinc-600 shrink-0">
                  {tg.tabs.length} tab{tg.tabs.length !== 1 ? 's' : ''}
                  {tg.pairs.length > 0 &&
                    ` / ${tg.pairs.length} pair${tg.pairs.length !== 1 ? 's' : ''}`}
                </span>
                <svg
                  className="w-3.5 h-3.5 text-zinc-600 group-hover:text-white transition-colors shrink-0"
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
  onNavigateToTabGroup: (spaceId: string, tabGroupId: string) => void;
}

export function SpacesOverview({ workspace, onNavigateToTabGroup }: SpacesOverviewProps) {
  const { workspaces, repos, loading, error } = useVKDashboardData();
  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  // Reset page when filter changes
  useEffect(() => { setPage(0); }, [selectedRepoId]);

  const sortedWorkspaces = useMemo(() => {
    let filtered = workspaces;
    if (selectedRepoId) {
      filtered = workspaces.filter((w) =>
        w.repos.some((r) => r.id === selectedRepoId)
      );
    }
    return [...filtered].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      const aTime = new Date(a.latest_process_completed_at || a.updated_at).getTime();
      const bTime = new Date(b.latest_process_completed_at || b.updated_at).getTime();
      return bTime - aTime;
    });
  }, [workspaces, selectedRepoId]);

  const totalPages = Math.ceil(sortedWorkspaces.length / PAGE_SIZE);
  const pagedWorkspaces = sortedWorkspaces.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // Map workspace IDs to their open tab groups by scanning tab URLs for /workspaces/{id}
  const workspaceTabGroupMap = useMemo(() => {
    const map = new Map<string, { spaceId: string; tabGroupId: string; label: string }>();
    for (const space of workspace.spaces) {
      const tgs = workspace.tabGroups.filter((tg) => space.tabGroupIds.includes(tg.id));
      for (const tg of tgs) {
        for (const tab of tg.tabs) {
          const match = tab.url.match(/\/workspaces\/([^/?#]+)/);
          if (match && match[1]) {
            map.set(match[1], { spaceId: space.id, tabGroupId: tg.id, label: tg.label });
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

        {/* Recent Tab Groups */}
        <RecentTabGroups
          workspace={workspace}
          onNavigateToTabGroup={onNavigateToTabGroup}
        />

        {/* VK Workspaces Section */}
        <div className="mb-10">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-white">VK Workspaces</h2>
            {!loading && sortedWorkspaces.length > 0 && (
              <span className="text-xs text-zinc-500">
                {sortedWorkspaces.length} workspace{sortedWorkspaces.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          <RepoFilterBar
            repos={repos}
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
                  ? 'No workspaces for this repository'
                  : 'No active workspaces'}
              </p>
            </div>
          ) : (
            <>
              <div className="space-y-1">
                {pagedWorkspaces.map((ws) => {
                  const nav = workspaceTabGroupMap.get(ws.id);
                  const tabGroupNav = nav ? {
                    ...nav,
                    onNavigate: () => onNavigateToTabGroup(nav.spaceId, nav.tabGroupId),
                  } : null;
                  return (
                    <WorkspaceRow
                      key={ws.id}
                      workspace={ws}
                      {...(tabGroupNav ? { tabGroupNav } : {})}
                    />
                  );
                })}
              </div>
              <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
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
            />
          </>
        )}
      </div>
    </div>
  );
}

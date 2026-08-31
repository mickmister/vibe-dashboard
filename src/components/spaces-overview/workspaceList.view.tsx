import type {
  DashboardWorkspace,
  SpacesOverviewRepo,
} from "./SpacesOverview.contracts";

export function formatRelativeTime(isoString: string): string {
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

export function StatusBadge({
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

export function PRBadge({
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

export function RepoFilterBar({
  repos,
  selectedRepoId,
  onSelectRepo,
}: {
  repos: SpacesOverviewRepo[];
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

export function WorkspaceRow({
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

export function Pagination({
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

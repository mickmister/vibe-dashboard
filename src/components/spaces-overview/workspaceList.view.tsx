import type {
  DashboardWorkspace,
  SpacesOverviewRepo,
} from "./SpacesOverview.contracts";
import { VDAction, VDBadge, VDText } from "../../theme/skins";

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
      <VDBadge
        className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/15 border border-amber-500/30"
        status="warning"
      >
        Waiting
      </VDBadge>
    );
  }

  switch (status) {
    case "running":
      return (
        <VDBadge
          className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-500/15 border border-green-500/30 flex items-center gap-1"
          status="success"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
          Running
        </VDBadge>
      );
    case "completed":
      return (
        <VDBadge
          className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-500/15 border border-blue-500/30"
          status="accent"
        >
          Done
        </VDBadge>
      );
    case "failed":
    case "killed":
      return (
        <VDBadge
          className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/15 border border-red-500/30"
          status="danger"
        >
          {status === "failed" ? "Failed" : "Killed"}
        </VDBadge>
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
    open: "bg-green-500/15 border-green-500/30",
    merged: "bg-purple-500/15 border-purple-500/30",
    closed: "bg-red-500/15 border-red-500/30",
    unknown: "bg-zinc-500/15 border-zinc-500/30",
  };
  const tones = {
    open: "success",
    merged: "accent",
    closed: "danger",
    unknown: "secondary",
  } as const;

  return (
    <VDBadge
      className={`px-1.5 py-0.5 rounded text-xs border ${styles[status]}`}
      status={tones[status]}
    >
      PR {status}
    </VDBadge>
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
    "px-3 py-1 rounded-full text-xs font-medium bg-white/10 border border-white/20";
  const inactive =
    "px-3 py-1 rounded-full text-xs font-medium bg-zinc-800 border border-transparent hover:bg-zinc-700 transition-colors";

  return (
    <div className="flex gap-2 overflow-x-auto pb-3 mb-4 scrollbar-none">
      <VDAction
        className={selectedRepoId === null ? active : inactive}
        tone={selectedRepoId === null ? "accent" : "quiet"}
        onClick={() => onSelectRepo(null)}
        type="button"
      >
        All
      </VDAction>
      {repos.map((repo) => (
        <VDAction
          key={repo.id}
          className={selectedRepoId === repo.id ? active : inactive}
          tone={selectedRepoId === repo.id ? "accent" : "quiet"}
          onClick={() => onSelectRepo(repo.id)}
          type="button"
        >
          {repo.display_name || repo.name}
        </VDAction>
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
    <div
      className="flex flex-col gap-3 px-4 py-3 bg-zinc-800/50 rounded-lg border border-zinc-700/50 hover:border-zinc-600 transition-colors sm:flex-row sm:items-start"
      data-vd-component="row"
    >
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
            {ws.pinned && (
              <VDText className="text-xs" status="warning">
                *
              </VDText>
            )}
            <VDText
              className="min-w-0 text-sm font-medium break-words"
            >
              {ws.name}
            </VDText>
          </div>
          <div
            className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs"
            data-vd-muted
          >
            <span className="font-mono break-all">{ws.branch}</span>
            {ws.repos.map((r) => (
              <VDBadge
                key={r.id}
                className="rounded bg-zinc-700 px-1.5 py-0.5"
              >
                {r.display_name || r.name}
              </VDBadge>
            ))}
            {hasDiffStats && (
              <>
                {ws.files_changed != null && (
                  <span>{ws.files_changed} file{ws.files_changed !== 1 ? "s" : ""}</span>
                )}
                {ws.lines_added != null && ws.lines_added > 0 && (
                  <VDText className="font-mono" status="success">
                    +{ws.lines_added}
                  </VDText>
                )}
                {ws.lines_removed != null && ws.lines_removed > 0 && (
                  <VDText className="font-mono" status="danger">
                    -{ws.lines_removed}
                  </VDText>
                )}
              </>
            )}
            {showsDevServerControls && (
              <VDBadge
                className="inline-flex items-center gap-1 rounded-full border border-cyan-500/30 bg-cyan-500/15 px-2 py-0.5 font-medium"
                status="accent"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                Dev server
              </VDBadge>
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
          <VDAction
            onClick={onStopDevServer}
            disabled={isStoppingDevServer}
            className="px-2 py-1 rounded text-xs font-medium bg-red-500/15 border border-red-500/30 hover:bg-red-500/25 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            tone="danger"
            type="button"
          >
            {isStoppingDevServer ? "Stopping..." : "Stop server"}
          </VDAction>
        )}

        {tabGroupNav ? (
          <VDAction
            onClick={tabGroupNav.onNavigate}
            title={`Go to "${tabGroupNav.label}"`}
            className="px-2 py-1 rounded text-xs font-medium bg-indigo-500/15 border border-indigo-500/30 hover:bg-indigo-500/25 transition-colors"
            tone="accent"
            type="button"
          >
            Go to craft
          </VDAction>
        ) : onOpenInNewTabGroup ? (
          <VDAction
            onClick={onOpenInNewTabGroup}
            aria-label={`Open ${ws.name}`}
            className="px-2 py-1 rounded text-xs font-medium bg-zinc-700 border border-zinc-600 hover:bg-zinc-600 transition-colors"
            tone="quiet"
            type="button"
          >
            Open
          </VDAction>
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
      <VDText className="text-xs" tone="muted">
        Page {page + 1} of {totalPages}
      </VDText>
      <div className="flex gap-2">
        <VDAction
          disabled={page === 0}
          onClick={() => onPageChange(page - 1)}
          className="px-3 py-1 rounded text-xs font-medium bg-zinc-800 border border-zinc-700 hover:bg-zinc-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-zinc-800"
          tone="quiet"
          type="button"
        >
          Previous
        </VDAction>
        <VDAction
          disabled={page >= totalPages - 1}
          onClick={() => onPageChange(page + 1)}
          className="px-3 py-1 rounded text-xs font-medium bg-zinc-800 border border-zinc-700 hover:bg-zinc-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-zinc-800"
          tone="quiet"
          type="button"
        >
          Next
        </VDAction>
      </div>
    </div>
  );
}

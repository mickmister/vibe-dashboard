import type { SpacesOverviewComponentProps } from "./SpacesOverview.contracts";
import { formatRelativeTime, Pagination } from "./workspaceList.view";

export function DenseWorkspaceListSection({
  model,
  actions,
}: SpacesOverviewComponentProps) {
  const {
    loading,
    error,
    selectedRepoId,
    sortedWorkspaces,
    pagedWorkspaces,
    workspacePage,
    workspaceTotalPages,
    stoppingDevServerIds,
    workspaceTabGroupMap,
    canOpenWorkspaceInSpace,
  } = model;

  return (
    <div
      className="mb-10 rounded-xl border border-zinc-800 bg-zinc-950/30"
      data-vd-slot="workspace-list"
    >
      <div className="flex flex-col gap-3 border-b border-zinc-800 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2
            className="text-sm font-semibold uppercase tracking-[0.16em]"
            data-vd-text="primary"
          >
            VK Workspaces
          </h2>
          {!loading && sortedWorkspaces.length > 0 && (
            <p className="mt-1 text-xs" data-vd-muted>
              {sortedWorkspaces.length} workspace
              {sortedWorkspaces.length !== 1 ? "s" : ""}
              {selectedRepoId ? " in this repository" : ""}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className={
              selectedRepoId === null
                ? "rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-medium"
                : "rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1 text-xs font-medium"
            }
            data-vd-component="button"
            data-vd-tone={selectedRepoId === null ? "accent" : "quiet"}
            onClick={() => actions.selectRepo(null)}
          >
            All
          </button>
          {model.effectiveRepos.map((repo) => (
            <button
              key={repo.id}
              className={
                selectedRepoId === repo.id
                  ? "rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-medium"
                  : "rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1 text-xs font-medium"
              }
              data-vd-component="button"
              data-vd-tone={selectedRepoId === repo.id ? "accent" : "quiet"}
              onClick={() => actions.selectRepo(repo.id)}
            >
              {repo.display_name || repo.name}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div
          className="px-4 py-8 text-center text-sm"
          data-vd-muted
          data-vd-component="loading-state"
        >
          Loading workspaces…
        </div>
      ) : error ? (
        <div className="px-4 py-8 text-center" data-vd-component="error-state">
          <p className="text-sm" data-vd-text="secondary">
            {error}
          </p>
          <p className="mt-1 text-xs" data-vd-muted>
            VK backend may not be running
          </p>
        </div>
      ) : sortedWorkspaces.length === 0 ? (
        <div
          className="px-4 py-8 text-center text-sm"
          data-vd-muted
          data-vd-component="empty-state"
        >
          {selectedRepoId
            ? "No workspaces for this repository"
            : "No active workspaces"}
        </div>
      ) : (
        <>
          <div className="divide-y divide-zinc-800">
            {pagedWorkspaces.map((workspace) => {
              const nav = workspaceTabGroupMap.get(workspace.id);
              const isStopping = stoppingDevServerIds.has(workspace.id);
              const canStop = workspace.has_running_dev_server || isStopping;
              return (
                <div
                  key={workspace.id}
                  className="grid gap-3 px-4 py-2.5 text-xs sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] sm:items-center"
                  data-vd-component="row"
                >
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      {workspace.has_unseen_turns && (
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-400" />
                      )}
                      {workspace.pinned && (
                        <span className="shrink-0" data-vd-status="warning">
                          *
                        </span>
                      )}
                      <span className="truncate font-medium" data-vd-text="primary">
                        {workspace.name}
                      </span>
                    </div>
                    <div className="mt-1 truncate font-mono" data-vd-muted>
                      {workspace.branch}
                    </div>
                  </div>

                  <div
                    className="flex min-w-0 flex-wrap items-center gap-2"
                    data-vd-muted
                  >
                    {workspace.repos.slice(0, 2).map((repo) => (
                      <span
                        key={repo.id}
                        className="rounded bg-zinc-800 px-1.5 py-0.5"
                        data-vd-component="badge"
                      >
                        {repo.display_name || repo.name}
                      </span>
                    ))}
                    {workspace.files_changed != null && (
                      <span>{workspace.files_changed} files</span>
                    )}
                    {workspace.lines_added != null &&
                      workspace.lines_added > 0 && (
                        <span
                          className="font-mono"
                          data-vd-status="success"
                        >
                          +{workspace.lines_added}
                        </span>
                      )}
                    {workspace.lines_removed != null &&
                      workspace.lines_removed > 0 && (
                        <span
                          className="font-mono"
                          data-vd-status="danger"
                        >
                          -{workspace.lines_removed}
                        </span>
                      )}
                    <span>
                      {formatRelativeTime(
                        workspace.latest_process_completed_at ||
                          workspace.updated_at,
                      )}
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-2 sm:justify-end">
                    {canStop && (
                      <button
                        className="rounded border border-red-500/30 bg-red-500/10 px-2 py-1 font-medium disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={isStopping}
                        data-vd-component="button"
                        data-vd-tone="danger"
                        onClick={() => actions.stopDevServer(workspace.id)}
                      >
                        {isStopping ? "Stopping…" : "Stop"}
                      </button>
                    )}
                    {nav ? (
                      <button
                        className="rounded border border-indigo-500/30 bg-indigo-500/10 px-2 py-1 font-medium"
                        data-vd-component="button"
                        data-vd-tone="accent"
                        title={`Go to "${nav.label}"`}
                        onClick={() =>
                          actions.navigateToTabGroup(
                            nav.spaceId,
                            nav.tabGroupId,
                          )
                        }
                      >
                        Craft
                      </button>
                    ) : canOpenWorkspaceInSpace ? (
                      <button
                        className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 font-medium"
                        aria-label={`Open ${workspace.name}`}
                        data-vd-component="button"
                        data-vd-tone="quiet"
                        onClick={() =>
                          actions.openSpacePickerForWorkspace(workspace)
                        }
                      >
                        Open
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="px-4 pb-3">
            <Pagination
              page={workspacePage}
              totalPages={workspaceTotalPages}
              onPageChange={actions.setWorkspacePage}
            />
          </div>
        </>
      )}
    </div>
  );
}

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
    <div className="mb-10 rounded-xl border border-zinc-800 bg-zinc-950/30">
      <div className="flex flex-col gap-3 border-b border-zinc-800 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-zinc-300">
            VK Workspaces
          </h2>
          {!loading && sortedWorkspaces.length > 0 && (
            <p className="mt-1 text-xs text-zinc-500">
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
                ? "rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-medium text-white"
                : "rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1 text-xs font-medium text-zinc-400 hover:text-zinc-200"
            }
            onClick={() => actions.selectRepo(null)}
          >
            All
          </button>
          {model.effectiveRepos.map((repo) => (
            <button
              key={repo.id}
              className={
                selectedRepoId === repo.id
                  ? "rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-medium text-white"
                  : "rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1 text-xs font-medium text-zinc-400 hover:text-zinc-200"
              }
              onClick={() => actions.selectRepo(repo.id)}
            >
              {repo.display_name || repo.name}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="px-4 py-8 text-center text-sm text-zinc-500">
          Loading workspaces…
        </div>
      ) : error ? (
        <div className="px-4 py-8 text-center">
          <p className="text-sm text-zinc-400">{error}</p>
          <p className="mt-1 text-xs text-zinc-600">
            VK backend may not be running
          </p>
        </div>
      ) : sortedWorkspaces.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-zinc-500">
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
                  className="grid gap-3 px-4 py-2.5 text-xs text-zinc-400 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] sm:items-center"
                >
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      {workspace.has_unseen_turns && (
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-400" />
                      )}
                      {workspace.pinned && (
                        <span className="shrink-0 text-amber-400">*</span>
                      )}
                      <span className="truncate font-medium text-zinc-100">
                        {workspace.name}
                      </span>
                    </div>
                    <div className="mt-1 truncate font-mono text-zinc-600">
                      {workspace.branch}
                    </div>
                  </div>

                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    {workspace.repos.slice(0, 2).map((repo) => (
                      <span
                        key={repo.id}
                        className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-500"
                      >
                        {repo.display_name || repo.name}
                      </span>
                    ))}
                    {workspace.files_changed != null && (
                      <span>{workspace.files_changed} files</span>
                    )}
                    {workspace.lines_added != null &&
                      workspace.lines_added > 0 && (
                        <span className="font-mono text-green-500">
                          +{workspace.lines_added}
                        </span>
                      )}
                    {workspace.lines_removed != null &&
                      workspace.lines_removed > 0 && (
                        <span className="font-mono text-red-500">
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
                        className="rounded border border-red-500/30 bg-red-500/10 px-2 py-1 font-medium text-red-400 disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={isStopping}
                        onClick={() => actions.stopDevServer(workspace.id)}
                      >
                        {isStopping ? "Stopping…" : "Stop"}
                      </button>
                    )}
                    {nav ? (
                      <button
                        className="rounded border border-indigo-500/30 bg-indigo-500/10 px-2 py-1 font-medium text-indigo-300"
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
                        className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 font-medium text-zinc-300"
                        aria-label={`Open ${workspace.name}`}
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

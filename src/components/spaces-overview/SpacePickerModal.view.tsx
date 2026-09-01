import type {
  DashboardWorkspace,
  SpacesOverviewWorkspaceState,
} from "./SpacesOverview.contracts";

export function SpacePickerModal({
  workspace: ws,
  targetWorkspace,
  onSelect,
  onClose,
  pendingSpaceId,
  actionError,
  onRetry,
}: {
  workspace: SpacesOverviewWorkspaceState;
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
      data-vd-slot="space-picker-modal"
      onClick={() => {
        if (!isPending) onClose();
      }}
    >
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-full max-w-sm mx-4"
        data-vd-component="dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-5 pb-3">
          <h3 className="text-sm font-semibold" data-vd-text="primary">
            Open craft in space
          </h3>
          <p className="mt-1 truncate text-xs" data-vd-muted>
            {targetWorkspace.name}
          </p>
        </div>
        {actionError && (
          <div
            role="alert"
            className="mx-5 mb-3 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-xs"
            data-vd-status="danger"
          >
            <div>{actionError}</div>
            {onRetry && (
              <button
                className="mt-2 rounded border border-red-400/50 px-2 py-1 font-medium transition-colors hover:bg-red-500/20"
                data-vd-component="button"
                data-vd-tone="danger"
                onClick={onRetry}
              >
                Retry
              </button>
            )}
          </div>
        )}
        <div className="px-3 pb-3 max-h-64 overflow-y-auto">
          {spaces.length === 0 ? (
            <p
              className="px-2 py-4 text-center text-xs"
              data-vd-muted
            >
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
                  data-vd-component="row"
                >
                  <span className="text-sm" data-vd-text="primary">
                    {space.name}
                  </span>
                  {pendingSpaceId === space.id && (
                    <span className="text-xs" data-vd-status="accent">
                      Opening…
                    </span>
                  )}
                  <span className="ml-auto text-xs" data-vd-muted>
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
            className="w-full px-3 py-1.5 rounded text-xs font-medium bg-zinc-800 border border-zinc-700 hover:bg-zinc-700 transition-colors disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-zinc-800"
            data-vd-component="button"
            data-vd-tone="quiet"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

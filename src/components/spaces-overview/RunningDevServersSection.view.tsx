import type { DashboardWorkspace } from "./SpacesOverview.contracts";
import { sortDashboardWorkspaces } from "./SpacesOverview.model";
import { WorkspaceRow } from "./workspaceList.view";

export function RunningDevServersSection({
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
  onStop?: (workspaceId: string) => void | Promise<void>;
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
    <div
      className="mb-8 rounded-xl border border-cyan-500/30 bg-cyan-500/5 p-4"
      data-vd-slot="running-dev-servers"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
          <h2 className="text-lg font-semibold" data-vd-text="primary">
            Running Dev Servers
          </h2>
        </div>
        <span className="text-xs" data-vd-muted>
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
              onStopDevServer={
                onStop
                  ? () => {
                      void onStop(ws.id);
                    }
                  : undefined
              }
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

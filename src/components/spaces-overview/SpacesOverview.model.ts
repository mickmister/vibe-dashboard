import type { DashboardWorkspace } from "./SpacesOverview.contracts";

export function sortDashboardWorkspaces(
  workspaces: DashboardWorkspace[],
): DashboardWorkspace[] {
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

import type { SavedWorkspaceSession, WorkspaceState } from '../types';
import { buildSavedVoyageDashboardPath } from './voyageUrl';

const URL_PARSE_BASE = 'https://workspace.local';

function getRouteTabPathname(url: string): string | undefined {
  try {
    return new URL(url, URL_PARSE_BASE).pathname;
  } catch {
    return url.startsWith('/') ? url : undefined;
  }
}

export function findSavedVoyageForVdWorkspaceRoute(
  workspace: WorkspaceState,
  savedVoyages: SavedWorkspaceSession[],
  workspaceId: string,
): { session: SavedWorkspaceSession; voyageEntryId?: string } | undefined {
  const expectedPath = `/workspaces/${workspaceId}`;
  const tabGroup = workspace.tabGroups.find(
    (candidate) =>
      candidate.workspace?.workspaceId === workspaceId ||
      candidate.tabs.some((tab) => getRouteTabPathname(tab.url) === expectedPath),
  );
  if (!tabGroup) return undefined;

  for (const session of savedVoyages) {
    const entry = session.voyageEntries.find(
      (candidate) => candidate.tabGroupId === tabGroup.id,
    );
    if (entry) return { session, voyageEntryId: entry.id };
  }

  return undefined;
}

export function buildExistingVdWorkspaceDashboardPath({
  workspace,
  savedVoyages,
  existing,
}: {
  workspace: WorkspaceState;
  savedVoyages: SavedWorkspaceSession[];
  existing: { session: SavedWorkspaceSession; voyageEntryId?: string };
}): string {
  return buildSavedVoyageDashboardPath({
    currentSearch: '',
    workspace,
    session: existing.session,
    savedSessions: savedVoyages,
    voyageEntryId: existing.voyageEntryId,
  });
}

import type { SavedWorkspaceSession, WorkspaceState } from '../types';
import { buildSavedVoyageDashboardPath } from './voyageUrl';

const PREVIEW_SERVER_PLUGIN_ID = 'dev.mickmister.preview-server';
const PREVIEW_SERVER_SURFACE_KEY = 'run-configs';

export type PreviewDeepLinkTarget = {
  spaceId: string;
  tabGroupId: string;
  tabId: string;
  session: SavedWorkspaceSession;
  voyageEntryId?: string;
};

export function resolvePreviewDeepLinkTarget(input: {
  workspace: WorkspaceState;
  savedSessions: SavedWorkspaceSession[];
  activeSession?: SavedWorkspaceSession;
  previewWorkspaceId: string | null | undefined;
  previewSlotId: string | null | undefined;
}): PreviewDeepLinkTarget | null {
  if (!(input.previewWorkspaceId?.trim() && input.previewSlotId?.trim())) return null;

  const tabGroup = input.workspace.tabGroups.find(
    (candidate) => candidate.workspace?.workspaceId === input.previewWorkspaceId,
  );
  if (!tabGroup) return null;

  const previewTab = tabGroup.tabs.find((tab) => {
    if (tab.ephemeral?.kind !== 'craft-surface') return false;
    const sourceKey = tab.ephemeral.sourceKey || tab.ephemeral.surfaceKey;
    return tab.ephemeral.pluginId === PREVIEW_SERVER_PLUGIN_ID
      && sourceKey === PREVIEW_SERVER_SURFACE_KEY;
  });
  if (!previewTab) return null;

  const space = input.workspace.spaces.find((candidate) =>
    candidate.tabGroupIds.includes(tabGroup.id));
  if (!space) return null;

  const containingSession = input.savedSessions.find((session) =>
    session.voyageEntries.some((entry) => entry.tabGroupId === tabGroup.id));
  const session = containingSession || input.activeSession;
  if (!session) return null;
  const voyageEntry = session.voyageEntries.find(
    (entry) => entry.tabGroupId === tabGroup.id,
  );

  return {
    spaceId: space.id,
    tabGroupId: tabGroup.id,
    tabId: previewTab.id,
    session,
    ...(voyageEntry ? { voyageEntryId: voyageEntry.id } : {}),
  };
}

export function buildPreviewDeepLinkPath(input: {
  currentSearch: string;
  workspace: WorkspaceState;
  savedSessions: SavedWorkspaceSession[];
  target: PreviewDeepLinkTarget;
  session: SavedWorkspaceSession;
  voyageEntryId: string;
}): string {
  return buildSavedVoyageDashboardPath({
    currentSearch: input.currentSearch,
    workspace: input.workspace,
    session: input.session,
    savedSessions: input.savedSessions.some((entry) => entry.id === input.session.id)
      ? input.savedSessions
      : [...input.savedSessions, input.session],
    voyageEntryId: input.voyageEntryId,
    viewIds: [input.target.tabId],
  });
}

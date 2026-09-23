import type { SavedWorkspaceSession, WorkspaceState } from '../types';
import {
  parseCraftParam,
  resolveFocusToken,
  resolveFocusTokens,
  shortIdTokenMatches,
} from './voyageUrl';

export type DashboardFocusStatus = 'absent' | 'valid' | 'invalid';

export interface DashboardFocusSelection {
  spaceId?: string;
  tabGroupId?: string;
  itemId?: string;
  voyageEntryId?: string;
  viewIds?: string[];
  focusStatus: DashboardFocusStatus;
  focusReason?: string;
}

export function resolveDashboardFocusSelection(
  workspace: WorkspaceState,
  session: SavedWorkspaceSession | undefined,
  craftParam: string | undefined,
  panelParam: string | undefined,
  viewParam: string | undefined,
): DashboardFocusSelection {
  const requestedFocus = Boolean(panelParam || viewParam);
  const empty = (focusStatus: 'absent' | 'invalid', focusReason?: string) => ({
    focusStatus,
    ...(focusReason ? { focusReason } : {}),
  });
  if (!(session && (craftParam || requestedFocus))) return empty('absent');
  if (session && panelParam && !craftParam) {
    const matches = workspace.tabGroups.flatMap((tabGroup) => {
      const tabIds = tabGroup.tabs.map((tab) => tab.id);
      const resolved = resolveFocusToken(panelParam, tabIds);
      if (resolved.status !== 'valid') return [];
      const tab = tabGroup.tabs.find((candidate) => candidate.id === resolved.id);
      if (!tab) return [];
      const entry = session.voyageEntries.find(
        (candidate) =>
          candidate.tabGroupId === tabGroup.id &&
          candidate.viewIds.includes(tab.id),
      );
      if (!entry) return [];
      return [{ tabGroup, tab, entry }];
    });
    if (matches.length !== 1) return empty('invalid', 'panel-not-found');
    const { tabGroup, tab, entry } = matches[0]!;
    return {
      spaceId: workspace.spaces.find((space) =>
        space.tabGroupIds.includes(tabGroup.id),
      )?.id,
      tabGroupId: tabGroup.id,
      itemId: tab.id,
      voyageEntryId: entry.id,
      viewIds: [tab.id],
      focusStatus: 'valid',
    };
  }
  if (!(session && craftParam)) return empty(requestedFocus ? 'invalid' : 'absent', 'views-require-craft');
  const parsedCraft = parseCraftParam(craftParam);
  if (!parsedCraft) return empty('invalid', 'craft-not-found');

  const matchingEntry = session.voyageEntries?.find(
    (entry) =>
      shortIdTokenMatches(
        entry.id,
        parsedCraft.entrySuffix,
        session.voyageEntries.map((candidate) => candidate.id),
      ) &&
      shortIdTokenMatches(
        entry.tabGroupId,
        parsedCraft.tabGroupSuffix,
        workspace.tabGroups.map((candidate) => candidate.id),
      ),
  );
  if (!matchingEntry) return empty('invalid', 'craft-not-found');

  const tabGroup = workspace.tabGroups.find(
    (entry) => entry.id === matchingEntry.tabGroupId,
  );
  if (!tabGroup) return empty('invalid', 'craft-not-found');

  const entryPanelIds = matchingEntry.viewIds.filter((viewId) =>
    tabGroup.tabs.some((tab) => tab.id === viewId),
  );
  const panelResolution = resolveFocusToken(panelParam, entryPanelIds);
  const viewsResolution = resolveFocusTokens(viewParam, entryPanelIds);
  if (panelResolution.status === 'invalid') return empty('invalid', 'panel-not-found');
  if (viewsResolution.status === 'invalid') return empty('invalid', 'views-not-found');
  const resolvedViewIds = panelResolution.status === 'valid'
    ? [panelResolution.id]
    : viewsResolution.status === 'valid'
      ? viewsResolution.ids
      : matchingEntry.viewIds;
  const focusStatus = requestedFocus ? 'valid' : 'absent';
  const itemId =
    resolvedViewIds.length > 1
      ? tabGroup.pairs.find(
          (pair) =>
            pair.tabIds.length === resolvedViewIds.length &&
            pair.tabIds.every(
              (tabId, index) => tabId === resolvedViewIds[index],
            ),
        )?.id || resolvedViewIds[0]
      : resolvedViewIds[0];

  return {
    spaceId: workspace.spaces.find((space) =>
      space.tabGroupIds.includes(tabGroup.id),
    )?.id,
    tabGroupId: tabGroup.id,
    itemId,
    voyageEntryId: matchingEntry.id,
    viewIds: resolvedViewIds,
    focusStatus,
  };
}

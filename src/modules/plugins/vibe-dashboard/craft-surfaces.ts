import type {
  SavedWorkspaceSession,
  Tab,
  TabGroup,
  VoyageEntry,
  WorkspaceState,
} from '../../../types';
import type { RegisteredCraftSurfaceContribution } from './types';

export const CRAFT_SURFACE_TAB_ID_PREFIX = 'craft-surface:';

export interface CreateEffectiveWorkspaceWithCraftSurfacesInput {
  workspace: WorkspaceState;
  craftSurfaces: RegisteredCraftSurfaceContribution[];
  origin: string;
}

export function createEffectiveWorkspaceWithCraftSurfaces(
  input: CreateEffectiveWorkspaceWithCraftSurfacesInput,
): WorkspaceState {
  if (input.craftSurfaces.length === 0) return input.workspace;
  return {
    ...input.workspace,
    tabGroups: input.workspace.tabGroups.map((tabGroup) =>
      createEffectiveCraftWithSurfaces({
        tabGroup,
        craftSurfaces: input.craftSurfaces,
        origin: input.origin,
      }),
    ),
  };
}

function createEffectiveCraftWithSurfaces(input: {
  tabGroup: TabGroup;
  craftSurfaces: RegisteredCraftSurfaceContribution[];
  origin: string;
}): TabGroup {
  const existingTabIds = new Set(input.tabGroup.tabs.map((tab) => tab.id));
  const surfaceTabs = [...input.craftSurfaces]
    .sort((left, right) =>
      (left.order ?? 0) - (right.order ?? 0) || left.key.localeCompare(right.key),
    )
    .map((surface): Tab => ({
      id: getCraftSurfaceTabId(input.tabGroup.id, surface.key),
      title: surface.defaultTitle ?? surface.title,
      url: expandCraftSurfaceUrl(surface.urlTemplate, input.origin),
      pinned: true,
      ephemeral: {
        kind: 'craft-surface',
        pluginId: surface.pluginId,
        surfaceKey: surface.key,
        sourceKey: surface.sourceKey,
      },
    }))
    .filter((tab) => !existingTabIds.has(tab.id));

  if (surfaceTabs.length === 0) return input.tabGroup;
  return {
    ...input.tabGroup,
    tabs: [...input.tabGroup.tabs, ...surfaceTabs],
  };
}

export function getCraftSurfaceTabId(tabGroupId: string, surfaceKey: string): string {
  return `${CRAFT_SURFACE_TAB_ID_PREFIX}${tabGroupId}:${surfaceKey}`;
}

export function isEphemeralCraftSurfaceTab(
  tab: Pick<Tab, 'id' | 'ephemeral'> | undefined,
): boolean {
  return Boolean(
    tab?.ephemeral?.kind === 'craft-surface' ||
      tab?.id.startsWith(CRAFT_SURFACE_TAB_ID_PREFIX),
  );
}

export function isEphemeralCraftSurfaceTabId(tabId: string): boolean {
  return tabId.startsWith(CRAFT_SURFACE_TAB_ID_PREFIX);
}

export function tabGroupHasEphemeralCraftSurfaceTab(
  tabGroup: TabGroup,
  tabId: string,
): boolean {
  return isEphemeralCraftSurfaceTab(tabGroup.tabs.find((tab) => tab.id === tabId));
}

export function stripEphemeralCraftSurfaceTabsFromTabGroup(
  tabGroup: TabGroup,
): TabGroup {
  const persistentTabs = tabGroup.tabs.filter((tab) => !isEphemeralCraftSurfaceTab(tab));
  const persistentTabIds = new Set(persistentTabs.map((tab) => tab.id));
  return {
    ...tabGroup,
    tabs: persistentTabs.map(({ ephemeral: _ephemeral, ...tab }) => tab),
    pairs: tabGroup.pairs.filter((pair) =>
      pair.tabIds.every(
        (tabId) => persistentTabIds.has(tabId) && !isEphemeralCraftSurfaceTabId(tabId),
      ),
    ),
  };
}

export function stripEphemeralCraftSurfaceTabsFromWorkspace(
  workspace: WorkspaceState,
): WorkspaceState {
  return {
    ...workspace,
    tabGroups: workspace.tabGroups.map(stripEphemeralCraftSurfaceTabsFromTabGroup),
  };
}

export function filterEphemeralCraftSurfaceActiveItems(
  workspace: WorkspaceState,
  activeItems: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(activeItems).filter(([tabGroupId, itemId]) => {
      const tabGroup = workspace.tabGroups.find(
        (candidate) => candidate.id === tabGroupId,
      );
      return tabGroup ? tabGroupHasEphemeralCraftSurfaceTab(tabGroup, itemId) : false;
    }),
  );
}

export function stripEphemeralCraftSurfaceSessionRefs(input: {
  workspace: WorkspaceState;
  session: Pick<
    SavedWorkspaceSession,
    | 'activeVoyageEntryId'
    | 'voyageEntries'
    | 'activeItemsByVoyageEntryId'
    | 'activeItems'
    | 'visitedTabGroupIds'
  >;
}): Pick<
  SavedWorkspaceSession,
  'voyageEntries' | 'activeItemsByVoyageEntryId' | 'activeItems'
> {
  const tabGroupsById = new Map(
    input.workspace.tabGroups.map((tabGroup) => [tabGroup.id, tabGroup]),
  );
  const sanitizeViewIds = (entry: VoyageEntry): string[] => {
    const tabGroup = tabGroupsById.get(entry.tabGroupId);
    if (!tabGroup) return [];
    const persistentTabIds = new Set(
      tabGroup.tabs
        .filter((tab) => !isEphemeralCraftSurfaceTab(tab))
        .map((tab) => tab.id),
    );
    return entry.viewIds.filter((viewId) => persistentTabIds.has(viewId));
  };

  const voyageEntries = (input.session.voyageEntries ?? []).map((entry) => ({
    ...entry,
    viewIds: sanitizeViewIds(entry),
  }));
  const activeItems = Object.fromEntries(
    Object.entries(input.session.activeItems).filter(([tabGroupId, itemId]) => {
      const tabGroup = tabGroupsById.get(tabGroupId);
      if (!tabGroup) return true;
      return (
        !tabGroupHasEphemeralCraftSurfaceTab(tabGroup, itemId) &&
        !isEphemeralCraftSurfaceTabId(itemId)
      );
    }),
  );
  const activeItemsByVoyageEntryId = Object.fromEntries(
    Object.entries(input.session.activeItemsByVoyageEntryId ?? {}).filter(
      ([, itemId]) => !isEphemeralCraftSurfaceTabId(itemId),
    ),
  );

  return { voyageEntries, activeItemsByVoyageEntryId, activeItems };
}

function expandCraftSurfaceUrl(template: string, origin: string): string {
  return template.replaceAll('{{origin}}', origin);
}

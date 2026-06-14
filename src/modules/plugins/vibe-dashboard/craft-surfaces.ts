import type { Tab, TabGroup, WorkspaceState } from '../../../types';
import type { RegisteredCraftSurfaceContribution } from './types';

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
    .sort((left, right) => (left.order ?? 0) - (right.order ?? 0) || left.key.localeCompare(right.key))
    .map((surface): Tab => ({
      id: getCraftSurfaceTabId(input.tabGroup.id, surface.key),
      title: surface.defaultTitle ?? surface.title,
      url: expandCraftSurfaceUrl(surface.urlTemplate, input.origin),
      pinned: true,
    }))
    .filter((tab) => !existingTabIds.has(tab.id));

  if (surfaceTabs.length === 0) return input.tabGroup;
  return {
    ...input.tabGroup,
    tabs: [...input.tabGroup.tabs, ...surfaceTabs],
  };
}

function getCraftSurfaceTabId(tabGroupId: string, surfaceKey: string): string {
  return `craft-surface:${tabGroupId}:${surfaceKey}`;
}

function expandCraftSurfaceUrl(template: string, origin: string): string {
  return template.replaceAll('{{origin}}', origin);
}

import React from "react";
import type { TabGroup } from "../types";
import type { RegisteredSettingsMenuContribution } from "../modules/plugins/vibe-dashboard/types";

export type CraftSettingsContext = {
  tabGroupId: string;
  workspaceId: string;
  workspaceDir: string;
};

export function getCraftSettingsContext(
  tabGroup: Pick<TabGroup, "id" | "workspace">,
): CraftSettingsContext | null {
  if (!tabGroup.workspace?.workspaceId || !tabGroup.workspace.workspaceDir) {
    return null;
  }

  return {
    tabGroupId: tabGroup.id,
    workspaceId: tabGroup.workspace.workspaceId,
    workspaceDir: tabGroup.workspace.workspaceDir,
  };
}

export function getWorkspaceCraftSettingsMenus(
  settingsMenus: RegisteredSettingsMenuContribution[],
): RegisteredSettingsMenuContribution[] {
  return [...settingsMenus].sort(
    (left, right) =>
      (left.order ?? 0) - (right.order ?? 0) ||
      left.title.localeCompare(right.title) ||
      left.key.localeCompare(right.key),
  );
}

export function CraftSettingsPanel({
  tabGroup,
  settingsMenus,
}: {
  tabGroup: TabGroup;
  settingsMenus: RegisteredSettingsMenuContribution[];
}) {
  const context = getCraftSettingsContext(tabGroup);
  if (!context) {
    return (
      <div className="flex h-full items-center justify-center bg-neutral-950 text-neutral-400">
        <div className="max-w-md px-6 text-center">
          <p className="text-sm font-medium text-neutral-200">Settings unavailable</p>
          <p className="mt-2 text-xs">
            Craft settings are available for workspace-backed crafts.
          </p>
        </div>
      </div>
    );
  }

  const menus = getWorkspaceCraftSettingsMenus(settingsMenus);

  return (
    <div className="flex h-full min-h-0 bg-neutral-950 text-neutral-100">
      <aside className="w-64 flex-shrink-0 border-r border-neutral-800 bg-neutral-950/95 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Settings
        </p>
        <p className="mt-1 truncate text-sm text-neutral-300" title={context.workspaceDir}>
          {context.workspaceDir}
        </p>
        <div className="mt-4 flex flex-col gap-1">
          {menus.length === 0 ? (
            <p className="rounded-md border border-dashed border-neutral-800 px-3 py-2 text-xs text-neutral-500">
              No settings menus registered.
            </p>
          ) : (
            menus.map((menu) => (
              <button
                key={menu.key}
                type="button"
                className="rounded-md px-3 py-2 text-left text-sm text-neutral-200 transition-colors hover:bg-neutral-800"
              >
                <span className="block font-medium">{menu.title}</span>
                {menu.description ? (
                  <span className="mt-0.5 block text-xs text-neutral-500">
                    {menu.description}
                  </span>
                ) : null}
              </button>
            ))
          )}
        </div>
      </aside>
      <main className="flex min-w-0 flex-1 items-center justify-center p-6">
        <div className="max-w-md text-center">
          <p className="text-sm font-medium text-neutral-200">
            Select a settings menu
          </p>
          <p className="mt-2 text-xs text-neutral-500">
            Settings menus run with this craft&apos;s workspace context. No menu
            content is registered yet.
          </p>
        </div>
      </main>
    </div>
  );
}

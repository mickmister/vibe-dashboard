import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  CraftSettingsPanel,
  getCraftSettingsContext,
  getWorkspaceCraftSettingsMenus,
  renderBuiltInSettingsMenu,
} from "./CraftSettingsPanel";
import type { TabGroup } from "../types";
import type { RegisteredSettingsMenuContribution } from "../modules/plugins/vibe-dashboard/types";

const workspaceCraft: TabGroup = {
  id: "craft_workspace",
  label: "Workspace Craft",
  workspace: {
    workspaceId: "workspace_1",
    workspaceDir: "/home/vkuser/repos/app",
  },
  tabs: [],
  pairs: [],
  order: 0,
};

describe("CraftSettingsPanel", () => {
  it("derives Settings context from the active workspace-backed Craft", () => {
    expect(getCraftSettingsContext(workspaceCraft)).toEqual({
      tabGroupId: "craft_workspace",
      workspaceId: "workspace_1",
      workspaceDir: "/home/vkuser/repos/app",
    });
  });

  it("returns null context for non-workspace Crafts", () => {
    expect(
      getCraftSettingsContext({
        id: "craft_notes",
      }),
    ).toBeNull();
  });

  it("sorts registered settings menus deterministically", () => {
    const menus: RegisteredSettingsMenuContribution[] = [
      menu({ key: "plugin-b/z", title: "Zed", order: 20 }),
      menu({ key: "plugin-a/b", title: "Beta", order: 10 }),
      menu({ key: "plugin-a/a", title: "Alpha", order: 10 }),
    ];

    expect(getWorkspaceCraftSettingsMenus(menus).map((entry) => entry.key)).toEqual([
      "plugin-a/a",
      "plugin-a/b",
      "plugin-b/z",
    ]);
  });

  it("renders safe empty and registered-menu states from explicit Craft context", () => {
    const emptyMarkup = renderToStaticMarkup(
      React.createElement(CraftSettingsPanel, {
        tabGroup: workspaceCraft,
        settingsMenus: [],
      }),
    );
    expect(emptyMarkup).toContain("No settings menus registered.");
    expect(emptyMarkup).toContain("/home/vkuser/repos/app");

    const menuMarkup = renderToStaticMarkup(
      React.createElement(CraftSettingsPanel, {
        tabGroup: workspaceCraft,
        settingsMenus: [
          menu({
            key: "dev.mickmister.vibe-dashboard/vardash",
            title: "Vardash",
            description: "Manage repo environment values and launches",
            order: 10,
          }),
        ],
      }),
    );
    expect(menuMarkup).toContain("Vardash");
    expect(menuMarkup).toContain("Manage repo environment values and launches");

    const unavailableMarkup = renderToStaticMarkup(
      React.createElement(CraftSettingsPanel, {
        tabGroup: {
          id: "craft_notes",
          label: "Notes",
          tabs: [],
          pairs: [],
          order: 0,
        },
        settingsMenus: [
          menu({
            key: "dev.mickmister.vibe-dashboard/vardash",
            title: "Vardash",
          }),
        ],
      }),
    );
    expect(unavailableMarkup).toContain("Settings unavailable");
    expect(unavailableMarkup).toContain("workspace-backed crafts");
  });

  it("maps the built-in Vardash settings target to workspace Craft context", () => {
    const node = renderBuiltInSettingsMenu(
      menu({
        key: "dev.mickmister.vibe-dashboard/vardash",
        title: "Vardash",
      }),
      {
        tabGroupId: "craft_workspace",
        workspaceId: "workspace_1",
        workspaceDir: "/home/vkuser/repos/app",
      },
    );

    expect(React.isValidElement(node)).toBe(true);
    expect((node as React.ReactElement<{ workspaceId: string; workspaceDir: string }>).props).toMatchObject({
      workspaceId: "workspace_1",
      workspaceDir: "/home/vkuser/repos/app",
    });
  });
});

function menu(input: {
  key: string;
  title: string;
  description?: string;
  order?: number;
}): RegisteredSettingsMenuContribution {
  return {
    pluginId: input.key.split("/")[0] || "plugin",
    sourceKey: input.key.split("/")[1] || input.key,
    key: input.key,
    title: input.title,
    ...(input.description ? { description: input.description } : {}),
    target: { kind: "builtin", id: "vardash" },
    ...(input.order == null ? {} : { order: input.order }),
  };
}

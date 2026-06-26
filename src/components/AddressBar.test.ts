import { describe, expect, it } from "vitest";
import { getAddressBarEntries } from "./AddressBar";
import type { TabGroup } from "../types";

const workspaceCraft: TabGroup = {
  id: "craft_workspace",
  label: "Workspace Craft",
  workspace: {
    workspaceId: "workspace_1",
    workspaceDir: "/home/vkuser/repos/app",
    baseOrigin: "https://vd.example.test",
  },
  tabs: [
    {
      id: "agent",
      title: "Agent",
      url: "https://vd.example.test/workspaces/workspace_1",
      pinned: true,
    },
    {
      id: "code",
      title: "Code",
      url: "https://vd.example.test/?folder=%2Fhome%2Fvkuser%2Frepos%2Fapp",
      pinned: true,
    },
    {
      id: "craft-surface:craft_workspace:plugin/board",
      title: "Board",
      url: "https://vd.example.test/dashboard/plugins/board/index.html",
      pinned: true,
      ephemeral: {
        kind: "craft-surface",
        pluginId: "plugin.board",
        surfaceKey: "plugin/board",
        sourceKey: "board",
      },
    },
    {
      id: "custom",
      title: "Custom",
      url: "https://example.test",
    },
  ],
  pairs: [
    {
      id: "agent+code",
      tabIds: ["agent", "code"],
      ratios: [50, 50],
    },
    {
      id: "plugin+custom",
      tabIds: ["craft-surface:craft_workspace:plugin/board", "custom"],
      ratios: [50, 50],
    },
  ],
  order: 0,
};

describe("getAddressBarEntries", () => {
  it("includes a single generated Agent tab when it is active", () => {
    expect(getAddressBarEntries(workspaceCraft, "agent")).toEqual([
      {
        id: "agent",
        title: "Agent",
        url: "https://vd.example.test/workspaces/workspace_1",
        displayUrl: "https://vd.example.test/workspaces/workspace_1",
        readOnly: true,
      },
    ]);
  });

  it("includes generated built-in workspace tabs so their IDs and paths are copyable", () => {
    expect(getAddressBarEntries(workspaceCraft, "agent+code")).toEqual([
      {
        id: "agent",
        title: "Agent",
        url: "https://vd.example.test/workspaces/workspace_1",
        displayUrl: "https://vd.example.test/workspaces/workspace_1",
        readOnly: true,
      },
      {
        id: "code",
        title: "Code",
        url: "https://vd.example.test/?folder=%2Fhome%2Fvkuser%2Frepos%2Fapp",
        displayUrl: "https://vd.example.test/?folder=/home/vkuser/repos/app",
        readOnly: true,
      },
    ]);
  });

  it("still hides generated plugin surface tabs from the address bar", () => {
    expect(getAddressBarEntries(workspaceCraft, "plugin+custom")).toEqual([
      {
        id: "custom",
        title: "Custom",
        url: "https://example.test",
        displayUrl: "https://example.test",
        readOnly: false,
      },
    ]);
  });
});

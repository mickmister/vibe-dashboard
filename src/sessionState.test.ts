// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useSessionWorkspaceNav } from "./sessionState";
import type { SavedWorkspaceSession, WorkspaceState } from "./types";

const runtimeTabId =
  "craft-surface:tg_workspace:dev.mickmister.preview-server/run-configs";

function createWorkspace(tabs: WorkspaceState["tabGroups"][number]["tabs"]): WorkspaceState {
  return {
    spaces: [
      {
        id: "space_home",
        name: "Home",
        icon: "home",
        tabGroupIds: ["tg_workspace"],
      },
    ],
    tabGroups: [
      {
        id: "tg_workspace",
        label: "Preview urls",
        workspace: {
          workspaceId: "workspace_1",
          workspaceDir: "/home/vkuser/repos/app",
        },
        tabs,
        pairs: [],
        order: 0,
      },
    ],
    nextId: 1,
  };
}

const savedSession: SavedWorkspaceSession = {
  id: "session_1",
  slug: "aug-18-session_1",
  name: "Aug 18",
  createdAt: "2026-08-18T00:00:00.000Z",
  updatedAt: "2026-08-18T00:00:00.000Z",
  activeSpaceId: "space_home",
  activeTabGroupId: "tg_workspace",
  activeVoyageEntryId: "ve_tg_workspace",
  voyageEntries: [
    {
      id: "ve_tg_workspace",
      tabGroupId: "tg_workspace",
      viewIds: ["agent"],
    },
  ],
  activeItemsByVoyageEntryId: { ve_tg_workspace: "agent" },
  visitedTabGroupIds: ["tg_workspace"],
};

describe("useSessionWorkspaceNav", () => {
  it("reapplies explicit runtime route views when plugin craft tabs become available after reload", async () => {
    const route = {
      spaceId: "space_home",
      tabGroupId: "tg_workspace",
      voyageEntryId: "ve_tg_workspace",
      viewIds: [runtimeTabId],
    };
    const { result, rerender } = renderHook(
      ({ workspace }) =>
        useSessionWorkspaceNav(workspace, route, savedSession, {
          persistToSessionStorage: false,
        }),
      {
        initialProps: {
          workspace: createWorkspace([
            { id: "agent", title: "Agent", url: "/workspaces/workspace_1" },
          ]),
        },
      },
    );

    expect(result.current.activeItems.tg_workspace).toBe("agent");

    rerender({
      workspace: createWorkspace([
        { id: "agent", title: "Agent", url: "/workspaces/workspace_1" },
        {
          id: runtimeTabId,
          title: "PreviewServer",
          url: "internal://preview-run-configs",
          ephemeral: {
            kind: "craft-surface",
            pluginId: "dev.mickmister.preview-server",
            sourceKey: "run-configs",
            surfaceKey: "run-configs",
          },
        },
      ]),
    });

    await waitFor(() => {
      expect(result.current.activeItems.tg_workspace).toBe(runtimeTabId);
    });
    expect(result.current.voyageEntries[0]?.viewIds).toEqual([runtimeTabId]);
  });
});

import { describe, expect, it } from "vitest";
import type { WorkspaceState } from "../types";
import { buildBeadsDeepLink, openBeadSplitInWorkspace } from "./beadTabs";

function workspace(): WorkspaceState {
  return {
    nextId: 10,
    spaces: [
      { id: "space_1", name: "Main", icon: "default", tabGroupIds: ["tg_1"] },
    ],
    tabGroups: [
      {
        id: "tg_1",
        label: "Agent work",
        tabs: [{ id: "tab_agent", title: "Agent", url: "/workspaces/ws_1" }],
        pairs: [],
        order: 0,
      },
    ],
  };
}

describe("buildBeadsDeepLink", () => {
  it("builds a beads-web deep link for a bead id", () => {
    expect(buildBeadsDeepLink("/beads", "vkvw-f9p1")).toBe(
      "/beads/project?bead=vkvw-f9p1",
    );
  });
});

describe("openBeadSplitInWorkspace", () => {
  it("creates a beads tab and split pair beside the agent tab", () => {
    const state = workspace();

    const result = openBeadSplitInWorkspace(state, {
      tabGroupId: "tg_1",
      agentTabId: "tab_agent",
      beadId: "vkvw-f9p1",
      beadsUrl: "/beads/project?bead=vkvw-f9p1",
    });

    expect(result).toEqual({
      tabGroupId: "tg_1",
      pairId: "pair_11",
      beadsTabId: "tab_10",
    });
    expect(state.tabGroups[0]?.tabs).toContainEqual({
      id: "tab_10",
      title: "Beads",
      url: "/beads/project?bead=vkvw-f9p1",
    });
    expect(state.tabGroups[0]?.pairs).toContainEqual({
      id: "pair_11",
      tabIds: ["tab_agent", "tab_10"],
      ratios: [55, 45],
    });
  });

  it("reuses existing beads tab and pair while updating the bead URL", () => {
    const state = workspace();
    openBeadSplitInWorkspace(state, {
      tabGroupId: "tg_1",
      agentTabId: "tab_agent",
      beadId: "vkvw-first",
      beadsUrl: "/beads/project?bead=vkvw-first",
    });

    const result = openBeadSplitInWorkspace(state, {
      tabGroupId: "tg_1",
      agentTabId: "tab_agent",
      beadId: "vkvw-second",
      beadsUrl: "/beads/project?bead=vkvw-second",
    });

    expect(result).toEqual({
      tabGroupId: "tg_1",
      pairId: "pair_11",
      beadsTabId: "tab_10",
    });
    expect(state.tabGroups[0]?.tabs).toHaveLength(2);
    expect(
      state.tabGroups[0]?.tabs.find((tab) => tab.id === "tab_10")?.url,
    ).toBe("/beads/project?bead=vkvw-second");
    expect(state.tabGroups[0]?.pairs).toHaveLength(1);
  });
});

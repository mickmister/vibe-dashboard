/* eslint-disable formatjs/no-literal-string-in-object -- Tests assert stable fixture metadata, not rendered copy. */
import { describe, expect, it, vi } from "vitest";
import {
  createEffectiveWorkspaceWithCraftSurfaces,
  FIRST_PARTY_AGENT_PLUGIN_ID,
  FIRST_PARTY_AGENT_SURFACE_KEY,
  FIRST_PARTY_CODE_PLUGIN_ID,
  FIRST_PARTY_CODE_SURFACE_KEY,
  FIRST_PARTY_FORMS_PLUGIN_ID,
  FIRST_PARTY_FORMS_SURFACE_KEY,
  filterEphemeralCraftSurfaceActiveItems,
  isEphemeralCraftSurfaceTab,
  stripEphemeralCraftSurfaceSessionRefs,
  stripEphemeralCraftSurfaceTabsFromWorkspace,
  tabGroupHasEphemeralCraftSurfaceTab,
  migrateWorkspaceBuiltInTabs,
} from "./craft-surfaces";
import type { SavedWorkspaceSession, WorkspaceState } from "../../../types";
import type { RegisteredCraftSurfaceContribution } from "./types";

const workspace: WorkspaceState = {
  spaces: [
    {
      id: "space_home",
      name: "Home",
      icon: "home",
      tabGroupIds: ["craft_1", "craft_2"],
    },
  ],
  tabGroups: [
    {
      id: "craft_1",
      label: "Craft 1",
      tabs: [{ id: "tab_existing", title: "Existing", url: "/" }],
      pairs: [],
      order: 0,
    },
    { id: "craft_2", label: "Craft 2", tabs: [], pairs: [], order: 1 },
  ],
  nextId: 3,
};

const surfaces: RegisteredCraftSurfaceContribution[] = [
  {
    pluginId: "app.example.notes",
    sourceKey: "notes",
    key: "app.example.notes/notes",
    title: "Notes",
    urlTemplate: "{{origin}}/",
    order: 20,
  },
  {
    pluginId: "app.excalidraw.canvas",
    sourceKey: "canvas",
    key: "app.excalidraw.canvas/canvas",
    title: "Excalidraw",
    urlTemplate:
      "/dashboard/plugins/app.excalidraw.canvas/1.0.0/frontend_assets/index.html",
    order: 30,
  },
];

const formsSurface: RegisteredCraftSurfaceContribution = {
  pluginId: FIRST_PARTY_FORMS_PLUGIN_ID,
  sourceKey: "forms",
  key: FIRST_PARTY_FORMS_SURFACE_KEY,
  title: "Forms",
  defaultTitle: "Forms",
  urlTemplate: "internal://forms",
  order: 40,
};

const agentSurface: RegisteredCraftSurfaceContribution = {
  pluginId: FIRST_PARTY_AGENT_PLUGIN_ID,
  sourceKey: "agent",
  key: FIRST_PARTY_AGENT_SURFACE_KEY,
  title: "Agent",
  defaultTitle: "Agent",
  urlTemplate: "{{origin}}/workspaces/{{workspaceId}}",
  order: 10,
};

const codeSurface: RegisteredCraftSurfaceContribution = {
  pluginId: FIRST_PARTY_CODE_PLUGIN_ID,
  sourceKey: "code",
  key: FIRST_PARTY_CODE_SURFACE_KEY,
  title: "Code",
  defaultTitle: "Code",
  urlTemplate: "{{origin}}/?folder={{containerRef}}",
  order: 20,
};

const firstPartySurfaces = [agentSurface, codeSurface, formsSurface];

describe("dynamic Craft surfaces", () => {
  it("derives Agent, Code, Beads, plugin Forms, and built-in split pairs from Craft workspace metadata", () => {
    const effective = createEffectiveWorkspaceWithCraftSurfaces({
      workspace: {
        ...workspace,
        tabGroups: [
          {
            id: "craft_workspace",
            label: "Workspace Craft",
            workspace: {
              workspaceId: "workspace_1",
              workspaceDir: "/home/vkuser/repos/app",
            },
            tabs: [],
            pairs: [],
            order: 0,
          },
        ],
      },
      craftSurfaces: firstPartySurfaces,
      origin: "https://vd.example.test",
    });

    expect(
      effective.tabGroups[0]!.tabs.map((tab) => [tab.id, tab.title, tab.url]),
    ).toEqual([
      ["agent", "Agent", "https://vd.example.test/workspaces/workspace_1"],
      [
        "code",
        "Code",
        "https://vd.example.test/?folder=%2Fhome%2Fvkuser%2Frepos%2Fapp",
      ],
      ["beads", "Beads", "https://beads-web.vd.example.test"],
      ["forms", "Forms", "internal://forms"],
    ]);
    expect(effective.tabGroups[0]!.tabs.find((tab) => tab.id === "forms")?.ephemeral)
      .toEqual({
        kind: "craft-surface",
        pluginId: FIRST_PARTY_FORMS_PLUGIN_ID,
        surfaceKey: FIRST_PARTY_FORMS_SURFACE_KEY,
        sourceKey: "forms",
      });
    expect(effective.tabGroups[0]!.tabs.find((tab) => tab.id === "agent")?.ephemeral)
      .toMatchObject({
        kind: "craft-surface",
        pluginId: FIRST_PARTY_AGENT_PLUGIN_ID,
        surfaceKey: FIRST_PARTY_AGENT_SURFACE_KEY,
      });
    expect(effective.tabGroups[0]!.tabs.find((tab) => tab.id === "code")?.ephemeral)
      .toMatchObject({
        kind: "craft-surface",
        pluginId: FIRST_PARTY_CODE_PLUGIN_ID,
        surfaceKey: FIRST_PARTY_CODE_SURFACE_KEY,
      });
    expect(effective.tabGroups[0]!.pairs).toEqual([
      { id: "agent+code", tabIds: ["agent", "code"], ratios: [50, 50] },
      { id: "agent+beads", tabIds: ["agent", "beads"], ratios: [50, 50] },
    ]);
  });

  it("keeps product Agent tabs on real VK workspace URLs even when the harness flag is set", () => {
    const previous = process.env.VD_DOCKVIEW_M3_2_HARNESS;
    process.env.VD_DOCKVIEW_M3_2_HARNESS = "1";
    try {
      const effective = createEffectiveWorkspaceWithCraftSurfaces({
        workspace: {
          ...workspace,
          tabGroups: [
            {
              id: "craft_workspace",
              label: "Workspace Craft",
              workspace: {
                workspaceId: "workspace-a",
                workspaceDir: "/tmp/dockview-m3-2-harness",
              },
              tabs: [],
              pairs: [],
              order: 0,
            },
          ],
        },
        craftSurfaces: [agentSurface],
        origin: "http://127.0.0.1:4400",
      });

      expect(effective.tabGroups[0]!.tabs.find((tab) => tab.id === "agent")?.url)
        .toBe("http://127.0.0.1:4400/workspaces/workspace-a");
    } finally {
      if (previous === undefined) {
        delete process.env.VD_DOCKVIEW_M3_2_HARNESS;
      } else {
        process.env.VD_DOCKVIEW_M3_2_HARNESS = previous;
      }
    }
  });

  it("strips port-prefixed subdomains from Agent and Code built-in workspace tab URLs", () => {
    const effective = createEffectiveWorkspaceWithCraftSurfaces({
      workspace: {
        ...workspace,
        tabGroups: [
          {
            id: "craft_workspace",
            label: "Workspace Craft",
            workspace: {
              workspaceId: "workspace_1",
              workspaceDir: "/home/vkuser/repos/app",
            },
            tabs: [],
            pairs: [],
            order: 0,
          },
        ],
      },
      craftSurfaces: [agentSurface, codeSurface],
      origin: "https://port-5173.example.com",
    });

    const tabsById = new Map(
      effective.tabGroups[0]!.tabs.map((tab) => [tab.id, tab.url]),
    );
    expect(tabsById.get("agent")).toBe(
      "https://example.com/workspaces/workspace_1",
    );
    expect(tabsById.get("code")).toBe(
      "https://example.com/?folder=%2Fhome%2Fvkuser%2Frepos%2Fapp",
    );
    expect(tabsById.get("beads")).toBe("https://beads-web.example.com");
  });

  it("uses the current origin for built-in workspace tabs", () => {
    const effective = createEffectiveWorkspaceWithCraftSurfaces({
      workspace: {
        ...workspace,
        tabGroups: [
          {
            id: "craft_workspace",
            label: "Workspace Craft",
            workspace: {
              workspaceId: "workspace_1",
              workspaceDir: "/home/vkuser/repos/app",
            },
            tabs: [],
            pairs: [],
            order: 0,
          },
        ],
      },
      craftSurfaces: [agentSurface, codeSurface],
      origin: "http://code-vibe:3001",
    });

    const tabsById = new Map(
      effective.tabGroups[0]!.tabs.map((tab) => [tab.id, tab.url]),
    );
    expect(tabsById.get("agent")).toBe(
      "http://code-vibe:3001/workspaces/workspace_1",
    );
    expect(tabsById.get("code")).toBe(
      "http://code-vibe:3001/?folder=%2Fhome%2Fvkuser%2Frepos%2Fapp",
    );
  });

  it("includes first-party Forms even when external plugin targets are not authorized", () => {
    const effective = createEffectiveWorkspaceWithCraftSurfaces({
      workspace: {
        ...workspace,
        tabGroups: [
          {
            id: "craft_workspace",
            label: "Workspace Craft",
            workspace: {
              workspaceId: "workspace_1",
              workspaceDir: "/home/vkuser/repos/app",
            },
            tabs: [],
            pairs: [],
            order: 0,
          },
        ],
      },
      craftSurfaces: [...firstPartySurfaces, ...surfaces],
      allowedPluginTargetsByCraftId: { craft_workspace: [] },
      origin: "https://vd.example.test",
    });

    expect(effective.tabGroups[0]!.tabs.map((tab) => tab.id)).toContain("forms");
    expect(effective.tabGroups[0]!.tabs.some((tab) => tab.title === "Notes")).toBe(false);
  });

  it("derives built-in workspace tabs from the current localhost origin", () => {
    const effective = createEffectiveWorkspaceWithCraftSurfaces({
      workspace: {
        ...workspace,
        tabGroups: [
          {
            id: "craft_workspace",
            label: "Workspace Craft",
            workspace: {
              workspaceId: "workspace_1",
              workspaceDir: "/home/vkuser/repos/app",
            },
            tabs: [],
            pairs: [],
            order: 0,
          },
        ],
      },
      craftSurfaces: firstPartySurfaces,
      origin: "http://localhost:3001",
    });

    expect(
      effective.tabGroups[0]!.tabs.map((tab) => [tab.id, tab.title, tab.url]),
    ).toEqual([
      ["agent", "Agent", "http://localhost:3001/workspaces/workspace_1"],
      [
        "code",
        "Code",
        "http://localhost:3001/?folder=%2Fhome%2Fvkuser%2Frepos%2Fapp",
      ],
      ["beads", "Beads", "http://beads-web.localhost:3001"],
      ["forms", "Forms", "internal://forms"],
    ]);
  });

  it("uses VITE_VK_BASE_ORIGIN for built-in workspace tabs when configured", () => {
    vi.stubEnv("VITE_VK_BASE_ORIGIN", "http://localhost:4100");
    try {
      const effective = createEffectiveWorkspaceWithCraftSurfaces({
        workspace: {
          ...workspace,
          tabGroups: [
            {
              id: "craft_workspace",
              label: "Workspace Craft",
              workspace: {
                workspaceId: "workspace_1",
                workspaceDir: "/home/vkuser/repos/app",
              },
              tabs: [],
              pairs: [],
              order: 0,
            },
          ],
        },
        craftSurfaces: firstPartySurfaces,
        origin: "http://localhost:4101",
      });

      expect(
        effective.tabGroups[0]!.tabs.map((tab) => [tab.id, tab.title, tab.url]),
      ).toEqual([
        ["agent", "Agent", "http://localhost:4100/workspaces/workspace_1"],
        [
          "code",
          "Code",
          "http://localhost:4100/?folder=%2Fhome%2Fvkuser%2Frepos%2Fapp",
        ],
        ["beads", "Beads", "http://beads-web.localhost:4101"],
        ["forms", "Forms", "internal://forms"],
      ]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("routes beads-web to the proxy root instead of nesting under localhost or mysite.com subdomains", () => {
    const urls = [
      "http://sub.localhost:3001",
      "https://sub.mysite.com",
      "https://workspace.sub.mysite.com",
    ].map((origin) => {
      const effective = createEffectiveWorkspaceWithCraftSurfaces({
        workspace: {
          ...workspace,
          tabGroups: [
            {
              id: "craft_workspace",
              label: "Workspace Craft",
              workspace: {
                workspaceId: "workspace_1",
                workspaceDir: "/home/vkuser/repos/app",
              },
              tabs: [],
              pairs: [],
              order: 0,
            },
          ],
        },
        craftSurfaces: [],
        origin,
      });

      return effective.tabGroups[0]!.tabs.find((tab) => tab.id === "beads")
        ?.url;
    });

    expect(urls).toEqual([
      "http://beads-web.localhost:3001",
      "https://beads-web.mysite.com",
      "https://beads-web.mysite.com",
    ]);
  });

  it("derives direct beads-web port URLs for IP-hosted workspaces", () => {
    const effective = createEffectiveWorkspaceWithCraftSurfaces({
      workspace: {
        ...workspace,
        tabGroups: [
          {
            id: "craft_workspace",
            label: "Workspace Craft",
            workspace: {
              workspaceId: "workspace_1",
              workspaceDir: "/home/vkuser/repos/app",
            },
            tabs: [],
            pairs: [],
            order: 0,
          },
        ],
      },
      craftSurfaces: [],
      origin: "http://127.0.0.1:3001",
    });

    expect(
      effective.tabGroups[0]!.tabs.find((tab) => tab.id === "beads")?.url,
    ).toBe("http://127.0.0.1:3109");
  });

  it("brackets IPv6 direct beads-web port URLs", () => {
    const effective = createEffectiveWorkspaceWithCraftSurfaces({
      workspace: {
        ...workspace,
        tabGroups: [
          {
            id: "craft_workspace",
            label: "Workspace Craft",
            workspace: {
              workspaceId: "workspace_1",
              workspaceDir: "/home/vkuser/repos/app",
            },
            tabs: [],
            pairs: [],
            order: 0,
          },
        ],
      },
      craftSurfaces: [],
      origin: "http://[::1]:3001",
    });

    expect(
      effective.tabGroups[0]!.tabs.find((tab) => tab.id === "beads")?.url,
    ).toBe("http://[::1]:3109");
  });

  it("keeps create-workspace tabs even though their URL is under /workspaces", () => {
    const effective = createEffectiveWorkspaceWithCraftSurfaces({
      workspace: {
        ...workspace,
        tabGroups: [
          {
            id: "craft_create_workspace",
            label: "Create Workspace",
            tabs: [
              {
                id: "tab_create_workspace",
                title: "Create Workspace",
                url: "https://vd.example.test/workspaces",
              },
            ],
            pairs: [],
            order: 0,
          },
        ],
      },
      craftSurfaces: [],
      origin: "https://vd.example.test",
    });

    expect(effective.tabGroups[0]!.tabs).toEqual([
      {
        id: "tab_create_workspace",
        title: "Create Workspace",
        url: "https://vd.example.test/workspaces",
      },
    ]);
  });

  it("keeps custom Agent tabs on non-workspace Crafts", () => {
    const effective = createEffectiveWorkspaceWithCraftSurfaces({
      workspace: {
        ...workspace,
        tabGroups: [
          {
            id: "craft_custom_agent",
            label: "Custom Agent Craft",
            tabs: [
              {
                id: "tab_agent",
                title: "Agent",
                url: "https://example.invalid/agent",
              },
            ],
            pairs: [],
            order: 0,
          },
        ],
      },
      craftSurfaces: [],
      origin: "https://vd.example.test",
    });

    expect(effective.tabGroups[0]!.tabs).toEqual([
      {
        id: "tab_agent",
        title: "Agent",
        url: "https://example.invalid/agent",
      },
    ]);
  });

  it("migrates old persisted Agent and Code tabs into Craft workspace metadata", () => {
    const migrated = migrateWorkspaceBuiltInTabs({
      spaces: [
        {
          id: "space_home",
          name: "Home",
          icon: "home",
          tabGroupIds: ["craft_legacy"],
        },
      ],
      tabGroups: [
        {
          id: "craft_legacy",
          label: "Legacy Craft",
          tabs: [
            {
              id: "tab_agent",
              title: "Agent",
              url: "https://vd.example.test/workspaces/workspace_1",
            },
            {
              id: "tab_code",
              title: "Code",
              url: "https://vd.example.test/?folder=/home/vkuser/repos/app",
            },
            {
              id: "tab_custom",
              title: "Docs",
              url: "https://example.test/docs",
            },
          ],
          pairs: [
            {
              id: "pair_legacy",
              tabIds: ["tab_agent", "tab_code"],
              ratios: [50, 50],
            },
          ],
          order: 0,
        },
      ],
      nextId: 4,
    });

    expect(migrated.tabGroups[0]).toMatchObject({
      workspace: {
        workspaceId: "workspace_1",
        workspaceDir: "/home/vkuser/repos/app",
      },
      tabs: [
        { id: "tab_custom", title: "Docs", url: "https://example.test/docs" },
      ],
      pairs: [],
    });
  });
  it("adds plugin-provided ephemeral placeholder tabs to every Craft without mutating persisted workspace state", () => {
    const effective = createEffectiveWorkspaceWithCraftSurfaces({
      workspace,
      craftSurfaces: surfaces,
      origin: "https://vd.example.test",
    });

    expect(workspace.tabGroups[0]!.tabs.map((tab) => tab.id)).toEqual([
      "tab_existing",
    ]);
    expect(
      effective.tabGroups.map((craft) => craft.tabs.map((tab) => tab.id)),
    ).toEqual([
      [
        "craft-surface:craft_1:app.example.notes/notes",
        "craft-surface:craft_1:app.excalidraw.canvas/canvas",
        "tab_existing",
      ],
      [
        "craft-surface:craft_2:app.example.notes/notes",
        "craft-surface:craft_2:app.excalidraw.canvas/canvas",
      ],
    ]);
    expect(effective.tabGroups[0]!.tabs[0]).toMatchObject({
      title: "Notes",
      url: "https://vd.example.test/",
      pinned: true,
      ephemeral: {
        kind: "craft-surface",
        pluginId: "app.example.notes",
        sourceKey: "notes",
      },
    });
    expect(isEphemeralCraftSurfaceTab(effective.tabGroups[0]!.tabs[0])).toBe(
      true,
    );
  });

  it("does not duplicate a placeholder that is already present in a Craft", () => {
    const effective = createEffectiveWorkspaceWithCraftSurfaces({
      workspace: {
        ...workspace,
        tabGroups: [
          {
            ...workspace.tabGroups[0]!,
            tabs: [
              ...workspace.tabGroups[0]!.tabs,
              {
                id: "craft-surface:craft_1:app.example.notes/notes",
                title: "Notes",
                url: "https://vd.example.test/",
                pinned: true,
              },
            ],
          },
        ],
      },
      craftSurfaces: surfaces,
      origin: "https://vd.example.test",
    });

    expect(
      effective.tabGroups[0]!.tabs.filter(
        (tab) =>
          tab.id === "craft-surface:craft_1:app.example.notes/notes",
      ),
    ).toHaveLength(1);
  });

  it("strips ephemeral placeholders and pairs before workspace state can be persisted", () => {
    const effective = createEffectiveWorkspaceWithCraftSurfaces({
      workspace,
      craftSurfaces: surfaces,
      origin: "https://vd.example.test",
    });
    const syntheticTabId = "craft-surface:craft_1:app.excalidraw.canvas/canvas";
    const pollutedWorkspace: WorkspaceState = {
      ...effective,
      tabGroups: effective.tabGroups.map((tabGroup) =>
        tabGroup.id === "craft_1"
          ? {
              ...tabGroup,
              pairs: [
                {
                  id: "pair_polluted",
                  tabIds: ["tab_existing", syntheticTabId],
                  ratios: [50, 50],
                },
              ],
            }
          : tabGroup,
      ),
    };

    expect(
      tabGroupHasEphemeralCraftSurfaceTab(
        pollutedWorkspace.tabGroups[0]!,
        syntheticTabId,
      ),
    ).toBe(true);
    expect(
      stripEphemeralCraftSurfaceTabsFromWorkspace(pollutedWorkspace),
    ).toEqual(workspace);
  });

  it("drops ephemeral active item selections when a Craft surface is uninstalled", () => {
    const effective = createEffectiveWorkspaceWithCraftSurfaces({
      workspace,
      craftSurfaces: surfaces,
      origin: "https://vd.example.test",
    });

    expect(
      filterEphemeralCraftSurfaceActiveItems(effective, {
        craft_1: "craft-surface:craft_1:app.excalidraw.canvas/canvas",
        craft_2: "craft-surface:craft_2:app.excalidraw.canvas/canvas",
        missing: "craft-surface:missing:app.excalidraw.canvas/canvas",
      }),
    ).toEqual({
      craft_1: "craft-surface:craft_1:app.excalidraw.canvas/canvas",
      craft_2: "craft-surface:craft_2:app.excalidraw.canvas/canvas",
    });

    expect(
      filterEphemeralCraftSurfaceActiveItems(workspace, {
        craft_1: "craft-surface:craft_1:app.excalidraw.canvas/canvas",
      }),
    ).toEqual({});
  });

  it("strips ephemeral placeholders from session active items and voyage view ids", () => {
    const effective = createEffectiveWorkspaceWithCraftSurfaces({
      workspace,
      craftSurfaces: surfaces,
      origin: "https://vd.example.test",
    });
    const syntheticTabId = "craft-surface:craft_1:app.excalidraw.canvas/canvas";
    const pollutedSession: SavedWorkspaceSession = {
      id: "session-1",
      slug: "test-session",
      name: "Test Session",
      createdAt: "2026-06-15T00:00:00.000Z",
      updatedAt: "2026-06-15T00:00:00.000Z",
      activeSpaceId: "space_home",
      activeTabGroupId: "craft_1",
      activeVoyageEntryId: "ve_craft_1",
      voyageEntries: [
        {
          id: "ve_craft_1",
          tabGroupId: "craft_1",
          viewIds: ["tab_existing", syntheticTabId],
        },
      ],
      activeItemsByVoyageEntryId: { ve_craft_1: syntheticTabId },
      visitedTabGroupIds: ["craft_1"],
    };

    expect(
      stripEphemeralCraftSurfaceSessionRefs({
        workspace: effective,
        session: pollutedSession,
      }),
    ).toEqual({
      voyageEntries: [
        { id: "ve_craft_1", tabGroupId: "craft_1", viewIds: ["tab_existing"] },
      ],
      activeItemsByVoyageEntryId: {},
    });
  });

  it("uses the runtime authority's per-Craft contribution grants", () => {
    const effective = createEffectiveWorkspaceWithCraftSurfaces({
      workspace,
      craftSurfaces: surfaces,
      origin: "https://vd.example.test",
      allowedPluginTargetsByCraftId: { craft_1: [surfaces[0]!.key], craft_2: [] },
    });
    expect(effective.tabGroups.find(({ id }) => id === "craft_1")?.tabs.some(({ ephemeral }) => ephemeral?.kind === "craft-surface")).toBe(true);
    expect(effective.tabGroups.find(({ id }) => id === "craft_2")?.tabs.some(({ ephemeral }) => ephemeral?.kind === "craft-surface")).toBe(false);
  });
});

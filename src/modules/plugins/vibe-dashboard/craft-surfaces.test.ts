import { describe, expect, it } from 'vitest';
import {
  createEffectiveWorkspaceWithCraftSurfaces,
  filterEphemeralCraftSurfaceActiveItems,
  isEphemeralCraftSurfaceTab,
  stripEphemeralCraftSurfaceSessionRefs,
  stripEphemeralCraftSurfaceTabsFromWorkspace,
  tabGroupHasEphemeralCraftSurfaceTab,
} from './craft-surfaces';
import type { SavedWorkspaceSession, WorkspaceState } from '../../../types';
import type { RegisteredCraftSurfaceContribution } from './types';

const workspace: WorkspaceState = {
  spaces: [{ id: 'space_home', name: 'Home', icon: 'home', tabGroupIds: ['craft_1', 'craft_2'] }],
  tabGroups: [
    { id: 'craft_1', label: 'Craft 1', tabs: [{ id: 'tab_existing', title: 'Existing', url: '/' }], pairs: [], order: 0 },
    { id: 'craft_2', label: 'Craft 2', tabs: [], pairs: [], order: 1 },
  ],
  nextId: 3,
};

const surfaces: RegisteredCraftSurfaceContribution[] = [
  {
    pluginId: 'dev.mickmister.vibe-kanban',
    sourceKey: 'board',
    key: 'dev.mickmister.vibe-kanban/board',
    title: 'Kanban',
    urlTemplate: '{{origin}}/',
    order: 20,
  },
  {
    pluginId: 'app.excalidraw.canvas',
    sourceKey: 'canvas',
    key: 'app.excalidraw.canvas/canvas',
    title: 'Excalidraw',
    urlTemplate: '/dashboard/plugins/app.excalidraw.canvas/1.0.0/frontend_assets/index.html',
    order: 30,
  },
];

describe('dynamic Craft surfaces', () => {
  it('adds plugin-provided ephemeral placeholder tabs to every Craft without mutating persisted workspace state', () => {
    const effective = createEffectiveWorkspaceWithCraftSurfaces({
      workspace,
      craftSurfaces: surfaces,
      origin: 'https://vd.example.test',
    });

    expect(workspace.tabGroups[0]!.tabs.map((tab) => tab.id)).toEqual(['tab_existing']);
    expect(effective.tabGroups.map((craft) => craft.tabs.map((tab) => tab.id))).toEqual([
      [
        'tab_existing',
        'craft-surface:craft_1:dev.mickmister.vibe-kanban/board',
        'craft-surface:craft_1:app.excalidraw.canvas/canvas',
      ],
      [
        'craft-surface:craft_2:dev.mickmister.vibe-kanban/board',
        'craft-surface:craft_2:app.excalidraw.canvas/canvas',
      ],
    ]);
    expect(effective.tabGroups[0]!.tabs[1]).toMatchObject({
      title: 'Kanban',
      url: 'https://vd.example.test/',
      pinned: true,
      ephemeral: {
        kind: 'craft-surface',
        pluginId: 'dev.mickmister.vibe-kanban',
        sourceKey: 'board',
      },
    });
    expect(isEphemeralCraftSurfaceTab(effective.tabGroups[0]!.tabs[1])).toBe(true);
  });

  it('does not duplicate a placeholder that is already present in a Craft', () => {
    const effective = createEffectiveWorkspaceWithCraftSurfaces({
      workspace: {
        ...workspace,
        tabGroups: [
          {
            ...workspace.tabGroups[0]!,
            tabs: [
              ...workspace.tabGroups[0]!.tabs,
              {
                id: 'craft-surface:craft_1:dev.mickmister.vibe-kanban/board',
                title: 'Kanban',
                url: 'https://vd.example.test/',
                pinned: true,
              },
            ],
          },
        ],
      },
      craftSurfaces: surfaces,
      origin: 'https://vd.example.test',
    });

    expect(
      effective.tabGroups[0]!.tabs.filter(
        (tab) => tab.id === 'craft-surface:craft_1:dev.mickmister.vibe-kanban/board',
      ),
    ).toHaveLength(1);
  });

  it('strips ephemeral placeholders and pairs before workspace state can be persisted', () => {
    const effective = createEffectiveWorkspaceWithCraftSurfaces({
      workspace,
      craftSurfaces: surfaces,
      origin: 'https://vd.example.test',
    });
    const syntheticTabId = 'craft-surface:craft_1:app.excalidraw.canvas/canvas';
    const pollutedWorkspace: WorkspaceState = {
      ...effective,
      tabGroups: effective.tabGroups.map((tabGroup) =>
        tabGroup.id === 'craft_1'
          ? {
              ...tabGroup,
              pairs: [
                { id: 'pair_polluted', tabIds: ['tab_existing', syntheticTabId], ratios: [50, 50] },
              ],
            }
          : tabGroup,
      ),
    };

    expect(
      tabGroupHasEphemeralCraftSurfaceTab(pollutedWorkspace.tabGroups[0]!, syntheticTabId),
    ).toBe(true);
    expect(stripEphemeralCraftSurfaceTabsFromWorkspace(pollutedWorkspace)).toEqual(workspace);
  });

  it('drops ephemeral active item selections when a Craft surface is uninstalled', () => {
    const effective = createEffectiveWorkspaceWithCraftSurfaces({
      workspace,
      craftSurfaces: surfaces,
      origin: 'https://vd.example.test',
    });

    expect(
      filterEphemeralCraftSurfaceActiveItems(effective, {
        craft_1: 'craft-surface:craft_1:app.excalidraw.canvas/canvas',
        craft_2: 'craft-surface:craft_2:app.excalidraw.canvas/canvas',
        missing: 'craft-surface:missing:app.excalidraw.canvas/canvas',
      }),
    ).toEqual({
      craft_1: 'craft-surface:craft_1:app.excalidraw.canvas/canvas',
      craft_2: 'craft-surface:craft_2:app.excalidraw.canvas/canvas',
    });

    expect(
      filterEphemeralCraftSurfaceActiveItems(workspace, {
        craft_1: 'craft-surface:craft_1:app.excalidraw.canvas/canvas',
      }),
    ).toEqual({});
  });

  it('strips ephemeral placeholders from session active items and voyage view ids', () => {
    const effective = createEffectiveWorkspaceWithCraftSurfaces({
      workspace,
      craftSurfaces: surfaces,
      origin: 'https://vd.example.test',
    });
    const syntheticTabId = 'craft-surface:craft_1:app.excalidraw.canvas/canvas';
    const pollutedSession: SavedWorkspaceSession = {
      id: 'session-1',
      createdAt: '2026-06-15T00:00:00.000Z',
      updatedAt: '2026-06-15T00:00:00.000Z',
      activeSpaceId: 'space_home',
      activeTabGroupId: 'craft_1',
      activeVoyageEntryId: 've_craft_1',
      voyageEntries: [
        { id: 've_craft_1', tabGroupId: 'craft_1', viewIds: ['tab_existing', syntheticTabId] },
      ],
      activeItemsByVoyageEntryId: { ve_craft_1: syntheticTabId },
      activeItems: { craft_1: syntheticTabId },
      visitedTabGroupIds: ['craft_1'],
    };

    expect(
      stripEphemeralCraftSurfaceSessionRefs({ workspace: effective, session: pollutedSession }),
    ).toEqual({
      voyageEntries: [{ id: 've_craft_1', tabGroupId: 'craft_1', viewIds: ['tab_existing'] }],
      activeItemsByVoyageEntryId: {},
      activeItems: {},
    });
  });
});

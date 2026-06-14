import { describe, expect, it } from 'vitest';
import { createEffectiveWorkspaceWithCraftSurfaces } from './craft-surfaces';
import type { WorkspaceState } from '../../../types';
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
  it('adds plugin-provided placeholder tabs to every Craft without mutating persisted workspace state', () => {
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
    });
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
      effective.tabGroups[0]!.tabs.filter((tab) => tab.id === 'craft-surface:craft_1:dev.mickmister.vibe-kanban/board'),
    ).toHaveLength(1);
  });
});

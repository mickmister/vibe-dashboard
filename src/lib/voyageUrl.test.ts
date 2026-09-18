import { describe, expect, it } from 'vitest';
import {
  buildCanonicalDashboardPath,
  buildCraftParam,
  buildSavedVoyageDashboardPath,
  buildViewParamForTab,
  buildViewParam,
  buildVoyageParam,
  buildVoyageSlug,
  getRuntimeCraftSurfaceViewToken,
  getShortIdToken,
  getStoredLastDashboardUrl,
  parseCraftParam,
  parseViewParam,
  parseViewsParam,
  resolveViewIdsFromViewParam,
  setStoredLastDashboardUrl,
} from './voyageUrl';
import type { Craft, SavedWorkspaceSession, VoyageEntry, WorkspaceState } from '../types';

describe('voyageUrl', () => {
  it('builds stable voyage slugs from labels and short stable ids', () => {
    expect(buildVoyageSlug('Agent + Code', 'session_abc_123')).toBe(
      'agent-code-123',
    );
    expect(buildVoyageSlug(undefined, 'session_456')).toBe('voyage-456');
  });

  it('expands short ids only when needed to avoid scoped collisions', () => {
    expect(getShortIdToken('session_current_a_123', [
      'session_current_a_123',
      'session_current_b_123',
    ])).toBe('a_123');
    expect(getShortIdToken('ve_tg_workspace_42_7', [
      've_tg_workspace_42_7',
      've_tg_workspace_42_8',
    ])).toBe('7');
  });

  it('round-trips craft params by suffix while allowing descriptive labels', () => {
    const craft = {
      id: 'tg_workspace_42',
      label: 'My Workspace',
      tabs: [],
      pairs: [],
      order: 0,
    } satisfies Craft;
    const entry = {
      id: 've_tg_workspace_42_7',
      tabGroupId: craft.id,
      viewIds: ['tab_agent_1'],
    } satisfies VoyageEntry;

    expect(buildCraftParam(craft, entry)).toBe('my-workspace-42-7');
    expect(parseCraftParam('my-workspace-42-7')).toEqual({
      tabGroupSuffix: '42',
      entrySuffix: '7',
    });
  });

  it('builds readable voyage params with scoped short ids', () => {
    const sessions = [
      { id: 'session_current_a_123', name: 'Current A' },
      { id: 'session_current_b_123', name: 'Current B' },
    ] as SavedWorkspaceSession[];

    expect(buildVoyageParam(sessions[0]!, sessions)).toBe('current-a-a_123');
    expect(buildVoyageParam(sessions[1]!, sessions)).toBe('current-b-b_123');
  });

  it('parses ordered view suffixes from view params', () => {
    expect(
      parseViewsParam(
        [
          buildViewParam('Agent', 'tab_agent_1'),
          buildViewParam('Code', 'tab_code_2'),
        ].join(','),
      ),
    ).toEqual(['1', '2']);
  });

  it('builds readable view params with scoped short ids', () => {
    const peerIds = ['tab_agent_left_1', 'tab_agent_right_1'];
    expect(buildViewParam('Agent Left', 'tab_agent_left_1', peerIds)).toBe(
      'agent-left-left_1',
    );
    expect(parseViewParam('agent-left-left_1')).toBe('left_1');
  });

  it('builds stable runtime craft-surface view tokens without short-id suffix collisions', () => {
    const previewSurface = {
      id: 'craft-surface:craft_1:dev.mickmister.preview-server/run-configs',
      title: 'PreviewServer',
      url: 'internal://preview-run-configs',
      ephemeral: {
        kind: 'craft-surface',
        pluginId: 'dev.mickmister.preview-server',
        surfaceKey: 'dev.mickmister.preview-server/run-configs',
        sourceKey: 'run-configs',
      },
    } satisfies Craft['tabs'][number];
    const otherConfigsSurface = {
      id: 'craft-surface:craft_1:dev.example.other/run-configs',
      title: 'Other Configs',
      url: 'internal://other-configs',
      ephemeral: {
        kind: 'craft-surface',
        pluginId: 'dev.example.other',
        surfaceKey: 'dev.example.other/run-configs',
        sourceKey: 'run-configs',
      },
    } satisfies Craft['tabs'][number];

    expect(getRuntimeCraftSurfaceViewToken(previewSurface)).toBe(
      'runtime:dev.mickmister.preview-server/run-configs',
    );
    expect(buildViewParamForTab(previewSurface, [
      previewSurface,
      otherConfigsSurface,
    ])).toBe('runtime:dev.mickmister.preview-server/run-configs');
    expect(buildViewParamForTab(otherConfigsSurface, [
      previewSurface,
      otherConfigsSurface,
    ])).toBe('runtime:dev.example.other/run-configs');
  });

  it('resolves mixed runtime and iframe views from stable view tokens', () => {
    const tabs = [
      { id: 'agent', title: 'Agent', url: '/workspaces/ws1' },
      {
        id: 'craft-surface:craft_1:dev.mickmister.preview-server/run-configs',
        title: 'PreviewServer',
        url: 'internal://preview-run-configs',
        ephemeral: {
          kind: 'craft-surface',
          pluginId: 'dev.mickmister.preview-server',
          surfaceKey: 'dev.mickmister.preview-server/run-configs',
          sourceKey: 'run-configs',
        },
      },
    ] satisfies Craft['tabs'];

    expect(
      resolveViewIdsFromViewParam(
        tabs,
        [
          buildViewParamForTab(tabs[1]!, tabs),
          buildViewParamForTab(tabs[0]!, tabs),
        ].join(','),
      ),
    ).toEqual([
      'craft-surface:craft_1:dev.mickmister.preview-server/run-configs',
      'agent',
    ]);
  });

  it('does not resolve runtime craft surfaces from ambiguous legacy suffixes', () => {
    const tabs = [
      {
        id: 'craft-surface:craft_1:dev.mickmister.preview-server/run-configs',
        title: 'PreviewServer',
        url: 'internal://preview-run-configs',
        ephemeral: {
          kind: 'craft-surface',
          pluginId: 'dev.mickmister.preview-server',
          surfaceKey: 'dev.mickmister.preview-server/run-configs',
          sourceKey: 'run-configs',
        },
      },
      {
        id: 'craft-surface:craft_1:dev.example.other/run-configs',
        title: 'Other Configs',
        url: 'internal://other-configs',
        ephemeral: {
          kind: 'craft-surface',
          pluginId: 'dev.example.other',
          surfaceKey: 'dev.example.other/run-configs',
          sourceKey: 'run-configs',
        },
      },
    ] satisfies Craft['tabs'];

    expect(resolveViewIdsFromViewParam(tabs, 'previewserver-configs')).toEqual(
      [],
    );
  });

  it('preserves unknown dashboard query params while replacing voyage-owned params', () => {
    expect(
      buildCanonicalDashboardPath(
        '?from_gh_url=https%3A%2F%2Fgithub.com%2Fowner%2Frepo%2Fpull%2F1&session=legacy&voyage=old&craft=old&views=old',
        {
          slug: 'focused-session_1',
          craftParam: 'craft-1-2',
          viewTokens: ['agent-1', 'code-2'],
        },
      ),
    ).toBe(
      '/?from_gh_url=https%3A%2F%2Fgithub.com%2Fowner%2Frepo%2Fpull%2F1&voyage=focused-session_1&craft=craft-1-2&views=agent-1%2Ccode-2',
    );
  });

  it('preserves unknown dashboard query params when clearing voyage params', () => {
    expect(
      buildCanonicalDashboardPath(
        '?from_gh_url=https%3A%2F%2Fgithub.com%2Fowner%2Frepo%2Fissues%2F2&voyage=old&craft=old&views=old',
        undefined,
      ),
    ).toBe(
      '/?from_gh_url=https%3A%2F%2Fgithub.com%2Fowner%2Frepo%2Fissues%2F2',
    );
  });

  it('builds the next saved-voyage URL directly from an interaction target', () => {
    const workspace = {
      spaces: [],
      nextId: 0,
      tabGroups: [
        {
          id: 'tg_workspace_42',
          label: 'Workspace',
          tabs: [
            { id: 'tab_agent_1', title: 'Agent', url: 'https://agent.invalid' },
            { id: 'tab_code_2', title: 'Code', url: 'https://code.invalid' },
          ],
          pairs: [],
          order: 0,
        },
      ],
    } satisfies WorkspaceState;
    const session = {
      id: 'session_abc',
      slug: 'focused-session_abc',
      name: 'Focused',
      createdAt: '2026-06-11T00:00:00.000Z',
      updatedAt: '2026-06-11T00:00:00.000Z',
      activeVoyageEntryId: 've_tg_workspace_42',
      voyageEntries: [
        {
          id: 've_tg_workspace_42',
          tabGroupId: 'tg_workspace_42',
          viewIds: ['tab_agent_1'],
        },
      ],
      activeSpaceId: 'space_1',
      activeTabGroupId: 'tg_workspace_42',
      activeItemsByVoyageEntryId: { ve_tg_workspace_42: 'tab_agent_1' },
      visitedTabGroupIds: ['tg_workspace_42'],
    } satisfies SavedWorkspaceSession;

    expect(
      buildSavedVoyageDashboardPath({
        currentSearch: '?from_gh_url=https%3A%2F%2Fgithub.com%2Fowner%2Frepo%2Fpull%2F1&voyage=old&craft=old&views=old',
        workspace,
        session,
        savedSessions: [session],
        voyageEntryId: 've_tg_workspace_42',
        tabId: 'tab_code_2',
      }),
    ).toBe(
      '/?from_gh_url=https%3A%2F%2Fgithub.com%2Fowner%2Frepo%2Fpull%2F1&voyage=focused-abc&craft=workspace-42-42&views=code-2',
    );
  });

  it('builds saved-voyage URLs with runtime view tokens without persisting runtime views', () => {
    const runtimeTabId =
      'craft-surface:tg_workspace_42:dev.mickmister.preview-server/run-configs';
    const workspace = {
      spaces: [],
      nextId: 0,
      tabGroups: [
        {
          id: 'tg_workspace_42',
          label: 'Workspace',
          tabs: [
            { id: 'agent', title: 'Agent', url: '/workspaces/ws1' },
            {
              id: runtimeTabId,
              title: 'PreviewServer',
              url: 'internal://preview-run-configs',
              ephemeral: {
                kind: 'craft-surface',
                pluginId: 'dev.mickmister.preview-server',
                surfaceKey: 'dev.mickmister.preview-server/run-configs',
                sourceKey: 'run-configs',
              },
            },
          ],
          pairs: [],
          order: 0,
        },
      ],
    } satisfies WorkspaceState;
    const session = {
      id: 'session_abc',
      slug: 'focused-session_abc',
      name: 'Focused',
      createdAt: '2026-06-11T00:00:00.000Z',
      updatedAt: '2026-06-11T00:00:00.000Z',
      activeVoyageEntryId: 've_tg_workspace_42',
      voyageEntries: [
        {
          id: 've_tg_workspace_42',
          tabGroupId: 'tg_workspace_42',
          viewIds: ['agent'],
        },
      ],
      activeSpaceId: 'space_1',
      activeTabGroupId: 'tg_workspace_42',
      activeItemsByVoyageEntryId: { ve_tg_workspace_42: 'agent' },
      visitedTabGroupIds: ['tg_workspace_42'],
    } satisfies SavedWorkspaceSession;

    expect(
      buildSavedVoyageDashboardPath({
        currentSearch: '?voyage=old&craft=old&views=old',
        workspace,
        session,
        savedSessions: [session],
        voyageEntryId: 've_tg_workspace_42',
        viewIds: [runtimeTabId, 'agent'],
      }),
    ).toBe(
      '/?voyage=focused-abc&craft=workspace-42-42&views=runtime%3Adev.mickmister.preview-server%2Frun-configs%2Cagent-agent',
    );

    expect(session.voyageEntries[0]!.viewIds).toEqual(['agent']);
  });

  it('stores only canonical root Voyage URLs with a voyage param as resume hints', () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    };

    setStoredLastDashboardUrl(
      '/dashboard?from_gh_url=https%3A%2F%2Fgithub.com%2Fowner%2Frepo%2Fpull%2F1&voyage=focused-session_abc&craft=workspace-42-42&views=agent-1',
      storage,
    );
    expect(getStoredLastDashboardUrl(storage)).toBe(
      '/?voyage=focused-session_abc&craft=workspace-42-42&views=agent-1',
    );

    setStoredLastDashboardUrl('/dashboard?craft=workspace-42-42', storage);
    expect(getStoredLastDashboardUrl(storage)).toBeUndefined();

    setStoredLastDashboardUrl('/settings?voyage=focused-session_abc', storage);
    expect(getStoredLastDashboardUrl(storage)).toBeUndefined();
  });
});

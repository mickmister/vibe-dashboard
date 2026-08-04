import { describe, expect, it } from 'vitest';
import {
  createSavedWorkspaceSessionState,
  getSavedWorkspaceSessions,
  isSavedWorkspaceSessionStateMigrated,
  migrateSavedWorkspaceSessionState,
  migrateSavedWorkspaceSessionStateWithCleanup,
  upsertSavedWorkspaceSessionState,
} from './savedVoyageState';
import type { SavedWorkspaceSession, SavedWorkspaceSessionV1 } from '../types';

function legacySession(id: string): SavedWorkspaceSessionV1 {
  return {
    id,
    createdAt: '2026-06-02T00:00:00.000Z',
    updatedAt: '2026-06-02T00:00:00.000Z',
    activeSpaceId: 'space_home',
    activeTabGroupId: 'tg_1',
    activeItems: { tg_1: 'tab_1' },
    visitedTabGroupIds: ['tg_1'],
  };
}

function session(id: string): SavedWorkspaceSession {
  const entry = { id: 've_tg_1', tabGroupId: 'tg_1', viewIds: ['tab_1'] };
  return {
    id,
    slug: `saved-voyage-${id}`,
    name: '',
    createdAt: '2026-06-02T00:00:00.000Z',
    updatedAt: '2026-06-02T00:00:00.000Z',
    activeVoyageEntryId: entry.id,
    voyageEntries: [entry],
    activeSpaceId: 'space_home',
    activeTabGroupId: 'tg_1',
    activeItemsByVoyageEntryId: { [entry.id]: 'tab_1' },
    visitedTabGroupIds: ['tg_1'],
  };
}

describe('savedVoyageState migration', () => {
  it('migrates legacy array state to versioned data', () => {
    const legacy = [legacySession('a')];

    expect(migrateSavedWorkspaceSessionState(legacy)).toEqual({
      version: 3,
      data: [session('a')],
    });
  });

  it('migrates legacy sessions-object state to versioned data', () => {
    const legacy = {
      sessions: [
        legacySession('a'),
        {
          ...legacySession('b'),
          activeTabGroupId: 'tg_2',
          activeItems: { tg_2: 'tab_2' },
          visitedTabGroupIds: ['tg_2'],
        },
      ],
    };

    expect(migrateSavedWorkspaceSessionState(legacy)).toEqual({
      version: 3,
      data: [session('a'), {
        ...session('b'),
        activeTabGroupId: 'tg_2',
        activeVoyageEntryId: 've_tg_2',
        voyageEntries: [{ id: 've_tg_2', tabGroupId: 'tg_2', viewIds: ['tab_2'] }],
        activeItemsByVoyageEntryId: { ve_tg_2: 'tab_2' },
        visitedTabGroupIds: ['tg_2'],
      }],
    });
  });

  it('reads migrated state without changing data', () => {
    const migrated = createSavedWorkspaceSessionState([session('a')]);

    expect(isSavedWorkspaceSessionStateMigrated(migrated)).toBe(true);
    expect(getSavedWorkspaceSessions(migrated)).toEqual([session('a')]);
  });

  it('ignores malformed persisted session records instead of throwing', () => {
    expect(() =>
      getSavedWorkspaceSessions([
        null,
        'bad',
        { id: 123 },
        legacySession('valid'),
      ]),
    ).not.toThrow();

    expect(
      getSavedWorkspaceSessions([
        null,
        'bad',
        { id: 123 },
        legacySession('valid'),
      ]),
    ).toEqual([session('valid')]);
  });

  it('migrates legacy active pair items to split view ids when workspace metadata is available', () => {
    const legacy = {
      ...legacySession('split'),
      activeItems: { tg_1: 'pair_agent_code' },
      visitedTabGroupIds: ['tg_1'],
    };

    expect(
      migrateSavedWorkspaceSessionState([legacy], {
        workspace: {
          tabGroups: [
            {
              id: 'tg_1',
              label: 'Agent + Code',
              tabs: [
                { id: 'tab_agent', title: 'Agent', url: 'about:blank' },
                { id: 'tab_code', title: 'Code', url: 'about:blank' },
              ],
              pairs: [
                {
                  id: 'pair_agent_code',
                  tabIds: ['tab_agent', 'tab_code'],
                  ratios: [50, 50],
                },
              ],
              order: 0,
            },
          ],
        },
      }),
    ).toEqual({
      version: 3,
      data: [
        {
          ...session('split'),
          activeVoyageEntryId: 've_tg_1',
          voyageEntries: [
            {
              id: 've_tg_1',
              tabGroupId: 'tg_1',
              viewIds: ['tab_agent', 'tab_code'],
            },
          ],
          activeItemsByVoyageEntryId: {
            ve_tg_1: 'pair_agent_code',
          },
        },
      ],
    });
  });

  it('removes home voyages by explicit name or active craft label', () => {
    const explicitHome = { ...session('home_name'), name: 'Home' };
    const implicitHome = {
      ...session('home_label'),
      activeTabGroupId: 'tg_home',
      activeVoyageEntryId: 've_tg_home',
      voyageEntries: [{ id: 've_tg_home', tabGroupId: 'tg_home', viewIds: [] }],
      activeItemsByVoyageEntryId: { ve_tg_home: '' },
      visitedTabGroupIds: ['tg_home'],
    };
    const realVoyage = { ...session('real'), name: 'Real voyage' };

    expect(
      migrateSavedWorkspaceSessionStateWithCleanup(
        [explicitHome, implicitHome, realVoyage],
        {
          workspace: {
            tabGroups: [
              {
                id: 'tg_home',
                label: 'Home',
                tabs: [],
                pairs: [],
                order: 0,
              },
            ],
          },
        },
      ).state,
    ).toEqual({
      version: 3,
      data: [realVoyage],
    });
  });

  it('dedupes duplicate voyages to the best keeper', () => {
    const older = {
      ...session('older'),
      name: 'Pairing',
      updatedAt: '2026-06-01T00:00:00.000Z',
    };
    const newer = {
      ...session('newer'),
      name: 'Pairing',
      updatedAt: '2026-06-02T00:00:00.000Z',
    };
    const other = { ...session('other'), name: 'Other' };

    const result = migrateSavedWorkspaceSessionStateWithCleanup([
      older,
      newer,
      other,
    ]);

    expect(result.state).toEqual({
      version: 3,
      data: [newer, other],
    });
  });

  it('treats pre-v3 state as a single legacy-to-cleaned-state migration', () => {
    const home = { ...session('home'), name: 'Home' };
    const duplicateOlder = {
      ...session('duplicate-older'),
      name: 'Focused voyage',
      updatedAt: '2026-06-01T00:00:00.000Z',
    };
    const duplicateNewer = {
      ...session('duplicate-newer'),
      name: 'Focused voyage',
      updatedAt: '2026-06-03T00:00:00.000Z',
    };

    const result = migrateSavedWorkspaceSessionStateWithCleanup({
      sessions: [home, duplicateOlder, duplicateNewer],
    });

    expect(result.state).toEqual({
      version: 3,
      data: [duplicateNewer],
    });
  });
});

describe('saved voyage upsert', () => {
  it('updates an existing voyage and persists flow mode', () => {
    const existing = { ...session('a'), name: 'Existing' };
    const updated = {
      ...existing,
      name: 'Updated',
      flowModeType: 'priority' as const,
    };

    expect(
      upsertSavedWorkspaceSessionState(
        createSavedWorkspaceSessionState([existing]),
        updated,
      ),
    ).toEqual({
      version: 3,
      data: [{ ...updated, slug: 'updated-a' }],
    });
  });

  it('adds a new voyage with flow mode before existing voyages', () => {
    const existing = { ...session('a'), name: 'Existing' };
    const added = {
      ...session('b'),
      name: 'Added',
      flowModeType: 'static' as const,
    };

    expect(
      upsertSavedWorkspaceSessionState(
        createSavedWorkspaceSessionState([existing]),
        added,
      ),
    ).toEqual({
      version: 3,
      data: [{ ...added, slug: 'added-b' }, existing],
    });
  });
});

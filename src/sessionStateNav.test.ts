// @vitest-environment jsdom
import React, { useEffect } from 'react';
import { render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useSessionWorkspaceNav } from './sessionState';
import type { SessionWorkspaceNav } from './sessionState';
import type {
  SavedWorkspaceSession,
  WorkspaceState,
} from './types';

function workspace(): WorkspaceState {
  return {
    nextId: 0,
    spaces: [
      {
        id: 'space_home',
        name: 'Home',
        icon: '🏠',
        tabGroupIds: ['tg_old', 'tg_new'],
      },
    ],
    tabGroups: [
      {
        id: 'tg_old',
        label: 'Old Craft',
        order: 0,
        tabs: [{ id: 'tab_old_agent', title: 'Agent', url: 'https://old.invalid' }],
        pairs: [],
      },
      {
        id: 'tg_new',
        label: 'New Craft',
        order: 1,
        tabs: [{ id: 'tab_new_agent', title: 'Agent', url: 'https://new.invalid' }],
        pairs: [],
      },
    ],
  };
}

function savedSession(activeVoyageEntryId: 've_old' | 've_new'): SavedWorkspaceSession {
  return {
    id: 'session_1',
    slug: 'focused-session-1',
    name: 'Focused',
    createdAt: '2026-08-05T00:00:00.000Z',
    updatedAt: '2026-08-05T00:00:00.000Z',
    activeSpaceId: 'space_home',
    activeTabGroupId: activeVoyageEntryId === 've_new' ? 'tg_new' : 'tg_old',
    activeVoyageEntryId,
    voyageEntries: [
      { id: 've_old', tabGroupId: 'tg_old', viewIds: ['tab_old_agent'] },
      { id: 've_new', tabGroupId: 'tg_new', viewIds: ['tab_new_agent'] },
    ],
    voyageLayout: {
      version: 1,
      rows: 1,
      cols: 1,
      activeCellId: 'cell_main',
      cells: [
        {
          id: 'cell_main',
          row: 0,
          col: 0,
          activeVoyageEntryId,
          voyageEntries: [
            { id: 've_old', tabGroupId: 'tg_old', viewIds: ['tab_old_agent'] },
            { id: 've_new', tabGroupId: 'tg_new', viewIds: ['tab_new_agent'] },
          ],
        },
      ],
    },
    activeItemsByVoyageEntryId: {
      ve_old: 'tab_old_agent',
      ve_new: 'tab_new_agent',
    },
    visitedTabGroupIds: ['tg_old', 'tg_new'],
  };
}

function NavProbe({
  route,
  session,
  onNav,
}: {
  route: Parameters<typeof useSessionWorkspaceNav>[1];
  session: SavedWorkspaceSession;
  onNav: (nav: SessionWorkspaceNav) => void;
}) {
  const nav = useSessionWorkspaceNav(workspace(), route, session, {
    persistToSessionStorage: false,
  });

  useEffect(() => {
    onNav(nav);
  }, [nav, onNav]);

  return null;
}

describe('useSessionWorkspaceNav route/session synchronization', () => {
  it('does not let a stale route craft override a saved Voyage activation that completed first', async () => {
    const onNav = vi.fn();
    const staleOldRoute = {
      spaceId: 'space_home',
      tabGroupId: 'tg_old',
      itemId: 'tab_old_agent',
      voyageEntryId: 've_old',
      viewIds: ['tab_old_agent'],
    };

    const { rerender } = render(
      React.createElement(NavProbe, {
        route: staleOldRoute,
        session: savedSession('ve_old'),
        onNav,
      }),
    );

    await waitFor(() => {
      expect(onNav).toHaveBeenLastCalledWith(
        expect.objectContaining({ activeVoyageEntryId: 've_old' }),
      );
    });

    rerender(
      React.createElement(NavProbe, {
        route: staleOldRoute,
        session: savedSession('ve_new'),
        onNav,
      }),
    );

    await waitFor(() => {
      expect(onNav).toHaveBeenLastCalledWith(
        expect.objectContaining({
          activeVoyageEntryId: 've_new',
          activeTabGroupId: 'tg_new',
        }),
      );
    });
  });
});

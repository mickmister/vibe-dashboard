/* eslint-disable formatjs/no-literal-string-in-object */
import { describe, expect, it } from 'vitest';
import type { SavedWorkspaceSession, WorkspaceState } from '../types';
import { resolveDashboardFocusSelection } from './dashboardRouteIntent';

const workspace = {
  spaces: [{ id: 'space-a', name: 'Space', icon: '🚀', tabGroupIds: ['tg_alpha_1'] }],
  nextId: 0,
  tabGroups: [{
    id: 'tg_alpha_1',
    label: 'Alpha Craft',
    tabs: [
      { id: 'panel_agent_1', title: 'Agent', url: 'https://agent.invalid' },
      { id: 'panel_code_2', title: 'Code', url: 'https://code.invalid' },
    ],
    pairs: [],
    order: 0,
  }],
} satisfies WorkspaceState;

const collidingWorkspace = {
  ...workspace,
  tabGroups: [{
    ...workspace.tabGroups[0]!,
    tabs: [
      { id: 'panel_agent_1', title: 'Agent', url: 'https://agent.invalid' },
      { id: 'panel_code_1', title: 'Code', url: 'https://code.invalid' },
    ],
  }],
} satisfies WorkspaceState;

const session = {
  id: 'voyage_alpha_1',
  slug: 'alpha-voyage',
  name: 'Alpha Voyage',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  activeVoyageEntryId: 've_alpha_1',
  voyageEntries: [{ id: 've_alpha_1', tabGroupId: 'tg_alpha_1', viewIds: ['panel_agent_1'] }],
  activeSpaceId: 'space-a',
  activeTabGroupId: 'tg_alpha_1',
  activeItemsByVoyageEntryId: { ve_alpha_1: 'panel_agent_1' },
  visitedTabGroupIds: ['tg_alpha_1'],
} satisfies SavedWorkspaceSession;

describe('resolveDashboardFocusSelection', () => {
  it('does not fall back to Craft MRU when requested panel is invalid', () => {
    expect(resolveDashboardFocusSelection(
      workspace,
      session,
      'alpha-craft-1-1',
      'missing-panel',
      undefined,
    )).toEqual({ focusStatus: 'invalid', focusReason: 'panel-not-found' });
  });

  it('does not fall back to Craft MRU when requested legacy views are invalid', () => {
    expect(resolveDashboardFocusSelection(
      workspace,
      session,
      'alpha-craft-1-1',
      undefined,
      'plugin-panel-99',
    )).toEqual({ focusStatus: 'invalid', focusReason: 'views-not-found' });
  });

  it('does not guess colliding panel tokens', () => {
    expect(resolveDashboardFocusSelection(
      collidingWorkspace,
      session,
      'alpha-craft-1-1',
      'panel-1',
      undefined,
    )).toEqual({ focusStatus: 'invalid', focusReason: 'panel-not-found' });
  });

  it('resolves exact valid panel focus', () => {
    expect(resolveDashboardFocusSelection(
      workspace,
      session,
      'alpha-craft-1-1',
      'code-2',
      undefined,
    )).toMatchObject({
      focusStatus: 'valid',
      itemId: 'panel_code_2',
      viewIds: ['panel_code_2'],
    });
  });
});

/* eslint-disable formatjs/no-literal-string-in-object */
import { describe, expect, it } from 'vitest';
import type { SavedWorkspaceSession, WorkspaceState } from '../types';
import {
  buildCanonicalDashboardPath,
  buildSavedVoyageDashboardPath,
  buildViewParam,
  buildVoyageParam,
  hasHomepageLegacyDashboardToken,
  normalizeStoredDashboardUrl,
  parseViewsParam,
  resolveFocusToken,
  resolveFocusTokens,
} from './voyageUrl';
import { resolveDashboardVoyage, resolveRequestedVoyageSessionId } from './voyageSession';

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

const savedSession = {
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

describe('DockView M4.2 route preservation contracts', () => {
  it('TEST_CASE_M4_2A keeps root canonical while preserving unrelated query params', () => {
    expect(buildCanonicalDashboardPath('?ref=abc&session=old&voyage=old&craft=old&panel=old', undefined))
      .toBe('/?ref=abc');
  });

  it('TEST_CASE_M4_2B resolves canonical Voyage/Craft/Panel slug and short-token intent', () => {
    expect(resolveRequestedVoyageSessionId({
      savedSessions: [savedSession],
      requestedVoyageKey: buildVoyageParam(savedSession, [savedSession]),
    })).toBe(savedSession.id);
    expect(buildSavedVoyageDashboardPath({
      currentSearch: '?ref=abc',
      workspace,
      session: savedSession,
      savedSessions: [savedSession],
      tabId: 'panel_code_2',
    })).toBe('/?ref=abc&voyage=alpha-voyage-1&craft=alpha-craft-1-1&panel=code-2');
  });

  it('TEST_CASE_M4_2C preserves legacy views and stored URL compatibility', () => {
    expect(parseViewsParam(`${buildViewParam('Agent', 'panel_agent_1')},${buildViewParam('Code', 'panel_code_2')}`))
      .toEqual(['1', '2']);
    expect(normalizeStoredDashboardUrl('/dashboard?ref=ignored&voyage=alpha-1&craft=alpha-craft-1-1&panel=agent-1'))
      .toBe('/?voyage=alpha-1&craft=alpha-craft-1-1&panel=agent-1');
  });

  it('TEST_CASE_M4_2C fails closed for legacy views that would require deterministic open authority', () => {
    expect(resolveFocusTokens('plugin-panel-99', ['panel_agent_1', 'panel_code_2']))
      .toEqual({ status: 'invalid', reason: 'ambiguous-or-missing' });
  });

  it('TEST_CASE_M4_2D recognizes homepage legacy tokens as non-mutating dashboard intent', () => {
    expect(hasHomepageLegacyDashboardToken('?voyage=tg_home')).toBe(true);
    expect(resolveDashboardVoyage({ savedSessions: [savedSession], requestedVoyageKey: 'internal://spaces-overview' }))
      .toEqual({ status: 'missing-param' });
  });

  it('TEST_CASE_M4_2E leaves workspace opener paths outside stored Voyage URL authority', () => {
    expect(normalizeStoredDashboardUrl('/dashboard/workspaces/workspace-a?voyage=alpha-1')).toBeUndefined();
  });

  it('TEST_CASE_M4_2F rejects invalid or ambiguous tokens without falling back to another Voyage', () => {
    expect(resolveDashboardVoyage({ savedSessions: [savedSession], requestedVoyageKey: 'missing' }))
      .toEqual({ status: 'not-found', requestedVoyageKey: 'missing' });
    expect(resolveRequestedVoyageSessionId({
      savedSessions: [
        { ...savedSession, id: 'voyage_a_123', slug: 'a' },
        { ...savedSession, id: 'voyage_b_123', slug: 'b' },
      ],
      requestedVoyageKey: 'voyage-123',
    })).toBeUndefined();
    expect(resolveFocusToken('missing-panel', ['panel_agent_1'])).toEqual({
      status: 'invalid',
      reason: 'ambiguous-or-missing',
    });
    expect(resolveFocusToken('panel-1', ['panel_agent_1', 'panel_code_1'])).toEqual({
      status: 'invalid',
      reason: 'ambiguous-or-missing',
    });
  });
});

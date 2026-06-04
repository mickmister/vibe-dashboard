import { describe, expect, it } from 'vitest';
import {
  resolvePreferredVoyageSessionId,
  resolveRequestedVoyageSessionId,
} from './voyageSession';
import type { SavedWorkspaceSession } from '../types';

function session(
  id: string,
  slug = `voyage-${id}`,
): SavedWorkspaceSession {
  const entry = { id: 've_tg_1', tabGroupId: 'tg_1', viewIds: ['tab_1'] };
  return {
    id,
    slug,
    name: '',
    createdAt: '2026-05-27T00:00:00.000Z',
    updatedAt: '2026-05-27T00:00:00.000Z',
    activeVoyageEntryId: entry.id,
    voyageEntries: [entry],
    activeSpaceId: 'space_home',
    activeTabGroupId: 'tg_1',
    activeItemsByVoyageEntryId: { [entry.id]: 'tab_1' },
    visitedTabGroupIds: ['tg_1'],
  };
}

describe('resolvePreferredVoyageSessionId', () => {
  it('resolves requested voyage identity without consulting stored defaults', () => {
    const savedSessions = [session('a', 'alpha-a'), session('b', 'beta-b')];

    expect(
      resolveRequestedVoyageSessionId({
        savedSessions,
        requestedVoyageKey: 'beta-b',
      }),
    ).toBe('b');
    expect(
      resolveRequestedVoyageSessionId({
        savedSessions,
        requestedVoyageKey: 'missing',
      }),
    ).toBeUndefined();
  });

  it('prefers an existing voyage slug over stored defaults', () => {
    expect(
      resolvePreferredVoyageSessionId({
        savedSessions: [session('a', 'alpha-a'), session('b', 'beta-b')],
        requestedVoyageKey: 'beta-b',
        storedBrowserSessionId: 'a',
        originDefaultSessionId: 'a',
      }),
    ).toBe('b');
  });

  it('reuses a stale stored browser session id instead of minting replacements', () => {
    expect(
      resolvePreferredVoyageSessionId({
        savedSessions: [session('existing')],
        requestedVoyageKey: 'missing',
        storedBrowserSessionId: 'stale-local-id',
      }),
    ).toBe('stale-local-id');
  });
});

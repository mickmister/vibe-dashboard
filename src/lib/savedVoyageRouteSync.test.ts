import { describe, expect, it } from 'vitest';
import {
  shouldDeferExplicitRouteCanonicalization,
  shouldDeferStaleRouteNavPersistence,
} from './savedVoyageRouteSync';

describe('shouldDeferStaleRouteNavPersistence', () => {
  it('blocks mirroring stale route nav over a newer saved Voyage activation', () => {
    expect(
      shouldDeferStaleRouteNavPersistence({
        routeUnchanged: true,
        savedSessionChanged: true,
        savedSessionActiveVoyageEntryId: 've_new',
        sessionNavActiveVoyageEntryId: 've_old',
      }),
    ).toBe(true);
  });

  it('allows explicit URL route changes to persist as deep-link activation', () => {
    expect(
      shouldDeferStaleRouteNavPersistence({
        routeUnchanged: false,
        savedSessionChanged: true,
        savedSessionActiveVoyageEntryId: 've_new',
        sessionNavActiveVoyageEntryId: 've_old',
      }),
    ).toBe(false);
  });
});

describe('shouldDeferExplicitRouteCanonicalization', () => {
  it('preserves an explicit URL/back-forward craft change until nav catches up', () => {
    expect(
      shouldDeferExplicitRouteCanonicalization({
        routeChanged: true,
        queryVoyageEntryId: 've_new',
        sessionNavActiveVoyageEntryId: 've_old',
      }),
    ).toBe(true);
  });

  it('does not defer once nav matches the explicit route craft', () => {
    expect(
      shouldDeferExplicitRouteCanonicalization({
        routeChanged: true,
        queryVoyageEntryId: 've_new',
        sessionNavActiveVoyageEntryId: 've_new',
      }),
    ).toBe(false);
  });

  it('does not block unchanged stale-route allocation canonicalization', () => {
    expect(
      shouldDeferExplicitRouteCanonicalization({
        routeChanged: false,
        queryVoyageEntryId: 've_old',
        sessionNavActiveVoyageEntryId: 've_new',
      }),
    ).toBe(false);
  });
});

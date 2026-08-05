import { describe, expect, it } from 'vitest';
import { shouldDeferStaleRouteNavPersistence } from './savedVoyageRouteSync';

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

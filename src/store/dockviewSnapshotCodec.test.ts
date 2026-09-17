import { describe, expect, it } from 'vitest';
import {
  buildMigratedDockviewSnapshot,
  productionDockviewSnapshotCodec,
} from './dockviewSnapshotCodec';

describe('production Dockview 8.3.1 snapshot codec', () => {
  it('round-trips canonical panels, pair topology, and active selection', () => {
    const snapshot = buildMigratedDockviewSnapshot({
      panelIds: ['left', 'right', 'solo'],
      pairs: [{ pairId: 'legacy-pair', panelIds: ['left', 'right'], ratios: [50, 50] }],
      activePanelId: 'right',
    });
    const canonical = productionDockviewSnapshotCodec.validateAndCanonicalize(snapshot);
    expect(canonical.dockviewVersion).toBe('8.3.1');
    expect(canonical.panelIds).toEqual(['left', 'right', 'solo']);
    expect(productionDockviewSnapshotCodec.validateAndCanonicalize(JSON.parse(canonical.serialized)))
      .toEqual(canonical);
    expect(canonical.snapshot.activeGroup).toBe('group-right');
    expect(canonical.serialized).not.toContain('legacy-pair');
  });

  it.each([
    [{}, 'invalid root'],
    [buildMigratedDockviewSnapshot({ panelIds: ['one'], pairs: [], activePanelId: null }), 'extra panel'],
  ])('rejects invalid or drifted snapshots (%s)', (input, label) => {
    const candidate = structuredClone(input) as Record<string, unknown>;
    if (label === 'extra panel') {
      (candidate.panels as Record<string, unknown>).extra = {
        id: 'extra', contentComponent: 'iframe-panel', renderer: 'always', params: { panelId: 'extra' },
      };
    }
    expect(() => productionDockviewSnapshotCodec.validateAndCanonicalize(candidate)).toThrow();
  });
});

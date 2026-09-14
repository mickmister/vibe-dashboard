import { describe, expect, it } from 'vitest';
import {
  DOCKVIEW_LAYOUT_FORMAT_VERSION,
  PINNED_DOCKVIEW_VERSION,
  validateEnvelope,
} from './snapshotPolicy';

const valid = {
  formatVersion: DOCKVIEW_LAYOUT_FORMAT_VERSION,
  dockviewVersion: PINNED_DOCKVIEW_VERSION,
  snapshot: {
    grid: {
      root: { type: 'branch', data: [] },
      width: 900,
      height: 500,
      orientation: 'HORIZONTAL',
    },
    panels: { panel: { contentComponent: 'contract-panel' } },
  },
};

describe('Dockview snapshot policy', () => {
  it('accepts only the pinned application and Dockview serialization versions', () => {
    expect(validateEnvelope(valid)).toBeUndefined();
    expect(validateEnvelope({ ...valid, formatVersion: 2 })).toBe('unsupported-layout-version');
    expect(validateEnvelope({ ...valid, dockviewVersion: '8.3.2' })).toBe('unsupported-dockview-version');
  });

  it.each([
    [null, 'invalid-dockview-snapshot'],
    [{ ...valid, snapshot: {} }, 'invalid-dockview-snapshot'],
    [{ ...valid, snapshot: { ...valid.snapshot, floatingGroups: [{}] } }, 'floating-groups-disabled'],
    [{ ...valid, snapshot: { ...valid.snapshot, popoutGroups: [{}] } }, 'popout-groups-disabled'],
    [{ ...valid, snapshot: { ...valid.snapshot, edgeGroups: {} } }, 'invalid-dockview-snapshot'],
    [{ ...valid, snapshot: { ...valid.snapshot, panels: { panel: { contentComponent: 'contract-panel', pinned: true } } } }, 'pinned-tabs-disabled'],
    [{ ...valid, snapshot: { ...valid.snapshot, panels: { panel: { contentComponent: 'other' } } } }, 'unknown-panel-component'],
  ])('rejects unsupported input before restore: %#', (input, reason) => {
    expect(validateEnvelope(input)).toBe(reason);
  });
});

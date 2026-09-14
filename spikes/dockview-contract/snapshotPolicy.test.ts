/* eslint-disable formatjs/no-literal-string-in-object -- isolated persistence fixtures */
import { describe, expect, it } from 'vitest';
import { DOCKVIEW_LAYOUT_FORMAT_VERSION, PINNED_DOCKVIEW_VERSION, parseDockviewEnvelope } from './snapshotPolicy';

const valid = {
  formatVersion: DOCKVIEW_LAYOUT_FORMAT_VERSION,
  dockviewVersion: PINNED_DOCKVIEW_VERSION,
  snapshot: {
    grid: {
      root: { type: 'branch', data: [{ type: 'leaf', data: { id: 'group-1', views: ['panel-1'], activeView: 'panel-1' }, size: 900 }], size: 500 },
      width: 900,
      height: 500,
      orientation: 'HORIZONTAL',
      maximizedNode: { location: [0] },
    },
    panels: { 'panel-1': { id: 'panel-1', contentComponent: 'contract-panel', params: { label: 'Panel one' }, title: 'Panel one', renderer: 'always' } },
    activeGroup: 'group-1',
  },
};

function rejected(input: unknown) {
  const result = parseDockviewEnvelope(input);
  expect(result.ok).toBe(false);
  return result.ok ? undefined : result.reason;
}

describe('canonical Dockview snapshot parser', () => {
  it('constructs a detached allowlisted SerializedDockview value', () => {
    const input = structuredClone(valid);
    const result = parseDockviewEnvelope(input);
    expect(result).toEqual({ ok: true, value: valid });
    expect(result.ok && result.value).not.toBe(input);
    expect(result.ok && result.value.snapshot).not.toBe(input.snapshot);
  });

  it.each([
    [null, 'invalid-dockview-snapshot'],
    [{ ...valid, extra: true }, 'unknown-field'],
    [{ ...valid, formatVersion: 2 }, 'unsupported-layout-version'],
    [{ ...valid, dockviewVersion: '8.3.2' }, 'unsupported-dockview-version'],
    [{ ...valid, snapshot: { ...valid.snapshot, extra: true } }, 'unknown-field'],
    [{ ...valid, snapshot: { ...valid.snapshot, floatingGroups: [] } }, 'floating-groups-disabled'],
    [{ ...valid, snapshot: { ...valid.snapshot, floatingGroups: {} } }, 'floating-groups-disabled'],
    [{ ...valid, snapshot: { ...valid.snapshot, popoutGroups: 'bad' } }, 'popout-groups-disabled'],
    [{ ...valid, snapshot: { ...valid.snapshot, edgeGroups: true } }, 'edge-groups-disabled'],
  ])('rejects incompatible envelopes and disabled optional structures: %#', (input, reason) => {
    expect(rejected(input)).toBe(reason);
  });

  it.each([
    [{ ...valid.snapshot.grid, extra: true }],
    [{ ...valid.snapshot.grid, width: '900' }],
    [{ ...valid.snapshot.grid, orientation: 'DIAGONAL' }],
    [{ ...valid.snapshot.grid, maximizedNode: { location: [9] } }],
    [{ ...valid.snapshot.grid, root: { type: 'branch', data: 'bad' } }],
    [{ ...valid.snapshot.grid, root: { type: 'leaf', data: { id: 'group-1', views: ['panel-1'] }, extra: true } }],
    [{ ...valid.snapshot.grid, root: { type: 'leaf', data: { id: '', views: ['panel-1'] } } }],
    [{ ...valid.snapshot.grid, root: { type: 'leaf', data: { id: 'group-1', views: [] } } }],
  ])('rejects malformed or non-allowlisted grid structures: %#', (grid) => {
    expect(rejected({ ...valid, snapshot: { ...valid.snapshot, grid } })).toBe('invalid-dockview-snapshot');
  });

  it.each([
    [{ 'panel-1': { ...valid.snapshot.panels['panel-1'], extra: true } }, 'unknown-field'],
    [{ alias: valid.snapshot.panels['panel-1'] }, 'invalid-dockview-snapshot'],
    [{ 'panel-1': { ...valid.snapshot.panels['panel-1'], id: '' } }, 'invalid-dockview-snapshot'],
    [{ 'panel-1': { ...valid.snapshot.panels['panel-1'], contentComponent: 'other' } }, 'unknown-panel-component'],
    [{ 'panel-1': { ...valid.snapshot.panels['panel-1'], renderer: 'onlySometimes' } }, 'invalid-dockview-snapshot'],
    [{ 'panel-1': { ...valid.snapshot.panels['panel-1'], pinned: false } }, 'pinned-tabs-disabled'],
    [{ 'panel-1': { ...valid.snapshot.panels['panel-1'], params: { label: 'ok', token: 'secret' } } }, 'invalid-panel-params'],
    [{ 'panel-1': { id: 'panel-1', contentComponent: 'iframe-panel' } }, 'invalid-panel-params'],
  ])('rejects malformed Panels, unknown fields, and non-allowlisted params: %#', (panels, reason) => {
    expect(rejected({ ...valid, snapshot: { ...valid.snapshot, panels } })).toBe(reason);
  });

  it.each([
    [{ id: 'group-1', views: ['missing'], activeView: 'missing' }],
    [{ id: 'group-1', views: ['panel-1', 'panel-1'], activeView: 'panel-1' }],
    [{ id: 'group-1', views: ['panel-1'], activeView: 'missing' }],
  ])('rejects dangling, duplicate, and invalid active-view references: %#', (group) => {
    const grid = { ...valid.snapshot.grid, root: { type: 'leaf', data: group } };
    expect(rejected({ ...valid, snapshot: { ...valid.snapshot, grid } })).toBe('invalid-panel-reference');
  });

  it('rejects duplicate group IDs, dangling active groups, and unplaced Panels', () => {
    const leaf = valid.snapshot.grid.root.data[0];
    const duplicateGroups = { ...valid.snapshot.grid, root: { type: 'branch', data: [leaf, leaf] } };
    expect(rejected({ ...valid, snapshot: { ...valid.snapshot, grid: duplicateGroups } })).toBe('duplicate-group-id');
    const duplicatePanelReference = {
      ...valid.snapshot.grid,
      root: {
        type: 'branch',
        data: [
          leaf,
          { type: 'leaf', data: { id: 'group-2', views: ['panel-1'] } },
        ],
      },
    };
    expect(
      rejected({ ...valid, snapshot: { ...valid.snapshot, grid: duplicatePanelReference } }),
    ).toBe('invalid-panel-reference');
    expect(rejected({ ...valid, snapshot: { ...valid.snapshot, activeGroup: 'missing' } })).toBe('invalid-active-group');
    expect(rejected({ ...valid, snapshot: { ...valid.snapshot, panels: { ...valid.snapshot.panels, unused: { id: 'unused', contentComponent: 'contract-panel' } } } })).toBe('invalid-panel-reference');
  });
});

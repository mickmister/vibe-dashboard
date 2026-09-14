import type { SerializedDockview } from 'dockview';

export const DOCKVIEW_LAYOUT_FORMAT_VERSION = 1;
export const PINNED_DOCKVIEW_VERSION = '8.3.1';

const KNOWN_COMPONENTS = new Set(['contract-panel']);

export type SnapshotRejection =
  | 'floating-groups-disabled'
  | 'invalid-dockview-snapshot'
  | 'pinned-tabs-disabled'
  | 'popout-groups-disabled'
  | 'unknown-panel-component'
  | 'unsupported-dockview-version'
  | 'unsupported-layout-version';

export type DockviewSnapshotEnvelope = {
  formatVersion: number;
  dockviewVersion: string;
  snapshot: SerializedDockview;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isGridNode(value: unknown): boolean {
  if (!isRecord(value) || (value.type !== 'branch' && value.type !== 'leaf')) return false;
  if (value.type === 'branch') {
    return Array.isArray(value.data) && value.data.every(isGridNode);
  }
  return (
    isRecord(value.data) &&
    typeof value.data.id === 'string' &&
    Array.isArray(value.data.views) &&
    value.data.views.every((id) => typeof id === 'string')
  );
}

/** Fail-closed validation that must run before Dockview receives persisted JSON. */
export function validateEnvelope(value: unknown): SnapshotRejection | undefined {
  if (!isRecord(value)) return 'invalid-dockview-snapshot';
  if (value.formatVersion !== DOCKVIEW_LAYOUT_FORMAT_VERSION) {
    return typeof value.formatVersion === 'number'
      ? 'unsupported-layout-version'
      : 'invalid-dockview-snapshot';
  }
  if (value.dockviewVersion !== PINNED_DOCKVIEW_VERSION) {
    return typeof value.dockviewVersion === 'string'
      ? 'unsupported-dockview-version'
      : 'invalid-dockview-snapshot';
  }
  if (!isRecord(value.snapshot)) return 'invalid-dockview-snapshot';
  const snapshot = value.snapshot;
  if (
    !isRecord(snapshot.grid) ||
    !isGridNode(snapshot.grid.root) ||
    typeof snapshot.grid.width !== 'number' ||
    typeof snapshot.grid.height !== 'number' ||
    (snapshot.grid.orientation !== 'HORIZONTAL' && snapshot.grid.orientation !== 'VERTICAL') ||
    !isRecord(snapshot.panels)
  ) {
    return 'invalid-dockview-snapshot';
  }
  if (Array.isArray(snapshot.floatingGroups) && snapshot.floatingGroups.length > 0) {
    return 'floating-groups-disabled';
  }
  if (Array.isArray(snapshot.popoutGroups) && snapshot.popoutGroups.length > 0) {
    return 'popout-groups-disabled';
  }
  if ('edgeGroups' in snapshot && snapshot.edgeGroups !== undefined) {
    return 'invalid-dockview-snapshot';
  }
  for (const panel of Object.values(snapshot.panels)) {
    if (!isRecord(panel)) return 'invalid-dockview-snapshot';
    if (panel.pinned !== undefined || panel.isPinned !== undefined) {
      return 'pinned-tabs-disabled';
    }
    if (!KNOWN_COMPONENTS.has(String(panel.contentComponent))) {
      return 'unknown-panel-component';
    }
  }
  return undefined;
}

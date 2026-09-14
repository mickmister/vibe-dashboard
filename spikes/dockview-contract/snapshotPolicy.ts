import type { SerializedDockview } from 'dockview';

export const DOCKVIEW_LAYOUT_FORMAT_VERSION = 1;
export const PINNED_DOCKVIEW_VERSION = '8.3.1';

const KNOWN_COMPONENTS = new Set(['contract-panel', 'iframe-panel']);
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

export type SnapshotRejection =
  | 'duplicate-group-id'
  | 'edge-groups-disabled'
  | 'floating-groups-disabled'
  | 'invalid-active-group'
  | 'invalid-dockview-snapshot'
  | 'invalid-panel-params'
  | 'invalid-panel-reference'
  | 'pinned-tabs-disabled'
  | 'popout-groups-disabled'
  | 'unknown-field'
  | 'unknown-panel-component'
  | 'unsupported-dockview-version'
  | 'unsupported-layout-version';

export type DockviewSnapshotEnvelope = {
  formatVersion: number;
  dockviewVersion: string;
  snapshot: SerializedDockview;
};

export type SnapshotParseResult =
  | { ok: true; value: DockviewSnapshotEnvelope }
  | { ok: false; reason: SnapshotRejection };

type JsonRecord = Record<string, unknown>;
type CanonicalNode = {
  type: 'leaf' | 'branch';
  data: CanonicalGroup | CanonicalNode[];
  size?: number;
  visible?: boolean;
};
type CanonicalGroup = { id: string; views: string[]; activeView?: string };

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: JsonRecord, allowed: readonly string[]): boolean {
  const keys = new Set(allowed);
  return Object.keys(value).every((key) => keys.has(key));
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && IDENTIFIER.test(value);
}

function isFiniteNonnegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function optionalNodeFields(input: JsonRecord, target: CanonicalNode): boolean {
  if (input.size !== undefined) {
    if (!isFiniteNonnegative(input.size)) return false;
    target.size = input.size;
  }
  if (input.visible !== undefined) {
    if (typeof input.visible !== 'boolean') return false;
    target.visible = input.visible;
  }
  return true;
}

function parseNode(
  input: unknown,
  groups: Map<string, CanonicalGroup>,
): CanonicalNode | undefined {
  if (!isRecord(input) || !hasOnlyKeys(input, ['type', 'data', 'size', 'visible'])) {
    return undefined;
  }
  if (input.type === 'branch') {
    if (!Array.isArray(input.data)) return undefined;
    const children: CanonicalNode[] = [];
    const node: CanonicalNode = { type: 'branch', data: children };
    if (!optionalNodeFields(input, node)) return undefined;
    for (const child of input.data) {
      const parsed = parseNode(child, groups);
      if (!parsed) return undefined;
      children.push(parsed);
    }
    return node;
  }
  if (input.type !== 'leaf' || !isRecord(input.data)) return undefined;
  if (!hasOnlyKeys(input.data, ['id', 'views', 'activeView'])) return undefined;
  if (!isIdentifier(input.data.id) || !Array.isArray(input.data.views)) return undefined;
  const views = input.data.views;
  if (!views.every(isIdentifier)) return undefined;
  const group: CanonicalGroup = { id: input.data.id, views: [...views] };
  if (input.data.activeView !== undefined) {
    if (!isIdentifier(input.data.activeView)) return undefined;
    group.activeView = input.data.activeView;
  }
  if (groups.has(group.id)) return { type: 'leaf', data: group, size: Number.NaN };
  groups.set(group.id, group);
  const node: CanonicalNode = { type: 'leaf', data: group };
  return optionalNodeFields(input, node) ? node : undefined;
}

function parseParams(component: string, panelId: string, value: unknown): JsonRecord | undefined {
  if (value === undefined) return {};
  if (!isRecord(value)) return undefined;
  if (component === 'contract-panel') {
    if (!hasOnlyKeys(value, ['label']) || (value.label !== undefined && typeof value.label !== 'string')) {
      return undefined;
    }
    return value.label === undefined ? {} : { label: value.label };
  }
  if (!hasOnlyKeys(value, ['panelId']) || value.panelId !== panelId) return undefined;
  return { panelId };
}

function resolveLocation(root: CanonicalNode, location: unknown): boolean {
  if (!Array.isArray(location) || !location.every((part) => Number.isInteger(part) && part >= 0)) {
    return false;
  }
  let node = root;
  for (const part of location) {
    if (node.type !== 'branch') return false;
    const child = (node.data as CanonicalNode[])[part];
    if (!child) return false;
    node = child;
  }
  return node.type === 'leaf';
}

/** Parse untrusted persistence into a detached, exact allowlisted Dockview value. */
export function parseDockviewEnvelope(value: unknown): SnapshotParseResult {
  if (!isRecord(value)) return { ok: false, reason: 'invalid-dockview-snapshot' };
  if (!hasOnlyKeys(value, ['formatVersion', 'dockviewVersion', 'snapshot'])) {
    return { ok: false, reason: 'unknown-field' };
  }
  if (value.formatVersion !== DOCKVIEW_LAYOUT_FORMAT_VERSION) {
    return {
      ok: false,
      reason: typeof value.formatVersion === 'number' ? 'unsupported-layout-version' : 'invalid-dockview-snapshot',
    };
  }
  if (value.dockviewVersion !== PINNED_DOCKVIEW_VERSION) {
    return {
      ok: false,
      reason: typeof value.dockviewVersion === 'string' ? 'unsupported-dockview-version' : 'invalid-dockview-snapshot',
    };
  }
  if (!isRecord(value.snapshot)) return { ok: false, reason: 'invalid-dockview-snapshot' };
  const input = value.snapshot;
  for (const [field, reason] of [
    ['floatingGroups', 'floating-groups-disabled'],
    ['popoutGroups', 'popout-groups-disabled'],
    ['edgeGroups', 'edge-groups-disabled'],
  ] as const) {
    if (field in input) return { ok: false, reason };
  }
  if (!hasOnlyKeys(input, ['grid', 'panels', 'activeGroup'])) {
    return { ok: false, reason: 'unknown-field' };
  }
  if (!isRecord(input.grid) || !hasOnlyKeys(input.grid, ['root', 'width', 'height', 'orientation', 'maximizedNode'])) {
    return { ok: false, reason: 'invalid-dockview-snapshot' };
  }
  const groups = new Map<string, CanonicalGroup>();
  const root = parseNode(input.grid.root, groups);
  if (!root) {
    return { ok: false, reason: 'invalid-dockview-snapshot' };
  }
  const groupIds: string[] = [];
  const collectGroups = (node: CanonicalNode): void => {
    if (node.type === 'leaf') groupIds.push((node.data as CanonicalGroup).id);
    else (node.data as CanonicalNode[]).forEach(collectGroups);
  };
  collectGroups(root);
  if (new Set(groupIds).size !== groupIds.length) return { ok: false, reason: 'duplicate-group-id' };
  if (!isFiniteNonnegative(input.grid.width) || !isFiniteNonnegative(input.grid.height)) {
    return { ok: false, reason: 'invalid-dockview-snapshot' };
  }
  if (input.grid.orientation !== 'HORIZONTAL' && input.grid.orientation !== 'VERTICAL') {
    return { ok: false, reason: 'invalid-dockview-snapshot' };
  }

  if (!isRecord(input.panels)) return { ok: false, reason: 'invalid-dockview-snapshot' };
  const panels: Record<string, JsonRecord> = {};
  for (const [key, panel] of Object.entries(input.panels)) {
    if (!isIdentifier(key) || !isRecord(panel)) return { ok: false, reason: 'invalid-dockview-snapshot' };
    if ('pinned' in panel || 'isPinned' in panel) return { ok: false, reason: 'pinned-tabs-disabled' };
    if (!hasOnlyKeys(panel, ['id', 'contentComponent', 'title', 'renderer', 'params'])) {
      return { ok: false, reason: 'unknown-field' };
    }
    if (panel.id !== key || !isIdentifier(panel.id)) return { ok: false, reason: 'invalid-dockview-snapshot' };
    if (typeof panel.contentComponent !== 'string' || !KNOWN_COMPONENTS.has(panel.contentComponent)) {
      return { ok: false, reason: 'unknown-panel-component' };
    }
    if (panel.title !== undefined && typeof panel.title !== 'string') return { ok: false, reason: 'invalid-dockview-snapshot' };
    if (panel.renderer !== undefined && panel.renderer !== 'always' && panel.renderer !== 'onlyWhenVisible') {
      return { ok: false, reason: 'invalid-dockview-snapshot' };
    }
    const params = parseParams(panel.contentComponent, key, panel.params);
    if (!params) return { ok: false, reason: 'invalid-panel-params' };
    panels[key] = {
      id: key,
      contentComponent: panel.contentComponent,
      ...(panel.title === undefined ? {} : { title: panel.title }),
      ...(panel.renderer === undefined ? {} : { renderer: panel.renderer }),
      ...(Object.keys(params).length === 0 ? {} : { params }),
    };
  }

  const referenced = new Set<string>();
  for (const group of groups.values()) {
    if (group.activeView !== undefined && !group.views.includes(group.activeView)) {
      return { ok: false, reason: 'invalid-panel-reference' };
    }
    for (const id of group.views) {
      if (!(id in panels) || referenced.has(id)) return { ok: false, reason: 'invalid-panel-reference' };
      referenced.add(id);
    }
  }
  if (referenced.size !== Object.keys(panels).length) return { ok: false, reason: 'invalid-panel-reference' };
  if (input.activeGroup !== undefined && (!isIdentifier(input.activeGroup) || !groups.has(input.activeGroup))) {
    return { ok: false, reason: 'invalid-active-group' };
  }

  const grid: JsonRecord = {
    root,
    width: input.grid.width,
    height: input.grid.height,
    orientation: input.grid.orientation,
  };
  if (input.grid.maximizedNode !== undefined) {
    if (!isRecord(input.grid.maximizedNode) || !hasOnlyKeys(input.grid.maximizedNode, ['location']) || !resolveLocation(root, input.grid.maximizedNode.location)) {
      return { ok: false, reason: 'invalid-dockview-snapshot' };
    }
    grid.maximizedNode = { location: [...(input.grid.maximizedNode.location as number[])] };
  }

  return {
    ok: true,
    value: {
      formatVersion: DOCKVIEW_LAYOUT_FORMAT_VERSION,
      dockviewVersion: PINNED_DOCKVIEW_VERSION,
      snapshot: {
        grid,
        panels,
        ...(input.activeGroup === undefined ? {} : { activeGroup: input.activeGroup }),
      } as SerializedDockview,
    },
  };
}

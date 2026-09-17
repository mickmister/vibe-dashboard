import { Orientation, type SerializedDockview } from 'dockview';
import {
  createVoyageSnapshotCodec,
  VoyageInvariantError,
  type JsonValue,
} from './voyageRepository';

export const DOCKVIEW_LAYOUT_FORMAT_VERSION = 1;
export const PINNED_DOCKVIEW_VERSION = '8.3.1';

type JsonObject = { [key: string]: JsonValue };
type Leaf = { type: 'leaf'; data: { id: string; views: string[]; activeView?: string }; size?: number };
type Branch = { type: 'branch'; data: Array<Leaf | Branch>; size?: number };
type Node = Leaf | Branch;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
}

function parseNode(value: unknown, groups: Set<string>, panelIds: string[]): Node {
  if (!record(value) || !['leaf', 'branch'].includes(String(value.type))
    || !Object.keys(value).every((key) => ['type', 'data', 'size', 'visible'].includes(key))) {
    throw new VoyageInvariantError('Invalid Dockview grid node');
  }
  if (value.size !== undefined && (typeof value.size !== 'number' || !Number.isFinite(value.size) || value.size < 0)) {
    throw new VoyageInvariantError('Invalid Dockview grid size');
  }
  if (value.type === 'branch') {
    if (!Array.isArray(value.data)) throw new VoyageInvariantError('Invalid Dockview branch');
    return { type: 'branch', data: value.data.map((child) => parseNode(child, groups, panelIds)), ...(value.size === undefined ? {} : { size: value.size }) };
  }
  if (!record(value.data) || !Object.keys(value.data).every((key) => ['id', 'views', 'activeView'].includes(key))
    || typeof value.data.id !== 'string' || !ID.test(value.data.id) || groups.has(value.data.id)
    || !Array.isArray(value.data.views) || value.data.views.length === 0
    || !value.data.views.every((id) => typeof id === 'string' && ID.test(id))) {
    throw new VoyageInvariantError('Invalid Dockview group');
  }
  const views = value.data.views as string[];
  if (value.data.activeView !== undefined && (typeof value.data.activeView !== 'string' || !views.includes(value.data.activeView))) {
    throw new VoyageInvariantError('Invalid Dockview active Panel');
  }
  groups.add(value.data.id);
  panelIds.push(...views);
  return {
    type: 'leaf',
    data: { id: value.data.id, views: [...views], ...(value.data.activeView === undefined ? {} : { activeView: value.data.activeView }) },
    ...(value.size === undefined ? {} : { size: value.size }),
  };
}

function parseSnapshot(value: unknown): { snapshot: JsonObject; panelIds: readonly string[] } {
  if (!record(value) || !exact(value, ['grid', 'panels', ...(value.activeGroup === undefined ? [] : ['activeGroup'])])
    || !record(value.grid) || !exact(value.grid, ['root', 'height', 'width', 'orientation'])
    || typeof value.grid.width !== 'number' || typeof value.grid.height !== 'number'
    || value.grid.width < 0 || value.grid.height < 0
    || ![Orientation.HORIZONTAL, Orientation.VERTICAL, 'HORIZONTAL', 'VERTICAL'].includes(value.grid.orientation as never)
    || !record(value.panels)) {
    throw new VoyageInvariantError('Invalid Dockview 8.3.1 snapshot');
  }
  const groups = new Set<string>();
  const referenced: string[] = [];
  const root = parseNode(value.grid.root, groups, referenced);
  if (root.type !== 'branch') throw new VoyageInvariantError('Dockview root must be a branch');
  if (new Set(referenced).size !== referenced.length) throw new VoyageInvariantError('Dockview Panel referenced more than once');
  const panels: Record<string, JsonObject> = {};
  for (const [id, raw] of Object.entries(value.panels)) {
    if (!ID.test(id) || !record(raw) || !exact(raw, ['id', 'contentComponent', 'renderer', 'params'])
      || raw.id !== id || raw.contentComponent !== 'iframe-panel' || raw.renderer !== 'always'
      || !record(raw.params) || !exact(raw.params, ['panelId']) || raw.params.panelId !== id) {
      throw new VoyageInvariantError('Invalid Dockview Panel descriptor');
    }
    panels[id] = { id, contentComponent: 'iframe-panel', renderer: 'always', params: { panelId: id } };
  }
  if (referenced.length !== Object.keys(panels).length || referenced.some((id) => !panels[id])) {
    throw new VoyageInvariantError('Dockview snapshot/domain Panel mismatch');
  }
  if (value.activeGroup !== undefined && (typeof value.activeGroup !== 'string' || !groups.has(value.activeGroup))) {
    throw new VoyageInvariantError('Invalid Dockview active group');
  }
  return {
    snapshot: {
      grid: { root: root as unknown as JsonValue, width: value.grid.width, height: value.grid.height, orientation: value.grid.orientation as JsonValue },
      panels,
      ...(value.activeGroup === undefined ? {} : { activeGroup: value.activeGroup as string }),
    },
    panelIds: referenced,
  };
}

export const productionDockviewSnapshotCodec = createVoyageSnapshotCodec(
  DOCKVIEW_LAYOUT_FORMAT_VERSION,
  PINNED_DOCKVIEW_VERSION,
  parseSnapshot,
);

export function buildMigratedDockviewSnapshot(input: {
  panelIds: string[];
  pairs: Array<{ pairId: string; panelIds: string[]; ratios: [50, 50] }>;
  activePanelId: string | null;
}): SerializedDockview {
  const paired = new Set(input.pairs.flatMap(({ panelIds }) => panelIds));
  const ordered = input.pairs.flatMap(({ panelIds }) => panelIds)
    .concat(input.panelIds.filter((id) => !paired.has(id)));
  if (new Set(ordered).size !== input.panelIds.length || ordered.some((id) => !input.panelIds.includes(id))) {
    throw new VoyageInvariantError('Pair topology must reference each migrated Panel at most once');
  }
  const leaves = ordered.map((id): Leaf => ({
    type: 'leaf',
    data: { id: `group-${id}`, views: [id], activeView: id },
    size: input.pairs.some(({ panelIds }) => panelIds.includes(id)) ? 50 : 100,
  }));
  return {
    grid: {
      root: { type: 'branch', data: leaves },
      width: 1000,
      height: 800,
      orientation: Orientation.HORIZONTAL,
    },
    panels: Object.fromEntries(input.panelIds.map((id) => [id, {
      id, contentComponent: 'iframe-panel', renderer: 'always', params: { panelId: id },
    }])),
    ...(input.activePanelId ? { activeGroup: `group-${input.activePanelId}` } : {}),
  };
}

import type { Craft, SavedWorkspaceSession, SavedWorkspaceSessionState, WorkspaceState } from '../types';
import { createSavedWorkspaceSessionState } from '../lib/savedVoyageState';
import { getBuiltInWorkspaceMetadata } from '../modules/plugins/vibe-dashboard/craft-surfaces';
import {
  VoyageConflictError,
  VoyageInvariantError,
  type VoyageAggregate,
  type VoyageRepository,
} from './voyageRepository';
import { buildMigratedDockviewSnapshot } from './dockviewSnapshotCodec';
import { createPanelTargetRegistry, resolveLegacyPanelTarget, type PanelTargetResolutionContext } from './panelTargetRegistry';

export type PanelTargetContextProvider = (craft: Craft, workspaceId: string) => PanelTargetResolutionContext | null;

export interface NormalizedVoyageProjectionSnapshot {
  state: Extract<SavedWorkspaceSessionState, { version: 3 }>;
  revisions: ReadonlyMap<string, number>;
}

function legacyViewId(panel: VoyageAggregate['panels'][number], workspace: WorkspaceState): string {
  if (['code', 'changes', 'beads', 'forms', 'craft-overview'].includes(panel.targetKind)) return panel.targetKind;
  if (panel.targetKind === 'custom-url') {
    const url = panel.targetPayload.url;
    const craft = workspace.tabGroups.find((candidate) => getBuiltInWorkspaceMetadata(candidate)?.workspaceId === panel.craftWorkspaceId);
    const match = craft?.tabs.find((tab) => tab.url === url);
    if (match) return match.id;
  }
  return panel.id;
}

function project(aggregate: VoyageAggregate, workspace: WorkspaceState): SavedWorkspaceSession {
  const entries = aggregate.crafts.map((craft) => {
    const tabGroupId = workspace.tabGroups.find((candidate) => getBuiltInWorkspaceMetadata(candidate)?.workspaceId === craft.craftWorkspaceId)?.id
      ?? `unavailable:${craft.craftWorkspaceId}`;
    const panels = aggregate.panels.filter(({ craftWorkspaceId }) => craftWorkspaceId === craft.craftWorkspaceId);
    return { id: `normalized:${craft.craftWorkspaceId}`, tabGroupId, viewIds: panels.map((panel) => legacyViewId(panel, workspace)) };
  });
  const active = [...aggregate.panels].filter(({ lastActivatedSequence }) => lastActivatedSequence !== null)
    .sort((left, right) => (right.lastActivatedSequence ?? 0) - (left.lastActivatedSequence ?? 0))[0];
  const activeEntry = entries.find((entry) => aggregate.panels.some(({ id, craftWorkspaceId }) => id === active?.id && entry.id === `normalized:${craftWorkspaceId}`)) ?? entries[0];
  const activeItemsByVoyageEntryId = Object.fromEntries(entries.map((entry) => {
    const candidates = aggregate.panels.filter(({ craftWorkspaceId }) => entry.id === `normalized:${craftWorkspaceId}`);
    const selected = candidates.sort((left, right) => (right.lastActivatedSequence ?? -1) - (left.lastActivatedSequence ?? -1))[0];
    return [entry.id, selected ? legacyViewId(selected, workspace) : entry.viewIds[0] ?? ''];
  }));
  return {
    id: aggregate.id,
    slug: aggregate.id,
    name: aggregate.metadata.name,
    createdAt: aggregate.metadata.createdAt,
    updatedAt: aggregate.metadata.updatedAt,
    activeVoyageEntryId: activeEntry?.id ?? '',
    voyageEntries: entries,
    activeSpaceId: workspace.spaces.find(({ tabGroupIds }) => activeEntry && tabGroupIds.includes(activeEntry.tabGroupId))?.id ?? '',
    activeTabGroupId: activeEntry?.tabGroupId ?? '',
    activeItemsByVoyageEntryId,
    visitedTabGroupIds: entries.filter((entry) => aggregate.panels.some(({ craftWorkspaceId, lastActivatedSequence }) => entry.id === `normalized:${craftWorkspaceId}` && lastActivatedSequence !== null)).map(({ tabGroupId }) => tabGroupId),
  };
}

function structuralEqual(left: SavedWorkspaceSession, right: SavedWorkspaceSession): boolean {
  const omitMetadata = ({ name: _name, updatedAt: _updatedAt, activeVoyageEntryId: _active, activeSpaceId: _space, activeTabGroupId: _group,
    activeItemsByVoyageEntryId: _items, visitedTabGroupIds: _visited, ...value }: SavedWorkspaceSession) => value;
  return JSON.stringify(omitMetadata(left)) === JSON.stringify(omitMetadata(right));
}

function compileStructure(session: SavedWorkspaceSession, aggregate: VoyageAggregate | null, workspace: WorkspaceState, contextProvider: PanelTargetContextProvider) {
  const used = new Set<string>();
  const registry = createPanelTargetRegistry();
  const crafts = session.voyageEntries.map((entry, index) => {
    const workspaceId = getBuiltInWorkspaceMetadata(workspace.tabGroups.find(({ id }) => id === entry.tabGroupId) ?? { tabs: [] })?.workspaceId
      ?? (entry.id.startsWith('normalized:') ? entry.id.slice('normalized:'.length) : '');
    if (!workspaceId) throw new VoyageInvariantError('Projected Craft has no authoritative workspace owner');
    return { craftWorkspaceId: workspaceId, sortKey: String(index).padStart(8, '0') };
  });
  const panels = session.voyageEntries.flatMap((entry) => {
    const workspaceId = crafts.find(({ craftWorkspaceId }) => entry.id === `normalized:${craftWorkspaceId}`)?.craftWorkspaceId
      ?? getBuiltInWorkspaceMetadata(workspace.tabGroups.find(({ id }) => id === entry.tabGroupId) ?? { tabs: [] })?.workspaceId;
    if (!workspaceId) throw new VoyageInvariantError('Projected Panel has no authoritative workspace owner');
    return entry.viewIds.map((viewId) => {
      const panel = aggregate?.panels.find((candidate) => !used.has(candidate.id)
        && candidate.craftWorkspaceId === workspaceId && legacyViewId(candidate, workspace) === viewId);
      if (panel) {
        used.add(panel.id);
        const { lastActivatedSequence: _recency, ...structural } = panel;
        return structural;
      }
      const craft = workspace.tabGroups.find(({ id }) => id === entry.tabGroupId);
      const view = craft?.tabs.find(({ id }) => id === viewId);
      const context = craft && workspaceId ? contextProvider(craft, workspaceId) : null;
      const target = craft && view && context ? resolveLegacyPanelTarget({ view, workspaceId, context, registry }) : null;
      if (!target) throw new VoyageInvariantError('Projected Panel target is unavailable or unauthorized');
      const id = panelId(session.id, entry.id, viewId);
      if (used.has(id) || aggregate?.panels.some((candidate) => candidate.id === id)) throw new VoyageInvariantError('Projected Panel identity collides');
      used.add(id);
      return { id, craftWorkspaceId: workspaceId, targetKind: target.kind, targetVersion: target.version, targetPayload: target.payload as never,
        titleMode: 'automatic' as const, customTitle: null, closePolicy: 'closable' };
    });
  });
  return {
    crafts,
    panels,
    snapshot: buildMigratedDockviewSnapshot({ panelIds: panels.map(({ id }) => id), pairs: [], activePanelId: null }),
  };
}

function panelId(...parts: string[]): string {
  let hash = 2166136261;
  for (const character of parts.join('\0')) { hash ^= character.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return `panel-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

/** Read-only UI projection whose only write path is repository CAS. */
export class NormalizedVoyageProjection {
  constructor(private readonly repository: VoyageRepository, private readonly workspace: () => WorkspaceState,
    private readonly contextProvider: PanelTargetContextProvider = () => null) {}

  async load(): Promise<NormalizedVoyageProjectionSnapshot> {
    const aggregates = await Promise.all((await this.repository.listVoyageIds()).map((id) => this.repository.loadVoyage(id)));
    return {
      state: createSavedWorkspaceSessionState(aggregates.map((aggregate) => project(aggregate, this.workspace()))) as Extract<SavedWorkspaceSessionState, { version: 3 }>,
      revisions: new Map(aggregates.map(({ id, revision }) => [id, revision])),
    };
  }

  async replace(previous: NormalizedVoyageProjectionSnapshot, next: Extract<SavedWorkspaceSessionState, { version: 3 }>): Promise<NormalizedVoyageProjectionSnapshot> {
    const before = new Map(previous.state.data.map((session) => [session.id, session]));
    const after = new Map(next.data.map((session) => [session.id, session]));
    const aggregates = new Map(await Promise.all([...before.keys()].map(async (id) => [id, await this.repository.loadVoyage(id)] as const)));
    const deltas = [];
    for (const [id, session] of before) {
      const aggregate = aggregates.get(id)!;
      const expectedRevision = previous.revisions.get(id);
      if (expectedRevision === undefined) throw new VoyageConflictError(id, -1);
      const replacement = after.get(id);
      if (!replacement) {
        deltas.push({ voyageId: id, expectedRevision, delete: true, name: session.name, crafts: [], panels: [], snapshot: {}, structural: false });
        continue;
      }
      if (JSON.stringify(session) === JSON.stringify(replacement)) continue;
      const structural = !structuralEqual(session, replacement);
      const structure = structural
        ? compileStructure(replacement, aggregate, this.workspace(), this.contextProvider)
        : { crafts: aggregate.crafts, panels: aggregate.panels.map(({ lastActivatedSequence: _sequence, ...panel }) => panel), snapshot: aggregate.layout.snapshot };
      deltas.push({ voyageId: id, expectedRevision, name: replacement.name, ...structure, structural,
        activationPanelId: activationPanelId(session, replacement, structure.panels, this.workspace()) });
    }
    for (const [id, session] of after) if (!before.has(id)) {
      const structure = compileStructure(session, null, this.workspace(), this.contextProvider);
      deltas.push({ voyageId: id, expectedRevision: null, name: session.name, ...structure, structural: true,
        activationPanelId: activationPanelId(null, session, structure.panels, this.workspace()) });
    }
    await this.repository.applyProjectionReplace(deltas);
    return this.load();
  }
}

function activationPanelId(before: SavedWorkspaceSession | null, after: SavedWorkspaceSession,
  panels: Array<Omit<VoyageAggregate['panels'][number], 'lastActivatedSequence'>>, workspace: WorkspaceState): string | undefined {
  if (before && before.activeVoyageEntryId === after.activeVoyageEntryId
    && JSON.stringify(before.activeItemsByVoyageEntryId) === JSON.stringify(after.activeItemsByVoyageEntryId)) return undefined;
  const entry = after.voyageEntries.find(({ id }) => id === after.activeVoyageEntryId);
  const item = entry && after.activeItemsByVoyageEntryId[entry.id];
  const workspaceId = entry && (getBuiltInWorkspaceMetadata(workspace.tabGroups.find(({ id }) => id === entry.tabGroupId) ?? { tabs: [] })?.workspaceId
    ?? (entry.id.startsWith('normalized:') ? entry.id.slice('normalized:'.length) : ''));
  const panel = panels.find((candidate) => candidate.craftWorkspaceId === workspaceId && legacyViewId({ ...candidate, lastActivatedSequence: null }, workspace) === item);
  if (!panel) throw new VoyageInvariantError('Projected activation must resolve to a normalized Panel');
  return panel.id;
}

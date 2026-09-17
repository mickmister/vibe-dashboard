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

function projectedWorkspaceIds(session: SavedWorkspaceSession, workspace: WorkspaceState): string[] {
  return session.voyageEntries.map((entry) => getBuiltInWorkspaceMetadata(workspace.tabGroups.find(({ id }) => id === entry.tabGroupId) ?? { tabs: [] })?.workspaceId
    ?? (entry.id.startsWith('normalized:') ? entry.id.slice('normalized:'.length) : '')).filter(Boolean);
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
    await Promise.all([...before.keys()].map(async (id) => {
      const expected = previous.revisions.get(id);
      if (expected === undefined || (await this.repository.loadVoyage(id)).revision !== expected) throw new VoyageConflictError(id, expected ?? -1);
    }));
    const creations = [...after].filter(([id]) => !before.has(id)).map(([id, session]) => ({ id, session,
      structure: compileStructure(session, null, this.workspace(), this.contextProvider) }));
    if (creations.length > 1) throw new VoyageInvariantError('Compatibility projection creates one Voyage per command');
    for (const creation of creations) await this.repository.createVoyage({ id: creation.id, name: creation.session.name, ...creation.structure });
    const structuralHandled = new Set<string>();
    const revisionOverrides = new Map<string, number>();
    const removed = [...before].flatMap(([id, session]) => {
      const nextSession = after.get(id);
      if (!nextSession) return [];
      const nextIds = new Set(projectedWorkspaceIds(nextSession, this.workspace()));
      return projectedWorkspaceIds(session, this.workspace()).filter((workspaceId) => !nextIds.has(workspaceId)).map((workspaceId) => ({ id, workspaceId }));
    });
    const added = [...after].flatMap(([id, session]) => {
      const oldSession = before.get(id);
      if (!oldSession) return [];
      const oldIds = new Set(projectedWorkspaceIds(oldSession, this.workspace()));
      return projectedWorkspaceIds(session, this.workspace()).filter((workspaceId) => !oldIds.has(workspaceId)).map((workspaceId) => ({ id, workspaceId }));
    });
    if (removed.length && added.length) {
      if (removed.length !== 1 || added.length !== 1 || removed[0]!.workspaceId !== added[0]!.workspaceId || removed[0]!.id === added[0]!.id) {
        throw new VoyageInvariantError('Compatibility projection supports only one atomic Craft move at a time');
      }
      const source = await this.repository.loadVoyage(removed[0]!.id);
      const destination = await this.repository.loadVoyage(added[0]!.id);
      const movedPanelIds = source.panels.filter(({ craftWorkspaceId }) => craftWorkspaceId === removed[0]!.workspaceId).map(({ id }) => id);
      const sourcePanelIds = source.panels.filter(({ id }) => !movedPanelIds.includes(id)).map(({ id }) => id);
      const destinationPanelIds = [...destination.panels.map(({ id }) => id), ...movedPanelIds];
      await this.repository.moveCraft({
        sourceVoyageId: source.id, destinationVoyageId: destination.id, craftWorkspaceId: removed[0]!.workspaceId,
        sourceExpectedRevision: previous.revisions.get(source.id)!, destinationExpectedRevision: previous.revisions.get(destination.id)!,
        destinationSortKey: String(projectedWorkspaceIds(after.get(destination.id)!, this.workspace()).indexOf(removed[0]!.workspaceId)).padStart(8, '0'),
        sourceSnapshot: buildMigratedDockviewSnapshot({ panelIds: sourcePanelIds, pairs: [], activePanelId: null }),
        destinationSnapshot: buildMigratedDockviewSnapshot({ panelIds: destinationPanelIds, pairs: [], activePanelId: null }),
      });
      structuralHandled.add(source.id); structuralHandled.add(destination.id);
      revisionOverrides.set(source.id, source.revision + 1); revisionOverrides.set(destination.id, destination.revision + 1);
    }
    for (const [id, session] of before) {
      const revision = revisionOverrides.get(id) ?? previous.revisions.get(id);
      if (revision === undefined) throw new VoyageConflictError(id, -1);
      const replacement = after.get(id);
      if (!replacement) {
        await this.repository.deleteVoyage(id, revision);
        continue;
      }
      let currentRevision = revision;
      if (!structuralHandled.has(id) && !structuralEqual(session, replacement)) {
        const aggregate = await this.repository.loadVoyage(id);
        const structure = compileStructure(replacement, aggregate, this.workspace(), this.contextProvider);
        currentRevision = (await this.repository.commitMembershipMutation({ voyageId: id, expectedRevision: currentRevision, ...structure })).revision;
      }
      if (session.name !== replacement.name) currentRevision = await this.repository.updateMetadata({ voyageId: id, expectedRevision: currentRevision, name: replacement.name });
      if (session.activeVoyageEntryId !== replacement.activeVoyageEntryId || JSON.stringify(session.activeItemsByVoyageEntryId) !== JSON.stringify(replacement.activeItemsByVoyageEntryId)) {
        const entry = replacement.voyageEntries.find(({ id: entryId }) => entryId === replacement.activeVoyageEntryId);
        const item = entry && replacement.activeItemsByVoyageEntryId[entry.id];
        const aggregate = await this.repository.loadVoyage(id);
        const panel = aggregate.panels.find((candidate) => candidate.craftWorkspaceId
          && entry?.id === `normalized:${candidate.craftWorkspaceId}`
          && legacyViewId(candidate, this.workspace()) === item);
        if (!panel) throw new VoyageInvariantError('Projected activation must resolve to a normalized Panel');
        await this.repository.recordActivation(id, panel.id, currentRevision);
      }
    }
    return this.load();
  }
}

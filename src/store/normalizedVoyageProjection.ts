import type { SavedWorkspaceSession, SavedWorkspaceSessionState, WorkspaceState } from '../types';
import { createSavedWorkspaceSessionState } from '../lib/savedVoyageState';
import { getBuiltInWorkspaceMetadata } from '../modules/plugins/vibe-dashboard/craft-surfaces';
import {
  VoyageConflictError,
  VoyageInvariantError,
  type VoyageAggregate,
  type VoyageRepository,
} from './voyageRepository';
import { buildMigratedDockviewSnapshot } from './dockviewSnapshotCodec';

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

function compileExistingStructure(session: SavedWorkspaceSession, aggregate: VoyageAggregate, workspace: WorkspaceState) {
  const used = new Set<string>();
  const crafts = session.voyageEntries.map((entry, index) => {
    const workspaceId = getBuiltInWorkspaceMetadata(workspace.tabGroups.find(({ id }) => id === entry.tabGroupId) ?? { tabs: [] })?.workspaceId
      ?? (entry.id.startsWith('normalized:') ? entry.id.slice('normalized:'.length) : '');
    if (!workspaceId || !aggregate.crafts.some(({ craftWorkspaceId }) => craftWorkspaceId === workspaceId)) {
      throw new VoyageInvariantError('Projected Craft must already belong to the normalized Voyage');
    }
    return { craftWorkspaceId: workspaceId, sortKey: String(index).padStart(8, '0') };
  });
  const panels = session.voyageEntries.flatMap((entry) => {
    const workspaceId = crafts.find(({ craftWorkspaceId }) => entry.id === `normalized:${craftWorkspaceId}`)?.craftWorkspaceId
      ?? getBuiltInWorkspaceMetadata(workspace.tabGroups.find(({ id }) => id === entry.tabGroupId) ?? { tabs: [] })?.workspaceId;
    return entry.viewIds.map((viewId) => {
      const panel = aggregate.panels.find((candidate) => !used.has(candidate.id)
        && candidate.craftWorkspaceId === workspaceId && legacyViewId(candidate, workspace) === viewId);
      if (!panel) throw new VoyageInvariantError('Projection cannot invent a normalized Panel target');
      used.add(panel.id);
      const { lastActivatedSequence: _recency, ...structural } = panel;
      return structural;
    });
  });
  return {
    crafts,
    panels,
    snapshot: buildMigratedDockviewSnapshot({ panelIds: panels.map(({ id }) => id), pairs: [], activePanelId: null }),
  };
}

/** Read-only UI projection whose only write path is repository CAS. */
export class NormalizedVoyageProjection {
  constructor(private readonly repository: VoyageRepository, private readonly workspace: () => WorkspaceState) {}

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
    if ([...after].some(([id]) => !before.has(id))) throw new VoyageInvariantError('Compatibility projection cannot create structural Voyages');
    for (const [id, session] of before) {
      const revision = previous.revisions.get(id);
      if (revision === undefined) throw new VoyageConflictError(id, -1);
      const replacement = after.get(id);
      if (!replacement) {
        await this.repository.deleteVoyage(id, revision);
        continue;
      }
      let currentRevision = revision;
      if (!structuralEqual(session, replacement)) {
        const aggregate = await this.repository.loadVoyage(id);
        const structure = compileExistingStructure(replacement, aggregate, this.workspace());
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

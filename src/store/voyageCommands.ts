import type { SerializedDockview } from 'dockview';
import { buildMigratedDockviewSnapshot } from './dockviewSnapshotCodec';
import {
  VoyageConflictError,
  VoyageInvariantError,
  type StructuralPanelHistoryRecord,
  type VoyageAggregate,
  type VoyageCraftRecord,
  type VoyagePanelRecord,
  type VoyageRepository,
} from './voyageRepository';

type DockviewLeaf = { type: 'leaf'; data: { id: string; views: string[]; activeView?: string }; size?: number };
type DockviewBranch = { type: 'branch'; data: DockviewNode[]; size?: number };
type DockviewNode = DockviewLeaf | DockviewBranch;

export type VoyageCommandResult = {
  voyageId: string;
  revision: number;
};

export interface VoyageCommandServiceOptions {
  createId?: (prefix: string) => string;
}

/**
 * Product command layer for normalized Voyage/Craft/Panel mutations.
 *
 * It deliberately has one persistence dependency: VoyageRepository. The
 * repository owns CAS, serialization, history checkpoints, and two-Voyage
 * atomicity; this layer only computes the next structural projection.
 */
export class VoyageCommandService {
  constructor(
    private readonly repository: VoyageRepository,
    private readonly options: VoyageCommandServiceOptions = {},
  ) {}

  async createVoyage(input: {
    voyageId?: string;
    name: string;
    mission?: string | null;
    crafts?: VoyageCraftRecord[];
    panels?: StructuralPanelHistoryRecord[];
    activePanelId?: string | null;
  }): Promise<VoyageCommandResult> {
    const voyageId = input.voyageId || this.createId('voyage');
    const panels = input.panels ?? [];
    const crafts = deriveCraftsForPanels(input.crafts ?? inferCrafts(panels), panels);
    await this.repository.createVoyage({
      id: voyageId,
      name: input.name,
      crafts,
      panels,
      snapshot: buildMigratedDockviewSnapshot({
        panelIds: panels.map(({ id }) => id),
        pairs: [],
        activePanelId: input.activePanelId ?? panels[0]?.id ?? null,
      }),
    });
    let revision = 0;
    if (input.mission !== undefined) {
      revision = await this.repository.updateMetadata({
        voyageId,
        expectedRevision: 0,
        mission: input.mission,
      });
    }
    return { voyageId, revision };
  }

  async renameVoyage(input: {
    voyageId: string;
    expectedRevision: number;
    name: string;
    mission?: string | null;
  }): Promise<VoyageCommandResult> {
    const revision = await this.repository.updateMetadata({
      voyageId: input.voyageId,
      expectedRevision: input.expectedRevision,
      name: input.name,
      ...(input.mission === undefined ? {} : { mission: input.mission }),
    });
    return { voyageId: input.voyageId, revision };
  }

  async addCraft(input: {
    voyageId: string;
    expectedRevision: number;
    craftWorkspaceId: string;
    sortKey?: string;
    panels: [StructuralPanelHistoryRecord, ...StructuralPanelHistoryRecord[]];
  }): Promise<VoyageCommandResult> {
    const aggregate = await this.loadAtRevision(input.voyageId, input.expectedRevision);
    if (!input.panels.length) throw new VoyageInvariantError('Adding a Craft requires at least one initial Panel');
    if (aggregate.crafts.some(({ craftWorkspaceId }) => craftWorkspaceId === input.craftWorkspaceId)) {
      throw new VoyageInvariantError(`Craft ${input.craftWorkspaceId} is already in Voyage ${input.voyageId}`);
    }
    for (const panel of input.panels) {
      if (panel.craftWorkspaceId !== input.craftWorkspaceId) {
        throw new VoyageInvariantError(`Initial Panel ${panel.id} must reference Craft ${input.craftWorkspaceId}`);
      }
      if (aggregate.panels.some(({ id }) => id === panel.id)) {
        throw new VoyageInvariantError(`Panel ${panel.id} already exists`);
      }
    }
    const revision = (await this.repository.commitMembershipMutation({
      voyageId: input.voyageId,
      expectedRevision: input.expectedRevision,
      crafts: [
        ...aggregate.crafts,
        {
          craftWorkspaceId: input.craftWorkspaceId,
          sortKey: input.sortKey ?? nextSortKey(aggregate.crafts),
        },
      ],
      panels: [...structuralPanels(aggregate.panels), ...input.panels],
      snapshot: addPanelsToSnapshot(
        asSerialized(aggregate.layout.snapshot),
        input.panels.map(({ id }) => id),
      ),
    })).revision;
    return { voyageId: input.voyageId, revision };
  }

  async removeCraft(input: {
    voyageId: string;
    expectedRevision: number;
    craftWorkspaceId: string;
  }): Promise<VoyageCommandResult> {
    const aggregate = await this.loadAtRevision(input.voyageId, input.expectedRevision);
    if (!aggregate.crafts.some(({ craftWorkspaceId }) => craftWorkspaceId === input.craftWorkspaceId)) {
      throw new VoyageInvariantError(`Craft ${input.craftWorkspaceId} is not in Voyage ${input.voyageId}`);
    }
    const removedPanelIds = aggregate.panels
      .filter(({ craftWorkspaceId }) => craftWorkspaceId === input.craftWorkspaceId)
      .map(({ id }) => id);
    const revision = (await this.repository.commitMembershipMutation({
      voyageId: input.voyageId,
      expectedRevision: input.expectedRevision,
      crafts: aggregate.crafts.filter(({ craftWorkspaceId }) => craftWorkspaceId !== input.craftWorkspaceId),
      panels: structuralPanels(aggregate.panels.filter(({ craftWorkspaceId }) => craftWorkspaceId !== input.craftWorkspaceId)),
      snapshot: removePanelsFromSnapshot(asSerialized(aggregate.layout.snapshot), new Set(removedPanelIds)),
    })).revision;
    return { voyageId: input.voyageId, revision };
  }

  async openPanel(input: {
    voyageId: string;
    expectedRevision: number;
    panel: StructuralPanelHistoryRecord;
    afterPanelId?: string;
    active?: boolean;
  }): Promise<VoyageCommandResult> {
    const aggregate = await this.loadAtRevision(input.voyageId, input.expectedRevision);
    if (aggregate.panels.some(({ id }) => id === input.panel.id)) {
      throw new VoyageInvariantError(`Panel ${input.panel.id} already exists`);
    }
    const panels = [...structuralPanels(aggregate.panels), input.panel];
    const snapshot = addPanelToSnapshot(asSerialized(aggregate.layout.snapshot), input.panel.id, input.afterPanelId, input.active);
    const missingCraft = input.panel.craftWorkspaceId !== null
      && !aggregate.crafts.some(({ craftWorkspaceId }) => craftWorkspaceId === input.panel.craftWorkspaceId);
    const revision = missingCraft
      ? (await this.repository.commitMembershipMutation({
        voyageId: input.voyageId,
        expectedRevision: input.expectedRevision,
        crafts: [
          ...aggregate.crafts,
          {
            craftWorkspaceId: input.panel.craftWorkspaceId!,
            sortKey: nextSortKey(aggregate.crafts),
          },
        ],
        panels,
        snapshot,
      })).revision
      : await this.repository.commitLayoutMutation({
        voyageId: input.voyageId,
        expectedRevision: input.expectedRevision,
        panels,
        snapshot,
        ...(input.active ? { activationPanelId: input.panel.id } : {}),
      });
    if (missingCraft && input.active) {
      return this.focusPanel({ voyageId: input.voyageId, expectedRevision: revision, panelId: input.panel.id });
    }
    return { voyageId: input.voyageId, revision };
  }

  async duplicatePanel(input: {
    voyageId: string;
    expectedRevision: number;
    sourcePanelId: string;
    newPanelId?: string;
    active?: boolean;
  }): Promise<VoyageCommandResult> {
    const aggregate = await this.loadAtRevision(input.voyageId, input.expectedRevision);
    const source = aggregate.panels.find(({ id }) => id === input.sourcePanelId);
    if (!source) throw new VoyageInvariantError(`Panel ${input.sourcePanelId} is not in Voyage ${input.voyageId}`);
    const newPanelId = input.newPanelId || uniquePanelId(aggregate.panels, `${source.id}-copy`);
    if (aggregate.panels.some(({ id }) => id === newPanelId)) throw new VoyageInvariantError(`Panel ${newPanelId} already exists`);
    const duplicated: StructuralPanelHistoryRecord = {
      ...structuralPanel(source),
      id: newPanelId,
      closePolicy: 'closable',
    };
    const panels = [...structuralPanels(aggregate.panels), duplicated];
    const snapshot = addPanelToSnapshot(asSerialized(aggregate.layout.snapshot), newPanelId, source.id, input.active);
    const revision = await this.repository.commitLayoutMutation({
      voyageId: input.voyageId,
      expectedRevision: input.expectedRevision,
      panels,
      snapshot,
      ...(input.active ? { activationPanelId: newPanelId } : {}),
    });
    return { voyageId: input.voyageId, revision };
  }

  async closePanel(input: {
    voyageId: string;
    expectedRevision: number;
    panelId: string;
  }): Promise<VoyageCommandResult> {
    const aggregate = await this.loadAtRevision(input.voyageId, input.expectedRevision);
    const panel = aggregate.panels.find(({ id }) => id === input.panelId);
    if (!panel) throw new VoyageInvariantError(`Panel ${input.panelId} is not in Voyage ${input.voyageId}`);
    const panels = structuralPanels(aggregate.panels.filter(({ id }) => id !== input.panelId));
    const snapshot = removePanelsFromSnapshot(asSerialized(aggregate.layout.snapshot), new Set([input.panelId]));
    const crafts = deriveCraftsForPanels(aggregate.crafts, panels);
    const removedLastCraftPanel = crafts.length !== aggregate.crafts.length;
    const revision = removedLastCraftPanel
      ? (await this.repository.commitMembershipMutation({
        voyageId: input.voyageId,
        expectedRevision: input.expectedRevision,
        crafts,
        panels,
        snapshot,
      })).revision
      : await this.repository.commitLayoutMutation({
        voyageId: input.voyageId,
        expectedRevision: input.expectedRevision,
        panels,
        snapshot,
      });
    return { voyageId: input.voyageId, revision };
  }

  async focusPanel(input: {
    voyageId: string;
    expectedRevision: number;
    panelId: string;
  }): Promise<VoyageCommandResult> {
    await this.repository.recordActivation(input.voyageId, input.panelId, input.expectedRevision);
    const aggregate = await this.repository.loadVoyage(input.voyageId);
    return { voyageId: input.voyageId, revision: aggregate.revision };
  }

  async copyCraft(input: {
    sourceVoyageId: string;
    destinationVoyageId: string;
    sourceExpectedRevision: number;
    destinationExpectedRevision: number;
    craftWorkspaceId: string;
    destinationSortKey?: string;
    clonePanelId?: (sourcePanelId: string) => string;
  }): Promise<VoyageCommandResult> {
    const source = await this.loadAtRevision(input.sourceVoyageId, input.sourceExpectedRevision);
    const destination = await this.loadAtRevision(input.destinationVoyageId, input.destinationExpectedRevision);
    const craft = source.crafts.find(({ craftWorkspaceId }) => craftWorkspaceId === input.craftWorkspaceId);
    if (!craft) throw new VoyageInvariantError(`Craft ${input.craftWorkspaceId} is not in source Voyage`);
    if (destination.crafts.some(({ craftWorkspaceId }) => craftWorkspaceId === input.craftWorkspaceId)) {
      throw new VoyageInvariantError(`Craft ${input.craftWorkspaceId} is already in destination Voyage`);
    }
    const usedDestinationPanelIds = new Set(destination.panels.map(({ id }) => id));
    const clonedPanels = source.panels
      .filter(({ craftWorkspaceId }) => craftWorkspaceId === input.craftWorkspaceId)
      .map((sourcePanel) => {
        const id = uniquePanelIdFromSet(
          usedDestinationPanelIds,
          input.clonePanelId?.(sourcePanel.id) ?? `${sourcePanel.id}-copy`,
        );
        usedDestinationPanelIds.add(id);
        return {
          ...structuralPanel(sourcePanel),
          id,
          lastActivatedSequence: null,
        };
      });
    const destinationPanels = [
      ...structuralPanels(destination.panels),
      ...clonedPanels.map(({ lastActivatedSequence: _ignored, ...panel }) => panel),
    ];
    const destinationSnapshot = addPanelsToSnapshot(
      asSerialized(destination.layout.snapshot),
      clonedPanels.map(({ id }) => id),
    );
    const revision = (await this.repository.commitMembershipMutation({
      voyageId: input.destinationVoyageId,
      expectedRevision: input.destinationExpectedRevision,
      crafts: [
        ...destination.crafts,
        {
          craftWorkspaceId: input.craftWorkspaceId,
          sortKey: input.destinationSortKey ?? nextSortKey(destination.crafts),
        },
      ],
      panels: destinationPanels,
      snapshot: destinationSnapshot,
    })).revision;
    return { voyageId: input.destinationVoyageId, revision };
  }

  async moveCraft(input: {
    sourceVoyageId: string;
    destinationVoyageId: string;
    sourceExpectedRevision: number;
    destinationExpectedRevision: number;
    craftWorkspaceId: string;
    destinationSortKey?: string;
  }): Promise<void> {
    const source = await this.loadAtRevision(input.sourceVoyageId, input.sourceExpectedRevision);
    const destination = await this.loadAtRevision(input.destinationVoyageId, input.destinationExpectedRevision);
    const movedPanelIds = source.panels
      .filter(({ craftWorkspaceId }) => craftWorkspaceId === input.craftWorkspaceId)
      .map(({ id }) => id);
    await this.repository.moveCraft({
      sourceVoyageId: input.sourceVoyageId,
      destinationVoyageId: input.destinationVoyageId,
      sourceExpectedRevision: input.sourceExpectedRevision,
      destinationExpectedRevision: input.destinationExpectedRevision,
      craftWorkspaceId: input.craftWorkspaceId,
      destinationSortKey: input.destinationSortKey ?? nextSortKey(destination.crafts),
      sourceSnapshot: removePanelsFromSnapshot(asSerialized(source.layout.snapshot), new Set(movedPanelIds)),
      destinationSnapshot: addPanelsToSnapshot(asSerialized(destination.layout.snapshot), movedPanelIds),
    });
  }

  private createId(prefix: string): string {
    const generated = globalThis.crypto?.randomUUID?.();
    const id = this.options.createId?.(prefix) ?? (generated ? `${prefix}-${generated}` : '');
    if (!id) throw new VoyageInvariantError('Secure command ID generation is unavailable');
    return id;
  }

  private async loadAtRevision(voyageId: string, expectedRevision: number): Promise<VoyageAggregate> {
    const aggregate = await this.repository.loadVoyage(voyageId);
    if (aggregate.revision !== expectedRevision) throw new VoyageConflictError(voyageId, expectedRevision);
    return aggregate;
  }
}

function inferCrafts(panels: readonly StructuralPanelHistoryRecord[]): VoyageCraftRecord[] {
  const ids = [...new Set(panels.map(({ craftWorkspaceId }) => craftWorkspaceId).filter((id): id is string => Boolean(id)))];
  return ids.map((craftWorkspaceId, index) => ({ craftWorkspaceId, sortKey: String(index).padStart(8, '0') }));
}

function deriveCraftsForPanels(
  existingCrafts: readonly VoyageCraftRecord[],
  panels: readonly StructuralPanelHistoryRecord[],
): VoyageCraftRecord[] {
  const referencedCrafts = new Set(panels
    .map(({ craftWorkspaceId }) => craftWorkspaceId)
    .filter((id): id is string => Boolean(id)));
  return existingCrafts.filter(({ craftWorkspaceId }) => referencedCrafts.has(craftWorkspaceId));
}

function nextSortKey(crafts: readonly VoyageCraftRecord[]): string {
  return String(crafts.length).padStart(8, '0');
}

function structuralPanel(panel: VoyagePanelRecord): StructuralPanelHistoryRecord {
  return {
    id: panel.id,
    craftWorkspaceId: panel.craftWorkspaceId,
    targetKind: panel.targetKind,
    targetVersion: panel.targetVersion,
    targetPayload: panel.targetPayload,
    titleMode: panel.titleMode,
    customTitle: panel.customTitle,
    closePolicy: panel.closePolicy,
  };
}

function structuralPanels(panels: readonly VoyagePanelRecord[]): StructuralPanelHistoryRecord[] {
  return panels.map(structuralPanel);
}

function uniquePanelId(existing: readonly { id: string }[], preferred: string): string {
  return uniquePanelIdFromSet(new Set(existing.map(({ id }) => id)), preferred);
}

function uniquePanelIdFromSet(used: ReadonlySet<string>, preferred: string): string {
  if (!used.has(preferred)) return preferred;
  let index = 2;
  while (used.has(`${preferred}-${index}`)) index += 1;
  return `${preferred}-${index}`;
}

function cloneSnapshot(snapshot: SerializedDockview): SerializedDockview {
  return JSON.parse(JSON.stringify(snapshot)) as SerializedDockview;
}

function asSerialized(snapshot: unknown): SerializedDockview {
  return snapshot as SerializedDockview;
}

function makeLeaf(panelId: string): DockviewLeaf {
  return {
    type: 'leaf',
    data: { id: `group-${panelId}`, views: [panelId], activeView: panelId },
    size: 100,
  };
}

function addPanelsToSnapshot(snapshot: SerializedDockview, panelIds: readonly string[]): SerializedDockview {
  let next = cloneSnapshot(snapshot);
  for (const panelId of panelIds) next = addPanelToSnapshot(next, panelId, undefined, false);
  return next;
}

function addPanelToSnapshot(
  snapshot: SerializedDockview,
  panelId: string,
  afterPanelId?: string,
  active = false,
): SerializedDockview {
  const next = cloneSnapshot(snapshot);
  if (next.panels[panelId]) throw new VoyageInvariantError(`Panel ${panelId} already exists in Dockview snapshot`);
  next.panels[panelId] = {
    id: panelId,
    contentComponent: 'iframe-panel',
    renderer: 'always',
    params: { panelId },
  };
  const root = next.grid.root as DockviewBranch;
  const inserted = afterPanelId ? insertLeafAfter(root, afterPanelId, makeLeaf(panelId)) : false;
  if (afterPanelId && !inserted) throw new VoyageInvariantError(`Panel anchor ${afterPanelId} is not in Dockview snapshot`);
  if (!inserted) root.data.push(makeLeaf(panelId));
  if (active) next.activeGroup = `group-${panelId}`;
  return next;
}

function removePanelsFromSnapshot(snapshot: SerializedDockview, panelIds: ReadonlySet<string>): SerializedDockview {
  const next = cloneSnapshot(snapshot);
  for (const panelId of panelIds) delete next.panels[panelId];
  const root = next.grid.root as DockviewBranch;
  root.data = root.data
    .map((child) => prunePanel(child, panelIds))
    .filter((child): child is DockviewNode => child !== null);
  normalizeActiveGroup(next);
  return next;
}

function insertLeafAfter(node: DockviewNode, afterPanelId: string, leaf: DockviewLeaf): boolean {
  if (node.type === 'leaf') return false;
  for (let index = 0; index < node.data.length; index += 1) {
    const child = node.data[index]!;
    if (child.type === 'leaf' && child.data.views.includes(afterPanelId)) {
      node.data.splice(index + 1, 0, leaf);
      return true;
    }
    if (child.type === 'branch' && insertLeafAfter(child, afterPanelId, leaf)) return true;
  }
  return false;
}

function prunePanel(node: DockviewNode, panelIds: ReadonlySet<string>): DockviewNode | null {
  if (node.type === 'branch') {
    const data = node.data
      .map((child) => prunePanel(child, panelIds))
      .filter((child): child is DockviewNode => child !== null);
    if (!data.length) return null;
    return { ...node, data };
  }
  const views = node.data.views.filter((id) => !panelIds.has(id));
  if (!views.length) return null;
  const activeView = node.data.activeView && views.includes(node.data.activeView)
    ? node.data.activeView
    : views[0];
  return { ...node, data: { ...node.data, views, ...(activeView ? { activeView } : {}) } };
}

function normalizeActiveGroup(snapshot: SerializedDockview): void {
  const groups = new Set<string>();
  const first = collectGroups(snapshot.grid.root as DockviewNode, groups);
  if (snapshot.activeGroup && groups.has(snapshot.activeGroup)) return;
  if (first) snapshot.activeGroup = first;
  else delete snapshot.activeGroup;
}

function collectGroups(node: DockviewNode, groups: Set<string>): string | null {
  if (node.type === 'leaf') {
    groups.add(node.data.id);
    return node.data.id;
  }
  let first: string | null = null;
  for (const child of node.data) first ??= collectGroups(child, groups);
  return first;
}

// ken: linear scans over a single Voyage aggregate; add indexes only if measured command latency exceeds 16ms at >10k Panels.

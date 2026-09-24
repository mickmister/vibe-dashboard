import type { SerializedDockview } from 'dockview';
import {
  createPanelTargetRegistry,
  type JsonObject,
  type PanelTargetResolutionContext,
  type StoredPanelTarget,
} from '../store/panelTargetRegistry';
import { VoyageCommandService, type VoyageCommandResult } from '../store/voyageCommands';
import {
  VoyageConflictError,
  type StructuralPanelHistoryRecord,
  type VoyageAggregate,
  type VoyagePanelRecord,
  type VoyageRepository,
} from '../store/voyageRepository';
import { visibleRightAdjacentPanelIds } from './DockviewVisualTopology';

export type OpenSurfaceIntent = 'beside' | 'maximized';

export type OpenSurfaceResult = VoyageCommandResult & {
  panelId: string;
  created: boolean;
  moved: boolean;
  focusedOnly: boolean;
  presentation: OpenSurfaceIntent;
};

export interface OpenSurfacePresentation {
  focusPanel(panelId: string): void;
  maximizePanel(panelId: string): void;
}

export type OpenSurfaceCommandPort = Pick<
VoyageCommandService,
  'focusPanel' | 'maximizePanel' | 'openPanel' | 'placePanelBeside'
>;

export interface OpenSurfaceWorkflowInput {
  repository: VoyageRepository;
  commands?: OpenSurfaceCommandPort;
  contextForCraft: (craftWorkspaceId: string) => PanelTargetResolutionContext | null;
  presentation?: OpenSurfacePresentation;
  createPanelId?: (craftWorkspaceId: string, surfaceKey: string, aggregate: VoyageAggregate) => string;
  splitMinWidth?: number;
}

export interface OpenSurfaceRequest {
  voyageId: string;
  expectedRevision: number;
  invokingPanelId: string;
  surface: 'code';
  intent: OpenSurfaceIntent;
}

export class DockviewOpenSurfaceWorkflow {
  private readonly commands: OpenSurfaceCommandPort;
  private readonly inFlight = new Map<string, Promise<OpenSurfaceResult>>();

  constructor(private readonly input: OpenSurfaceWorkflowInput) {
    this.commands = input.commands ?? new VoyageCommandService(input.repository);
  }

  open(request: OpenSurfaceRequest): Promise<OpenSurfaceResult> {
    const key = openSurfaceRequestKey(request);
    const existing = this.inFlight.get(key);
    if (existing) return existing;
    const operation = this.executeOpen(request);
    this.inFlight.set(key, operation);
    void operation.finally(() => {
      if (this.inFlight.get(key) === operation) this.inFlight.delete(key);
    }).catch(() => undefined);
    return operation;
  }

  private async executeOpen(request: OpenSurfaceRequest): Promise<OpenSurfaceResult> {
    const aggregate = await this.input.repository.loadVoyage(request.voyageId);
    if (aggregate.revision !== request.expectedRevision) {
      throw new VoyageConflictError(request.voyageId, request.expectedRevision);
    }
    const invoking = requirePanel(aggregate, request.invokingPanelId);
    if (!invoking.craftWorkspaceId) throw new Error('invoking-craft-unavailable');
    const target = targetForSurface(request.surface, invoking.craftWorkspaceId);
    const resolvedTarget = resolveTarget(target, invoking.craftWorkspaceId, this.input.contextForCraft);
    const equivalent = equivalentPanels(
      aggregate,
      invoking.craftWorkspaceId,
      resolvedTarget.equivalenceIdentity,
      this.input.contextForCraft,
    );
    const rightAdjacentIds = new Set(visibleRightAdjacentPanelIds(
      aggregate.layout.snapshot as unknown as SerializedDockview,
      request.invokingPanelId,
    ));
    const adjacent = equivalent
      .filter((panel) => rightAdjacentIds.has(panel.id))
      .sort(byRecencyThenId)[0];
    const selected = adjacent ?? [...equivalent].sort(byRecencyThenId)[0] ?? null;
    const useMaximizedBesideFallback = request.intent === 'beside' && !canUseBesideSplit(
      aggregate.layout.snapshot as unknown as SerializedDockview,
      this.input.splitMinWidth ?? 400,
    );

    if (request.intent === 'maximized') {
      const panelId = selected?.id ?? await this.createPanel(aggregate, request, target, request.invokingPanelId, { maximized: true });
      const result = selected
        ? await this.commands.maximizePanel({ voyageId: aggregate.id, expectedRevision: aggregate.revision, panelId, active: true })
        : await this.input.repository.loadVoyage(aggregate.id).then((committed) => ({ voyageId: aggregate.id, revision: committed.revision }));
      this.input.presentation?.focusPanel(panelId);
      this.input.presentation?.maximizePanel(panelId);
      return {
        voyageId: aggregate.id,
        revision: result.revision,
        panelId,
        created: !selected,
        moved: false,
        focusedOnly: Boolean(selected),
        presentation: 'maximized',
      };
    }

    if (adjacent) {
      if (useMaximizedBesideFallback) {
        const result = await this.commands.maximizePanel({ voyageId: aggregate.id, expectedRevision: aggregate.revision, panelId: adjacent.id, active: true });
        this.input.presentation?.focusPanel(adjacent.id);
        this.input.presentation?.maximizePanel(adjacent.id);
        return { ...result, panelId: adjacent.id, created: false, moved: false, focusedOnly: false, presentation: 'beside' };
      }
      const result = await this.commands.focusPanel({ voyageId: aggregate.id, expectedRevision: aggregate.revision, panelId: adjacent.id });
      this.input.presentation?.focusPanel(adjacent.id);
      return { ...result, panelId: adjacent.id, created: false, moved: false, focusedOnly: true, presentation: 'beside' };
    }

    if (selected) {
      const result = await this.commands.placePanelBeside({
        voyageId: aggregate.id,
        expectedRevision: aggregate.revision,
        panelId: selected.id,
        afterPanelId: request.invokingPanelId,
        active: true,
        maximized: useMaximizedBesideFallback,
      });
      this.input.presentation?.focusPanel(selected.id);
      if (useMaximizedBesideFallback) this.input.presentation?.maximizePanel(selected.id);
      return { ...result, panelId: selected.id, created: false, moved: true, focusedOnly: false, presentation: 'beside' };
    }

    const panelId = await this.createPanel(aggregate, request, target, request.invokingPanelId, { maximized: useMaximizedBesideFallback });
    this.input.presentation?.focusPanel(panelId);
    if (useMaximizedBesideFallback) this.input.presentation?.maximizePanel(panelId);
    const committed = await this.input.repository.loadVoyage(aggregate.id);
    return { voyageId: aggregate.id, revision: committed.revision, panelId, created: true, moved: false, focusedOnly: false, presentation: 'beside' };
  }

  private async createPanel(
    aggregate: VoyageAggregate,
    request: OpenSurfaceRequest,
    target: StoredPanelTarget,
    afterPanelId: string,
    options: { maximized?: boolean } = {},
  ): Promise<string> {
    const invoking = requirePanel(aggregate, request.invokingPanelId);
    if (!invoking.craftWorkspaceId) throw new Error('invoking-craft-unavailable');
    const panelId = uniquePanelId(
      aggregate,
      this.input.createPanelId?.(invoking.craftWorkspaceId, request.surface, aggregate)
        ?? `${request.surface}-${sanitizeId(invoking.craftWorkspaceId)}`,
    );
    await this.commands.openPanel({
      voyageId: aggregate.id,
      expectedRevision: aggregate.revision,
      panel: {
        id: panelId,
        craftWorkspaceId: invoking.craftWorkspaceId,
        targetKind: target.kind,
        targetVersion: target.version,
        targetPayload: target.payload as JsonObject,
        titleMode: 'automatic',
        customTitle: null,
        closePolicy: 'closable',
      },
      afterPanelId,
      active: true,
      maximized: options.maximized,
    });
    return panelId;
  }
}

function requirePanel(aggregate: VoyageAggregate, panelId: string): VoyagePanelRecord {
  const panel = aggregate.panels.find(({ id }) => id === panelId);
  if (!panel) throw new Error('invoking-panel-unavailable');
  return panel;
}

function targetForSurface(surface: 'code', craftWorkspaceId: string): StoredPanelTarget {
  return {
    kind: surface,
    version: 1,
    payload: { workspaceId: craftWorkspaceId, folderIntent: 'workspace-root' },
  };
}

function resolveTarget(
  target: StoredPanelTarget,
  craftWorkspaceId: string,
  contextForCraft: (craftWorkspaceId: string) => PanelTargetResolutionContext | null,
) {
  const context = contextForCraft(craftWorkspaceId);
  if (!context) throw new Error('target-craft-unavailable');
  const resolved = createPanelTargetRegistry().resolve(target, context);
  if (resolved.status !== 'resolved') throw new Error(resolved.reason);
  return resolved;
}

function equivalentPanels(
  aggregate: VoyageAggregate,
  craftWorkspaceId: string,
  equivalenceIdentity: string,
  contextForCraft: (craftWorkspaceId: string) => PanelTargetResolutionContext | null,
): VoyagePanelRecord[] {
  return aggregate.panels.filter((panel) => {
    if (panel.craftWorkspaceId !== craftWorkspaceId) return false;
    try {
      return resolveTarget({
        kind: panel.targetKind,
        version: panel.targetVersion,
        payload: panel.targetPayload,
      }, craftWorkspaceId, contextForCraft).equivalenceIdentity === equivalenceIdentity;
    } catch {
      return false;
    }
  });
}

function byRecencyThenId(left: VoyagePanelRecord, right: VoyagePanelRecord): number {
  return (right.lastActivatedSequence ?? -1) - (left.lastActivatedSequence ?? -1) || left.id.localeCompare(right.id);
}

function canUseBesideSplit(snapshot: SerializedDockview, splitMinWidth: number): boolean {
  return typeof snapshot.grid.width === 'number' && snapshot.grid.width >= splitMinWidth * 2;
}

function uniquePanelId(aggregate: VoyageAggregate, preferred: string): string {
  const used = new Set(aggregate.panels.map(({ id }) => id));
  if (!used.has(preferred)) return preferred;
  let index = 2;
  while (used.has(`${preferred}-${index}`)) index += 1;
  return `${preferred}-${index}`;
}

function sanitizeId(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]+/g, '-');
}

function openSurfaceRequestKey(request: OpenSurfaceRequest): string {
  return [
    request.voyageId,
    request.expectedRevision,
    request.invokingPanelId,
    request.surface,
    request.intent,
  ].join('\0');
}

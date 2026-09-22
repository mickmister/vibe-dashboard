import React, { useMemo } from 'react';
import { DockviewReact, type DockviewReadyEvent, type IDockviewPanelProps } from 'dockview-react';
import { Orientation, type DockviewApi, type SerializedDockview } from 'dockview';
import 'dockview-react/dist/styles/dockview.css';
import { createPanelTargetRegistry, type PanelTargetResolution, type PanelTargetResolutionContext } from '../store/panelTargetRegistry';
import { productionDockviewSnapshotCodec } from '../store/dockviewSnapshotCodec';
import { VoyageInvariantError, type VoyageAggregate, type VoyagePanelRecord } from '../store/voyageRepository';

const PANEL_RECOVERY_HEADING = 'Panel recovery';
const PANEL_RECOVERY_BODY = 'This Panel target is unavailable or unsafe to render.';

export interface DockviewControllerApi {
  fromJSON(snapshot: SerializedDockview): void;
  toJSON(): SerializedDockview;
}

export interface DockviewPanelModel {
  id: string;
  record: VoyagePanelRecord;
  resolved: PanelTargetResolution;
}

export interface DockviewController {
  voyageId: string;
  revision: number;
  panels: ReadonlyMap<string, DockviewPanelModel>;
  quarantineReason?: string;
}

export interface DockviewControllerRestoreResult {
  status: 'restored' | 'quarantined';
  controller: DockviewController;
  panels: DockviewPanelModel[];
  restoredSnapshot: SerializedDockview;
}

export interface DockviewLayoutQuarantineEvent {
  voyageId: string;
  reason: string;
  panelId?: string;
}

export function restoreDockviewController(input: {
  api: DockviewControllerApi;
  aggregate: VoyageAggregate;
  contextForCraft: (craftWorkspaceId: string) => PanelTargetResolutionContext | null;
  onQuarantine?: (event: DockviewLayoutQuarantineEvent) => void;
  onBeforeFromJSON?: (result: DockviewControllerRestoreResult) => void;
}): DockviewControllerRestoreResult {
  const registry = createPanelTargetRegistry();
  const resolvedPanels: DockviewPanelModel[] = [];
  for (const record of input.aggregate.panels) {
    if (!record.craftWorkspaceId) {
      input.onQuarantine?.({ voyageId: input.aggregate.id, panelId: record.id, reason: 'craft-unavailable' });
      return restoreSafe(input, resolvedPanels, 'craft-unavailable');
    }
    const context = input.contextForCraft(record.craftWorkspaceId);
    if (!context) {
      input.onQuarantine?.({ voyageId: input.aggregate.id, panelId: record.id, reason: 'craft-unavailable' });
      return restoreSafe(input, resolvedPanels, 'craft-unavailable');
    }
    const resolved = registry.resolve({
      kind: record.targetKind,
      version: record.targetVersion,
      payload: record.targetPayload,
    }, context);
    if (resolved.status !== 'resolved') {
      input.onQuarantine?.({ voyageId: input.aggregate.id, panelId: record.id, reason: resolved.reason });
      return restoreSafe(input, resolvedPanels, resolved.reason);
    }
    resolvedPanels.push({ id: record.id, record, resolved });
  }

  let canonical: ReturnType<typeof productionDockviewSnapshotCodec.validateAndCanonicalize>;
  try {
    canonical = productionDockviewSnapshotCodec.validateAndCanonicalize(input.aggregate.layout.snapshot);
    const domainPanelIds = new Set(input.aggregate.panels.map(({ id }) => id));
    if (canonical.panelIds.length !== domainPanelIds.size || canonical.panelIds.some((id) => !domainPanelIds.has(id))) {
      throw new VoyageInvariantError('Dockview snapshot/domain Panel mismatch');
    }
  } catch {
    input.onQuarantine?.({ voyageId: input.aggregate.id, reason: 'invalid-dockview-snapshot' });
    return restoreSafe(input, resolvedPanels, 'invalid-dockview-snapshot');
  }

  const snapshot = canonical.snapshot as unknown as SerializedDockview;
  const result = createResult('restored', input.aggregate, resolvedPanels, snapshot);
  input.onBeforeFromJSON?.(result);
  input.api.fromJSON(snapshot);
  return result;
}

function restoreSafe(
  input: Parameters<typeof restoreDockviewController>[0],
  panels: DockviewPanelModel[],
  reason: string,
): DockviewControllerRestoreResult {
  const snapshot = buildSafeSnapshot(panels.map(({ id }) => id));
  const result = createResult('quarantined', input.aggregate, panels, snapshot, reason);
  input.onBeforeFromJSON?.(result);
  input.api.fromJSON(snapshot);
  return result;
}

function createResult(
  status: DockviewControllerRestoreResult['status'],
  aggregate: VoyageAggregate,
  panels: DockviewPanelModel[],
  restoredSnapshot: SerializedDockview,
  quarantineReason?: string,
): DockviewControllerRestoreResult {
  const panelMap = new Map(panels.map((panel) => [panel.id, panel]));
  return {
    status,
    panels,
    restoredSnapshot,
    controller: {
      voyageId: aggregate.id,
      revision: aggregate.revision,
      panels: panelMap,
      ...(quarantineReason ? { quarantineReason } : {}),
    },
  };
}

function buildSafeSnapshot(panelIds: string[]): SerializedDockview {
  return {
    grid: {
      root: {
        type: 'branch',
        data: panelIds.map((id) => ({
          type: 'leaf',
          data: { id: `group-${id}`, views: [id], activeView: id },
        })),
      },
      height: 800,
      width: 1000,
      orientation: Orientation.HORIZONTAL,
    },
    panels: Object.fromEntries(panelIds.map((id) => [id, {
      id,
      contentComponent: 'iframe-panel',
      renderer: 'always',
      params: { panelId: id },
    }])),
    ...(panelIds[0] ? { activeGroup: `group-${panelIds[0]}` } : {}),
  };
}

export function DockviewPanelContent({
  panelId,
  controller,
}: {
  panelId: string;
  controller: DockviewController;
}) {
  const panel = controller.panels.get(panelId);
  if (!panel || panel.resolved.status !== 'resolved') {
    return (
      <section data-panel-id={panelId} data-renderer-key="panel-target-recovery" className="h-full bg-neutral-950 p-4 text-sm text-neutral-300">
        <h2 className="font-semibold text-neutral-100">
          {PANEL_RECOVERY_HEADING}
        </h2>
        <p>
          {PANEL_RECOVERY_BODY}
        </p>
      </section>
    );
  }

  const policy = panel.resolved.capabilityPolicy;
  return (
    <iframe
      data-panel-id={panel.id}
      data-renderer-key={panel.resolved.rendererKey}
      title={panel.record.customTitle || panel.resolved.rendererKey}
      src={policy.resolvedUrl}
      sandbox={policy.sandbox}
      allow={policy.allow}
      referrerPolicy="no-referrer"
      className="h-full w-full border-0 bg-neutral-950"
    />
  );
}

export function DockviewWorkbench(input: {
  aggregate: VoyageAggregate;
  contextForCraft: (craftWorkspaceId: string) => PanelTargetResolutionContext | null;
  onRestore?: (result: DockviewControllerRestoreResult) => void;
  onQuarantine?: (event: DockviewLayoutQuarantineEvent) => void;
}) {
  const holder = useMemo<{ current: DockviewController | null }>(() => ({ current: null }), []);
  const components = useMemo(() => ({
    'iframe-panel': (props: IDockviewPanelProps<{ panelId?: string }>) => (
      <DockviewPanelContent
        panelId={props.params?.panelId ?? props.api.id}
        controller={holder.current ?? emptyController(input.aggregate.id, input.aggregate.revision)}
      />
    ),
  }), [holder, input.aggregate.id, input.aggregate.revision]);

  const onReady = (event: DockviewReadyEvent) => {
    const result = restoreDockviewController({
      api: event.api as DockviewApi,
      aggregate: input.aggregate,
      contextForCraft: input.contextForCraft,
      onQuarantine: input.onQuarantine,
      onBeforeFromJSON: (result) => {
        holder.current = result.controller;
      },
    });
    input.onRestore?.(result);
  };

  return (
    <div className="dockview-theme-dark h-full w-full" data-voyage-id={input.aggregate.id}>
      <DockviewReact components={components} onReady={onReady} />
    </div>
  );
}

function emptyController(voyageId: string, revision: number): DockviewController {
  return { voyageId, revision, panels: new Map() };
}

export function createDockviewControllerCache<T extends { voyageId: string } = { voyageId: string }>(input: {
  warmLimit: number;
  create?: (voyageId: string) => T;
  onDispose?: (controller: T) => void;
}) {
  const controllers = new Map<string, T>();
  const warmLimit = Math.max(1, input.warmLimit);
  return {
    get(voyageId: string) {
      const existing = controllers.get(voyageId);
      if (existing) {
        controllers.delete(voyageId);
        controllers.set(voyageId, existing);
        return existing;
      }
      const controller = input.create?.(voyageId) ?? ({ voyageId } as T);
      controllers.set(voyageId, controller);
      while (controllers.size > warmLimit) {
        const oldest = controllers.keys().next().value as string | undefined;
        if (!oldest) break;
        const evicted = controllers.get(oldest);
        controllers.delete(oldest);
        if (evicted) input.onDispose?.(evicted);
      }
      return controller;
    },
    ids() {
      return [...controllers.keys()];
    },
  };
}

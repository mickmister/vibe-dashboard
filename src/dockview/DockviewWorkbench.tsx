import React, { useEffect, useMemo, useRef } from 'react';
import { DockviewReact, type DockviewReadyEvent, type IDockviewPanelProps } from 'dockview-react';
import { Orientation, type DockviewApi, type SerializedDockview } from 'dockview';
import 'dockview-react/dist/styles/dockview.css';
import { createPanelTargetRegistry, type PanelTargetResolution, type PanelTargetResolutionContext } from '../store/panelTargetRegistry';
import { productionDockviewSnapshotCodec } from '../store/dockviewSnapshotCodec';
import { VoyageInvariantError, type VoyageAggregate, type VoyagePanelRecord } from '../store/voyageRepository';
import {
  createDockviewMutationCoordinator,
  type DockviewMutationCoordinator,
  type DockviewMutationRepository,
} from './DockviewMutationCoordinator';
import { getWindowDockviewRuntimeRegistry, getWindowDockviewWarmControllerCache, type RuntimeVisibility } from './DockviewRuntimeRegistry';

const PANEL_RECOVERY_HEADING = 'Panel recovery';
const PANEL_RECOVERY_BODY = 'This Panel target is unavailable or unsafe to render.';

export interface DockviewControllerApi {
  fromJSON(snapshot: SerializedDockview, options?: { reuseExistingPanels?: boolean }): void;
  toJSON(): SerializedDockview;
  getPanel?(panelId: string): { api: { setActive(): void } } | undefined;
  onDidActivePanelChange?(listener: (event: { panel?: { id: string } | null; origin: 'user' | 'api' }) => void): { dispose(): void };
  onDidLayoutChange?(listener: () => void): { dispose(): void };
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

type UserActivationIntent = {
  input: 'pointer' | 'keyboard';
  token: symbol;
};

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
  input.api.fromJSON(snapshot, { reuseExistingPanels: true });
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
  input.api.fromJSON(snapshot, { reuseExistingPanels: true });
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
  visibility = 'visible',
}: {
  panelId: string;
  controller: DockviewController;
  visibility?: RuntimeVisibility;
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
    <DockviewRuntimeIframe
      voyageId={controller.voyageId}
      panelId={panel.id}
      rendererKey={panel.resolved.rendererKey}
      title={panel.record.customTitle || panel.resolved.rendererKey}
      src={policy.resolvedUrl}
      sandbox={policy.sandbox}
      allow={policy.allow}
      visibility={visibility}
    />
  );
}

function DockviewRuntimeIframe(input: {
  voyageId: string;
  panelId: string;
  rendererKey: string;
  title: string;
  src: string;
  sandbox: string;
  allow: string;
  visibility: RuntimeVisibility;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const hostId = useMemo(() => `${input.voyageId}:${input.panelId}:host`, [input.panelId, input.voyageId]);
  const generation = useRef(0);
  const runtimeId = `${input.voyageId}:${input.panelId}`;

  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof document === 'undefined') return undefined;
    const registry = getWindowDockviewRuntimeRegistry();
    const token = registry.registerHost({
      voyageId: input.voyageId,
      panelId: input.panelId,
      hostId,
      generation: ++generation.current,
    });
    registry.registerRuntime({
      runtimeId,
      voyageId: input.voyageId,
      panelId: input.panelId,
      url: input.src,
      visibility: input.visibility,
    });
    const iframe = registry.ensureIframe(runtimeId, () => document.createElement('iframe'));
    iframe.title = input.title;
    iframe.className = 'h-full w-full border-0 bg-neutral-950';
    iframe.dataset.panelId = input.panelId;
    iframe.dataset.rendererKey = input.rendererKey;
    iframe.setAttribute('sandbox', input.sandbox);
    iframe.setAttribute('allow', input.allow);
    iframe.referrerPolicy = 'no-referrer';
    if (iframe.src !== input.src) iframe.src = input.src;
    registry.attach(runtimeId, token);
    registry.attachElement(runtimeId, host);
    return () => {
      registry.detachHost(token);
    };
  }, [hostId, input.allow, input.panelId, input.rendererKey, input.sandbox, input.src, input.title, input.visibility, input.voyageId, runtimeId]);

  if (typeof document === 'undefined') {
    return (
      <iframe
        data-panel-id={input.panelId}
        data-renderer-key={input.rendererKey}
        title={input.title}
        src={input.src}
        sandbox={input.sandbox}
        allow={input.allow}
        referrerPolicy="no-referrer"
        className="h-full w-full border-0 bg-neutral-950"
      />
    );
  }
  return <div ref={hostRef} data-runtime-host={runtimeId} className="h-full w-full" />;
}

export function DockviewWorkbench(input: {
  aggregate: VoyageAggregate;
  contextForCraft: (craftWorkspaceId: string) => PanelTargetResolutionContext | null;
  applicationVisibility?: RuntimeVisibility;
  repository?: DockviewMutationRepository;
  gestureDebounceMs?: number;
  onCoordinator?: (coordinator: DockviewMutationCoordinator) => void;
  onDockviewApi?: (api: DockviewControllerApi) => void;
  onRestore?: (result: DockviewControllerRestoreResult) => void;
  onQuarantine?: (event: DockviewLayoutQuarantineEvent) => void;
}) {
  const holder = useMemo<{ current: DockviewController | null }>(() => ({ current: null }), []);
  const userActivation = useMemo<{ current: UserActivationIntent | null }>(() => ({ current: null }), []);
  const visiblePanelIds = useMemo(() => visibleDockviewPanelIds(input.aggregate.layout.snapshot), [input.aggregate.layout.snapshot]);
  const components = useMemo(() => ({
    'iframe-panel': (props: IDockviewPanelProps<{ panelId?: string }>) => (
      (() => {
        const panelId = props.params?.panelId ?? props.api.id;
        return (
          <DockviewPanelContent
            panelId={panelId}
            controller={holder.current ?? emptyController(input.aggregate.id, input.aggregate.revision)}
            visibility={getDockviewPanelRuntimeVisibility(visiblePanelIds, panelId, input.applicationVisibility)}
          />
        );
      })()
    ),
  }), [holder, input.aggregate.id, input.aggregate.revision, input.applicationVisibility, visiblePanelIds]);

  const onReady = (event: DockviewReadyEvent) => {
    const api = event.api as DockviewControllerApi;
    input.onDockviewApi?.(api);
    const result = restoreDockviewController({
      api: api as DockviewApi,
      aggregate: input.aggregate,
      contextForCraft: input.contextForCraft,
      onQuarantine: input.onQuarantine,
      onBeforeFromJSON: (result) => {
        holder.current = result.controller;
      },
    });
    if (input.repository) {
      const coordinator = createDockviewMutationCoordinator({
        aggregate: input.aggregate,
        api,
        repository: input.repository,
        gestureDebounceMs: input.gestureDebounceMs,
        onAcceptedAggregate: (aggregate) => {
          const prepared = restoreDockviewController({
            api: { fromJSON: () => undefined, toJSON: api.toJSON },
            aggregate,
            contextForCraft: input.contextForCraft,
            onQuarantine: input.onQuarantine,
          });
          holder.current = prepared.controller;
        },
      });
      void getWindowDockviewWarmControllerCache().remember({
        voyageId: input.aggregate.id,
        flush: (reason) => coordinator.flush(reason),
      });
      input.onCoordinator?.(coordinator);
      const layoutGesture = createDockviewLayoutGestureAdapter({
        api,
        coordinator,
        quietMs: input.gestureDebounceMs ?? 50,
      });
      api.onDidActivePanelChange?.((change) => {
        const panelId = change.panel?.id;
        const event = consumeDockviewUserActivation(userActivation, change.origin);
        if (panelId) void coordinator.handleActivePanelChange(panelId, event);
      });
      api.onDidLayoutChange?.(() => layoutGesture.capture());
    }
    input.onRestore?.(result);
  };

  return (
    <div
      className="dockview-theme-dark h-full w-full"
      data-voyage-id={input.aggregate.id}
      onPointerDownCapture={() => markDockviewUserActivation(userActivation, 'pointer')}
      onKeyDownCapture={() => markDockviewUserActivation(userActivation, 'keyboard')}
    >
      <DockviewReact components={components} onReady={onReady} />
    </div>
  );
}

export function focusDockviewPanel(api: DockviewControllerApi | null | undefined, panelId: string): void {
  api?.getPanel?.(panelId)?.api.setActive();
}

export function markDockviewUserActivation(
  ref: { current: UserActivationIntent | null },
  input: UserActivationIntent['input'],
): void {
  const token = Symbol(input);
  ref.current = { input, token };
  queueMicrotask(() => {
    if (ref.current?.token === token) ref.current = null;
  });
}

export function consumeDockviewUserActivation(
  ref: { current: UserActivationIntent | null },
  origin: 'user' | 'api',
): { origin: 'user'; input: UserActivationIntent['input'] } | { origin: 'api' } {
  const intent = ref.current;
  ref.current = null;
  return origin === 'user' && intent ? { origin: 'user', input: intent.input } : { origin: 'api' };
}

export function createDockviewLayoutGestureAdapter(input: {
  api: DockviewControllerApi;
  coordinator: DockviewMutationCoordinator;
  quietMs: number;
}) {
  let token: symbol | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const complete = () => {
    if (!token) return;
    const completing = token;
    token = null;
    timer = null;
    void input.coordinator.completeGesture(completing, { debounceMs: 0 });
  };
  return {
    capture() {
      try {
        token ??= input.coordinator.beginGesture('dockview-layout');
        input.coordinator.captureGestureSnapshot(token, input.api.toJSON());
        if (timer) clearTimeout(timer);
        timer = setTimeout(complete, input.quietMs);
      } catch (error) {
        if (!(error instanceof VoyageInvariantError)) throw error;
      }
    },
    complete,
  };
}

function emptyController(voyageId: string, revision: number): DockviewController {
  return { voyageId, revision, panels: new Map() };
}

export function getDockviewPanelRuntimeVisibility(
  visiblePanelIds: ReadonlySet<string>,
  panelId: string,
  applicationVisibility: RuntimeVisibility = 'visible',
): RuntimeVisibility {
  return applicationVisibility === 'visible' && visiblePanelIds.has(panelId) ? 'visible' : 'inactive';
}

export function visibleDockviewPanelIds(snapshot: unknown): Set<string> {
  const fromRaw = collectVisibleDockviewPanelIds((snapshot as { grid?: { root?: unknown } } | null)?.grid?.root);
  if (fromRaw.size) return fromRaw;
  try {
    const canonical = productionDockviewSnapshotCodec.validateAndCanonicalize(snapshot).snapshot as unknown as SerializedDockview;
    return collectVisibleDockviewPanelIds(canonical.grid.root);
  } catch {
    return new Set();
  }
}

function collectVisibleDockviewPanelIds(root: unknown): Set<string> {
  const visible = new Set<string>();
  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    const record = node as { type?: unknown; data?: unknown };
    if (record.type === 'leaf' && record.data && typeof record.data === 'object') {
      const activeView = (record.data as { activeView?: unknown }).activeView;
      if (typeof activeView === 'string') visible.add(activeView);
      return;
    }
    if (Array.isArray(record.data)) record.data.forEach(visit);
  };
  visit(root);
  return visible;
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

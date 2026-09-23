import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Orientation, type SerializedDockview } from 'dockview';
import { productionDockviewSnapshotCodec } from '../store/dockviewSnapshotCodec';
import type { PanelTargetResolutionContext } from '../store/panelTargetRegistry';
import {
  type StructuralPanelHistoryRecord,
  type VoyageAggregate,
  type VoyagePanelRecord,
} from '../store/voyageRepository';
import { useModule } from '../hooks/useModule';
import { DockviewWorkbench, focusDockviewPanel, type DockviewControllerApi } from './DockviewWorkbench';
import type { CommitLayoutMutationInput } from '../store/voyageRepository';
import { computedMruPanelId, type CoordinatorVisibleState, type DockviewMutationApi, type DockviewMutationCoordinator, type DockviewMutationRepository } from './DockviewMutationCoordinator';
import { createDockviewM32HarnessAggregate } from './DockviewM32HarnessFixture';

const voyageId = 'm3-2-harness-voyage';
const workspaceId = 'workspace-a';
const emptyVisibleValue = 'none';
const labels = {
  loading: 'Loading DockView M3.2 harness',
  heading: 'DockView M3.2 serialized mutation coordinator harness',
  queueOpenPanel: 'Queue open Panel',
  startGesture: 'Start gesture',
  completeGesture: 'Complete gesture',
  undoHistory: 'Undo history',
  redoHistory: 'Redo history',
  reloadVoyage: 'Reload Voyage',
  programmaticFocus: 'Programmatic focus Panel D',
  flush: 'Flush before eviction',
  visibleState: 'DockView M3.2 visible coordinator state',
  historyVisibleState: 'DockView M3.3 persisted history visible state',
  revision: 'revision',
  activePanel: 'activePanel',
  pendingCommand: 'pendingCommand',
  dirty: 'dirty',
  lastConflict: 'lastConflict',
  topologyAgreement: 'topologyAgreement',
  historyCount: 'historyCount',
  historyCursor: 'historyCursor',
  activationSequence: 'activationSequence',
  layoutHash: 'layoutHash',
  computedMruPanel: 'computedMruPanel',
} as const;

export function DockviewM32HarnessRoute() {
  const workspaceModule = useModule('workspace');
  const [aggregate, setAggregate] = useState<VoyageAggregate | null>(null);
  const repository = useMemo(
    () => createActionRepository(workspaceModule.actions),
    [workspaceModule.actions],
  );
  useEffect(() => {
    let cancelled = false;
    void workspaceModule.actions.ensureDockviewM32HarnessVoyage().then(async (loaded) => {
      if (!cancelled) setAggregate(await loaded);
    });
    return () => { cancelled = true; };
  }, [workspaceModule.actions]);
  if (!aggregate) {
    return (
      <main className="dark flex h-screen items-center justify-center bg-neutral-950 text-neutral-100" data-testid="dockview-m3-2-harness-loading">
        {labels.loading}
      </main>
    );
  }
  return (
    <DockviewM32SemanticHarness
      aggregate={aggregate}
      repository={repository}
      contextForCraft={() => harnessContext()}
    />
  );
}

export function DockviewM32SemanticHarness(input: {
  aggregate: VoyageAggregate;
  repository: DockviewMutationRepository;
  contextForCraft: (craftWorkspaceId: string) => PanelTargetResolutionContext | null;
}) {
  const coordinator = useRef<DockviewMutationCoordinator | null>(null);
  const dockviewApi = useRef<(DockviewMutationApi & DockviewControllerApi) | null>(null);
  const gesture = useRef<symbol | null>(null);
  const [state, setState] = useState<CoordinatorVisibleState>(() => ({
    revision: input.aggregate.revision,
    activePanelId: panelIds(input.aggregate.layout.snapshot)[0] ?? null,
    pendingCommand: null,
    dirty: false,
    lastConflict: null,
    topologyAgreement: true,
    historyCount: input.aggregate.history.length,
    historyCursorSequence: input.aggregate.historyCursorSequence,
    activationSequence: input.aggregate.activationSequence,
    layoutHash: input.aggregate.layout.hash,
    computedMruPanelId: computedMruPanelId(input.aggregate),
  }));
  const publish = () => coordinator.current && setState(coordinator.current.visibleState());
  const run = (operation: () => Promise<unknown> | unknown) => {
    void Promise.resolve(operation()).finally(publish);
  };

  return (
    <main className="dark flex h-screen flex-col gap-3 bg-neutral-950 p-4 text-neutral-100" data-testid="dockview-m3-2-harness">
      <h1 className="text-lg font-semibold">
        {labels.heading}
      </h1>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => run(() => coordinator.current?.enqueueCommand(openPanelCommand('panel-d')))}>
          {labels.queueOpenPanel}
        </button>
        <button type="button" onClick={() => {
          if (!coordinator.current) return;
          gesture.current = coordinator.current.beginGesture('tester-gesture');
          publish();
        }}>
          {labels.startGesture}
        </button>
        <button type="button" onClick={() => run(() => {
          if (!coordinator.current || !gesture.current) return;
          const token = gesture.current;
          gesture.current = null;
          coordinator.current.captureGestureSnapshot(token, snapshot(['panel-d', 'panel-a', 'panel-b', 'panel-c'], 'panel-d'));
          return coordinator.current.completeGesture(token);
        })}>
          {labels.completeGesture}
        </button>
        <button type="button" onClick={() => run(() => coordinator.current?.undoHistory())}>
          {labels.undoHistory}
        </button>
        <button type="button" onClick={() => run(() => coordinator.current?.redoHistory())}>
          {labels.redoHistory}
        </button>
        <button type="button" onClick={() => run(async () => {
          if (!coordinator.current) return;
          const loaded = await input.repository.loadVoyage(voyageId);
          coordinator.current.restoreFromAggregate(loaded);
        })}>
          {labels.reloadVoyage}
        </button>
        <button type="button" onClick={() => run(() => coordinator.current?.focusPanelFromCommand('panel-d', () => focusDockviewPanel(dockviewApi.current, 'panel-d')))}>
          {labels.programmaticFocus}
        </button>
        <button type="button" onClick={() => run(() => coordinator.current?.flush('tester-flush'))}>
          {labels.flush}
        </button>
      </div>
      <p className="sr-only">
        {labels.visibleState}
      </p>
      <p className="sr-only">
        {labels.historyVisibleState}
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt>{labels.revision}</dt><dd>{state.revision}</dd>
        <dt>{labels.activePanel}</dt><dd>{state.activePanelId ?? emptyVisibleValue}</dd>
        <dt>{labels.pendingCommand}</dt><dd>{state.pendingCommand ?? emptyVisibleValue}</dd>
        <dt>{labels.dirty}</dt><dd>{String(state.dirty)}</dd>
        <dt>{labels.lastConflict}</dt><dd>{state.lastConflict ?? emptyVisibleValue}</dd>
        <dt>{labels.topologyAgreement}</dt><dd>{String(state.topologyAgreement)}</dd>
        <dt>{labels.historyCount}</dt><dd>{state.historyCount}</dd>
        <dt>{labels.historyCursor}</dt><dd>{state.historyCursorSequence ?? emptyVisibleValue}</dd>
        <dt>{labels.activationSequence}</dt><dd>{state.activationSequence}</dd>
        <dt>{labels.layoutHash}</dt><dd>{state.layoutHash ?? emptyVisibleValue}</dd>
        <dt>{labels.computedMruPanel}</dt><dd>{state.computedMruPanelId ?? emptyVisibleValue}</dd>
      </dl>
      <section className="min-h-0 flex-1 rounded border border-neutral-800">
        <DockviewWorkbench
          aggregate={input.aggregate}
          contextForCraft={input.contextForCraft}
          repository={input.repository}
          onDockviewApi={(api) => { dockviewApi.current = api; }}
          onCoordinator={(value) => {
            coordinator.current = value;
            setState(value.visibleState());
          }}
        />
      </section>
    </main>
  );
}

function createActionRepository(actions: {
  commitDockviewM32HarnessLayoutMutation(input: CommitLayoutMutationInput): Promise<number | Promise<number>>;
  recordDockviewM32HarnessActivation(input: { voyageId: string; panelId: string; expectedRevision: number }): Promise<boolean | Promise<boolean>>;
  undoDockviewM32HarnessHistory(input: { voyageId: string; expectedRevision: number }): Promise<boolean | Promise<boolean>>;
  redoDockviewM32HarnessHistory(input: { voyageId: string; expectedRevision: number }): Promise<boolean | Promise<boolean>>;
  loadDockviewM32HarnessVoyage(input?: { voyageId?: string }): Promise<VoyageAggregate | Promise<VoyageAggregate>>;
}): DockviewMutationRepository {
  return {
    commitLayoutMutation: async (mutation) => actions.commitDockviewM32HarnessLayoutMutation(mutation),
    recordActivation: async (voyageId, panelId, expectedRevision) =>
      actions.recordDockviewM32HarnessActivation({ voyageId, panelId, expectedRevision }),
    undo: async (voyageId, expectedRevision) => actions.undoDockviewM32HarnessHistory({ voyageId, expectedRevision }),
    redo: async (voyageId, expectedRevision) => actions.redoDockviewM32HarnessHistory({ voyageId, expectedRevision }),
    loadVoyage: async (voyageId) => actions.loadDockviewM32HarnessVoyage({ voyageId }),
  };
}

function openPanelCommand(id: string) {
  return {
    id: `open:${id}`,
    dedupeKey: `open:${id}`,
    unsafeDuplicate: true,
    apply(current: VoyageAggregate) {
      if (current.panels.some((panel) => panel.id === id)) {
        return { panels: structuralPanels(current), snapshot: current.layout.snapshot };
      }
      return {
        panels: [...structuralPanels(current), panel(id)],
        snapshot: snapshot([...panelIds(current.layout.snapshot), id], id),
      };
    },
  };
}

function panel(id: string): VoyagePanelRecord {
  return {
    id,
    craftWorkspaceId: workspaceId,
    targetKind: 'craft-overview',
    targetVersion: 1,
    targetPayload: { workspaceId },
    titleMode: 'automatic',
    customTitle: null,
    closePolicy: 'closable',
    lastActivatedSequence: null,
  };
}

function structuralPanels(aggregate: VoyageAggregate): StructuralPanelHistoryRecord[] {
  return aggregate.panels.map(({
    id, craftWorkspaceId, targetKind, targetVersion, targetPayload, titleMode, customTitle, closePolicy,
  }) => ({ id, craftWorkspaceId, targetKind, targetVersion, targetPayload, titleMode, customTitle, closePolicy }));
}

function snapshot(ids: string[], activePanelId = ids[0]): SerializedDockview {
  return {
    grid: {
      root: {
        type: 'branch',
        data: ids.map((id) => ({ type: 'leaf', data: { id: `group-${id}`, views: [id], activeView: id } })),
      },
      width: 1000,
      height: 800,
      orientation: Orientation.HORIZONTAL,
    },
    panels: Object.fromEntries(ids.map((id) => [id, { id, contentComponent: 'iframe-panel', renderer: 'always', params: { panelId: id } }])),
    ...(activePanelId ? { activeGroup: `group-${activePanelId}` } : {}),
  };
}

function panelIds(raw: unknown): string[] {
  return [...productionDockviewSnapshotCodec.validateAndCanonicalize(raw).panelIds];
}

function harnessContext(): PanelTargetResolutionContext {
  return {
    craftId: 'craft-a',
    hostOrigin: 'https://vd.test',
    crafts: { 'craft-a': { workspaceId, allowedPluginTargets: [] } },
    workspaces: {
      [workspaceId]: {
        id: workspaceId,
        available: true,
        directory: '/repo',
        origin: 'https://vk.test',
        repositoryIds: [],
        locations: {
          overview: '/workspaces/workspace-a',
          code: '/code/workspace-a',
          changes: '/changes/workspace-a',
          beads: '/beads/workspace-a',
          forms: '/forms/workspace-a',
        },
      },
    },
    agentSessions: {},
    terminals: {},
    previews: {},
    builtInRoutes: {},
    redirectGuards: {
      [`craft-overview:${workspaceId}`]: { deliveryUrl: 'https://vk.test/workspaces/workspace-a', upstreamOrigin: 'https://vk.test' },
    },
  };
}

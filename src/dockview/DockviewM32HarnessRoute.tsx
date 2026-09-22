import React, { useMemo, useRef, useState } from 'react';
import { Orientation, type SerializedDockview } from 'dockview';
import { FormattedMessage } from 'react-intl';
import { productionDockviewSnapshotCodec } from '../store/dockviewSnapshotCodec';
import type { PanelTargetResolutionContext } from '../store/panelTargetRegistry';
import {
  VoyageConflictError,
  type StructuralPanelHistoryRecord,
  type VoyageAggregate,
  type VoyagePanelRecord,
} from '../store/voyageRepository';
import { DockviewWorkbench } from './DockviewWorkbench';
import type { CoordinatorVisibleState, DockviewMutationCoordinator, DockviewMutationRepository } from './DockviewMutationCoordinator';

const voyageId = 'm3-2-harness-voyage';
const workspaceId = 'workspace-a';
const emptyVisibleValue = 'none';

export function DockviewM32HarnessRoute() {
  const aggregate = useMemo(() => harnessAggregate(), []);
  const repository = useMemo(() => createHarnessRepository(aggregate), [aggregate]);
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
  const gesture = useRef<symbol | null>(null);
  const [state, setState] = useState<CoordinatorVisibleState>(() => ({
    revision: input.aggregate.revision,
    activePanelId: panelIds(input.aggregate.layout.snapshot)[0] ?? null,
    pendingCommand: null,
    dirty: false,
    lastConflict: null,
    topologyAgreement: true,
  }));
  const publish = () => coordinator.current && setState(coordinator.current.visibleState());
  const run = (operation: () => Promise<unknown> | unknown) => {
    void Promise.resolve(operation()).finally(publish);
  };

  return (
    <main className="dark flex h-screen flex-col gap-3 bg-neutral-950 p-4 text-neutral-100" data-testid="dockview-m3-2-harness">
      <h1 className="text-lg font-semibold">
        <FormattedMessage
          defaultMessage="DockView M3.2 serialized mutation coordinator harness"
          description="Title for the DockView M3.2 serialized mutation coordinator semantic browser test harness."
        />
      </h1>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => run(() => coordinator.current?.enqueueCommand(openPanelCommand('panel-d')))}>
          <FormattedMessage defaultMessage="Queue open Panel" description="DockView M3.2 test harness control that queues an open Panel command." />
        </button>
        <button type="button" onClick={() => {
          if (!coordinator.current) return;
          gesture.current = coordinator.current.beginGesture('tester-gesture');
          publish();
        }}>
          <FormattedMessage defaultMessage="Start gesture" description="DockView M3.2 test harness control that starts a Dockview gesture boundary." />
        </button>
        <button type="button" onClick={() => run(() => {
          if (!coordinator.current || !gesture.current) return;
          const token = gesture.current;
          gesture.current = null;
          coordinator.current.captureGestureSnapshot(token, snapshot(['panel-d', 'panel-a', 'panel-b', 'panel-c'], 'panel-d'));
          return coordinator.current.completeGesture(token);
        })}>
          <FormattedMessage defaultMessage="Complete gesture" description="DockView M3.2 test harness control that completes a Dockview gesture boundary." />
        </button>
        <button type="button" onClick={() => run(() => coordinator.current?.focusPanelFromCommand('panel-d'))}>
          <FormattedMessage defaultMessage="Programmatic focus Panel D" description="DockView M3.2 test harness control that focuses Panel D programmatically." />
        </button>
        <button type="button" onClick={() => run(() => coordinator.current?.flush('tester-flush'))}>
          <FormattedMessage defaultMessage="Flush before eviction" description="DockView M3.2 test harness control that flushes coordinator work before lifecycle eviction." />
        </button>
      </div>
      <p className="sr-only">
        <FormattedMessage
          defaultMessage="DockView M3.2 visible coordinator state"
          description="Accessible label for the DockView M3.2 visible coordinator state list."
        />
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt><FormattedMessage defaultMessage="revision" description="DockView M3.2 visible state field label for revision." /></dt><dd>{state.revision}</dd>
        <dt><FormattedMessage defaultMessage="activePanel" description="DockView M3.2 visible state field label for active Panel." /></dt><dd>{state.activePanelId ?? emptyVisibleValue}</dd>
        <dt><FormattedMessage defaultMessage="pendingCommand" description="DockView M3.2 visible state field label for pending command." /></dt><dd>{state.pendingCommand ?? emptyVisibleValue}</dd>
        <dt><FormattedMessage defaultMessage="dirty" description="DockView M3.2 visible state field label for dirty state." /></dt><dd>{String(state.dirty)}</dd>
        <dt><FormattedMessage defaultMessage="lastConflict" description="DockView M3.2 visible state field label for last conflict." /></dt><dd>{state.lastConflict ?? emptyVisibleValue}</dd>
        <dt><FormattedMessage defaultMessage="topologyAgreement" description="DockView M3.2 visible state field label for topology agreement." /></dt><dd>{String(state.topologyAgreement)}</dd>
      </dl>
      <section className="min-h-0 flex-1 rounded border border-neutral-800">
        <DockviewWorkbench
          aggregate={input.aggregate}
          contextForCraft={input.contextForCraft}
          repository={input.repository}
          onCoordinator={(value) => {
            coordinator.current = value;
            setState(value.visibleState());
          }}
        />
      </section>
    </main>
  );
}

function createHarnessRepository(seed: VoyageAggregate): DockviewMutationRepository {
  let current = seed;
  return {
    async commitLayoutMutation(input) {
      if (input.expectedRevision !== current.revision) throw new VoyageConflictError(input.voyageId, input.expectedRevision);
      const recency = new Map(current.panels.map((panel) => [panel.id, panel.lastActivatedSequence]));
      current = {
        ...current,
        revision: current.revision + 1,
        panels: input.panels.map((panel) => ({ ...panel, lastActivatedSequence: recency.get(panel.id) ?? null })),
        layout: productionDockviewSnapshotCodec.validateAndCanonicalize(input.snapshot),
      };
      return current.revision;
    },
    async recordActivation(_voyageId, panelId, expectedRevision) {
      if (expectedRevision !== current.revision) throw new VoyageConflictError(current.id, expectedRevision);
      current = {
        ...current,
        revision: current.revision + 1,
        activationSequence: current.activationSequence + 1,
        panels: current.panels.map((panel) => panel.id === panelId
          ? { ...panel, lastActivatedSequence: current.activationSequence + 1 }
          : panel),
      };
      return true;
    },
    async loadVoyage() {
      return current;
    },
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

function harnessAggregate(): VoyageAggregate {
  const ids = ['panel-a', 'panel-b', 'panel-c'];
  return {
    id: voyageId,
    revision: 0,
    activationSequence: 0,
    historyCursorSequence: 0,
    metadata: {
      name: 'M3.2 harness Voyage',
      mission: null,
      lifecycleState: 'active',
      lastOpenedAt: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    crafts: [{ craftWorkspaceId: workspaceId, sortKey: 'a' }],
    panels: ids.map(panel),
    layout: productionDockviewSnapshotCodec.validateAndCanonicalize(snapshot(ids)),
    history: [],
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

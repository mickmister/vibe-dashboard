import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Orientation, type SerializedDockview } from 'dockview';
import { FormattedMessage } from 'react-intl';
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
import type { CoordinatorVisibleState, DockviewMutationApi, DockviewMutationCoordinator, DockviewMutationRepository } from './DockviewMutationCoordinator';
import { createDockviewM32HarnessAggregate } from './DockviewM32HarnessFixture';

const voyageId = 'm3-2-harness-voyage';
const workspaceId = 'workspace-a';
const emptyVisibleValue = 'none';

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
        <FormattedMessage
          defaultMessage="Loading DockView M3.2 harness"
          description="Loading text for the DockView M3.2 serialized mutation coordinator harness."
        />
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
        <button type="button" onClick={() => run(() => coordinator.current?.focusPanelFromCommand('panel-d', () => focusDockviewPanel(dockviewApi.current, 'panel-d')))}>
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
  loadDockviewM32HarnessVoyage(input?: { voyageId?: string }): Promise<VoyageAggregate | Promise<VoyageAggregate>>;
}): DockviewMutationRepository {
  return {
    commitLayoutMutation: async (mutation) => actions.commitDockviewM32HarnessLayoutMutation(mutation),
    recordActivation: async (voyageId, panelId, expectedRevision) =>
      actions.recordDockviewM32HarnessActivation({ voyageId, panelId, expectedRevision }),
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

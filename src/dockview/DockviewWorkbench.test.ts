import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { IntlProvider } from 'react-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Orientation, type SerializedDockview } from 'dockview';
import {
  DockviewWorkbench,
  DockviewPanelContent,
  createDockviewControllerCache,
  restoreDockviewController,
  type DockviewControllerApi,
} from './DockviewWorkbench';
import { DockviewM32HarnessRoute } from './DockviewM32HarnessRoute';
import type { DockviewMutationCoordinator, DockviewMutationRepository } from './DockviewMutationCoordinator';
import { productionDockviewSnapshotCodec } from '../store/dockviewSnapshotCodec';
import type { PanelTargetResolutionContext } from '../store/panelTargetRegistry';
import {
  VoyageConflictError,
  type VoyageAggregate,
} from '../store/voyageRepository';

const hostOrigin = 'https://vd.test';
const workspaceId = 'workspace-a';
const craftWorkspaceId = workspaceId;
const craftId = 'craft-a';

const dockviewReactBoundary = vi.hoisted(() => ({
  panelMarkupDuringFromJSON: '',
  api: undefined as DockviewControllerApi | undefined,
  activeListeners: [] as Array<(event: { panel?: { id: string } | null }) => void>,
  layoutListeners: [] as Array<() => void>,
}));

vi.mock('dockview-react', async () => {
  const ReactModule = await import('react');
  const server = await import('react-dom/server');
  return {
    DockviewReact: (props: {
      components: Record<string, React.ComponentType<{ params?: { panelId?: string }; api: { id: string } }>>;
      onReady: (event: { api: DockviewControllerApi }) => void;
    }) => {
      const api: DockviewControllerApi = {
        fromJSON(snapshotValue) {
          const panelId = Object.keys(snapshotValue.panels)[0] ?? 'panel-a';
          const Component = props.components['iframe-panel'];
          if (!Component) throw new Error('missing iframe-panel component');
          dockviewReactBoundary.panelMarkupDuringFromJSON = server.renderToStaticMarkup(
            ReactModule.createElement(Component, {
              params: { panelId },
              api: { id: panelId },
            }),
          );
        },
        toJSON: () => snapshot(['panel-a']),
        onDidActivePanelChange(listener) {
          dockviewReactBoundary.activeListeners.push(listener);
          return { dispose: vi.fn() };
        },
        onDidLayoutChange(listener) {
          dockviewReactBoundary.layoutListeners.push(listener);
          return { dispose: vi.fn() };
        },
      };
      dockviewReactBoundary.api = api;
      props.onReady({ api });
      return ReactModule.createElement('div', { 'data-dockview-react-mock': 'ready' });
    },
  };
});

vi.mock('react-intl', async () => {
  const ReactModule = await import('react');
  return {
    IntlProvider: ({ children }: React.PropsWithChildren<{ locale: string }>) => ReactModule.createElement(ReactModule.Fragment, null, children),
    FormattedMessage: ({ defaultMessage }: { defaultMessage: string }) => ReactModule.createElement(ReactModule.Fragment, null, defaultMessage),
  };
});

beforeEach(() => {
  dockviewReactBoundary.panelMarkupDuringFromJSON = '';
  dockviewReactBoundary.api = undefined;
  dockviewReactBoundary.activeListeners = [];
  dockviewReactBoundary.layoutListeners = [];
});

function context(): PanelTargetResolutionContext {
  const location = 'https://vk.test/workspaces/workspace-a';
  return {
    craftId,
    hostOrigin,
    crafts: { [craftId]: { workspaceId, allowedPluginTargets: [] } },
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
      [`craft-overview:${workspaceId}`]: { deliveryUrl: location, upstreamOrigin: 'https://vk.test' },
    },
  };
}

function snapshot(panelIds: string[]): SerializedDockview {
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
    activeGroup: panelIds[0] ? `group-${panelIds[0]}` : undefined,
  };
}

function aggregate(input: {
  id?: string;
  panels?: Array<{ id: string; craftWorkspaceId?: string; payload?: { workspaceId: string } }>;
  snapshot?: unknown;
} = {}): VoyageAggregate {
  const panels = input.panels ?? [{ id: 'panel-a', craftWorkspaceId }];
  const layout = productionDockviewSnapshotCodec.validateAndCanonicalize(
    input.snapshot ?? snapshot(panels.map(({ id }) => id)),
  );
  return {
    id: input.id ?? 'voyage-a',
    revision: 7,
    activationSequence: 0,
    historyCursorSequence: 0,
    metadata: {
      name: 'Voyage A',
      mission: null,
      lifecycleState: 'active',
      lastOpenedAt: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    crafts: [{ craftWorkspaceId, sortKey: 'a' }],
    panels: panels.map((panel) => ({
      id: panel.id,
      craftWorkspaceId: panel.craftWorkspaceId ?? null,
      targetKind: 'craft-overview',
      targetVersion: 1,
      targetPayload: panel.payload ?? { workspaceId },
      titleMode: 'automatic',
      customTitle: null,
      closePolicy: 'closable',
      lastActivatedSequence: null,
    })),
    layout,
    history: [],
  };
}

function mutationRepository(seed = aggregate()) {
  let current = seed;
  const commits: Array<{ expectedRevision: number; panelIds: string[] }> = [];
  const activations: Array<{ panelId: string; expectedRevision: number }> = [];
  const repo: DockviewMutationRepository = {
    async commitLayoutMutation(input) {
      commits.push({ expectedRevision: input.expectedRevision, panelIds: input.panels.map(({ id }) => id) });
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
      activations.push({ panelId, expectedRevision });
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
  return {
    repo,
    commits,
    activations,
    get current() {
      return current;
    },
    set current(value: VoyageAggregate) {
      current = value;
    },
  };
}

function api(): DockviewControllerApi {
  return {
    fromJSON: vi.fn(),
    toJSON: vi.fn(),
  };
}

describe('Dockview M3.1 controller restore and Panel rendering', () => {
  it('keeps exactly one warm controller per Voyage and evicts oldest controllers deterministically', () => {
    const disposed: string[] = [];
    const cache = createDockviewControllerCache({ warmLimit: 2, onDispose: (controller) => disposed.push(controller.voyageId) });

    const first = cache.get('voyage-a');
    expect(cache.get('voyage-a')).toBe(first);
    const second = cache.get('voyage-b');
    const third = cache.get('voyage-c');

    expect(cache.get('voyage-b')).toBe(second);
    expect(cache.get('voyage-c')).toBe(third);
    expect(disposed).toEqual(['voyage-a']);
  });

  it('validates and resolves every Panel before calling Dockview fromJSON', () => {
    const dockview = api();
    const result = restoreDockviewController({
      api: dockview,
      aggregate: aggregate(),
      contextForCraft: () => context(),
    });

    expect(result.status).toBe('restored');
    expect(dockview.fromJSON).toHaveBeenCalledTimes(1);
    expect(dockview.fromJSON).toHaveBeenCalledWith(snapshot(['panel-a']));
    expect(result.panels.map(({ id, resolved }) => [id, resolved.status])).toEqual([['panel-a', 'resolved']]);
  });

  it('never restores or renders unsafe targets from malformed target payloads', () => {
    const dockview = api();
    const quarantine = vi.fn();
    const result = restoreDockviewController({
      api: dockview,
      aggregate: aggregate({ panels: [{ id: 'panel-a', craftWorkspaceId, payload: { workspaceId: 'foreign' } }] }),
      contextForCraft: () => context(),
      onQuarantine: quarantine,
    });

    expect(result.status).toBe('quarantined');
    expect(quarantine).toHaveBeenCalledWith(expect.objectContaining({
      voyageId: 'voyage-a',
      reason: 'workspace-owner-mismatch',
    }));
    expect(dockview.fromJSON).toHaveBeenCalledTimes(1);
    expect(dockview.fromJSON).toHaveBeenCalledWith(snapshot([]));
    expect(result.panels).toEqual([]);

    const markup = renderToStaticMarkup(
      React.createElement(DockviewPanelContent, {
        panelId: 'panel-a',
        controller: result.controller,
      }),
    );
    expect(markup).toContain('Panel recovery');
    expect(markup).not.toContain('<iframe');
  });

  it('quarantines snapshot/domain Panel drift before Dockview can instantiate stale Panels', () => {
    const dockview = api();
    const quarantine = vi.fn();
    const invalidSnapshot = {
      ...snapshot(['panel-a']),
      panels: {
        ...snapshot(['panel-a']).panels,
        stale: {
          id: 'stale',
          contentComponent: 'iframe-panel',
          renderer: 'always',
          params: { panelId: 'stale' },
        },
      },
    };
    const stored = aggregate({ panels: [{ id: 'panel-a', craftWorkspaceId }] });
    const result = restoreDockviewController({
      api: dockview,
      aggregate: { ...stored, layout: { ...stored.layout, snapshot: invalidSnapshot as never } },
      contextForCraft: () => context(),
      onQuarantine: quarantine,
    });
    expect(result.status).toBe('quarantined');
    expect(quarantine).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'invalid-dockview-snapshot',
    }));
    expect(dockview.fromJSON).toHaveBeenCalledWith(snapshot(['panel-a']));
  });

  it('renders resolved Panels from trusted current definitions using stable Panel IDs', () => {
    const result = restoreDockviewController({
      api: api(),
      aggregate: aggregate(),
      contextForCraft: () => context(),
    });
    const markup = renderToStaticMarkup(
      React.createElement(DockviewPanelContent, {
        panelId: 'panel-a',
        controller: result.controller,
      }),
    );

    expect(markup).toContain('data-panel-id="panel-a"');
    expect(markup).toContain('data-renderer-key="craft-overview"');
    expect(markup).toContain('src="https://vk.test/workspaces/workspace-a"');
    expect(markup).toContain('sandbox=');
    expect(markup).not.toContain('foreign');
  });

  it('makes the populated controller visible to Dockview Panel renderers during fromJSON', () => {
    dockviewReactBoundary.panelMarkupDuringFromJSON = '';

    renderToStaticMarkup(
      React.createElement(DockviewWorkbench, {
        aggregate: aggregate(),
        contextForCraft: () => context(),
      }),
    );

    expect(dockviewReactBoundary.panelMarkupDuringFromJSON).toContain('data-renderer-key="craft-overview"');
    expect(dockviewReactBoundary.panelMarkupDuringFromJSON).toContain('<iframe');
    expect(dockviewReactBoundary.panelMarkupDuringFromJSON).not.toContain('Panel recovery');
  });

  it('installs one coordinator at the Workbench boundary so Dockview callbacks persist through it', async () => {
    const stored = aggregate({ panels: [{ id: 'panel-a', craftWorkspaceId }, { id: 'panel-b', craftWorkspaceId }] });
    const store = mutationRepository(stored);
    const coordinators: DockviewMutationCoordinator[] = [];

    renderToStaticMarkup(
      React.createElement(DockviewWorkbench, {
        aggregate: stored,
        contextForCraft: () => context(),
        repository: store.repo,
        onCoordinator: (coordinator) => coordinators.push(coordinator),
      }),
    );

    expect(coordinators).toHaveLength(1);
    expect(dockviewReactBoundary.activeListeners).toHaveLength(1);
    expect(dockviewReactBoundary.layoutListeners).toHaveLength(1);

    dockviewReactBoundary.activeListeners[0]?.({ panel: { id: 'panel-a' } });
    await coordinators[0]!.flush('test');
    expect(store.activations).toEqual([{ panelId: 'panel-a', expectedRevision: 7 }]);

    dockviewReactBoundary.api!.toJSON = () => snapshot(['panel-a', 'panel-b']);
    dockviewReactBoundary.layoutListeners[0]?.();
    await coordinators[0]!.flush('test');
    expect(store.commits).toEqual([]);

    dockviewReactBoundary.api!.toJSON = () => snapshot(['panel-b', 'panel-a']);
    dockviewReactBoundary.layoutListeners[0]?.();
    await coordinators[0]!.flush('test');
    expect(store.commits).toEqual([{ expectedRevision: 8, panelIds: ['panel-a', 'panel-b'] }]);
  });

  it('renders the TEST_CASE_M3_2F semantic browser harness route with labeled controls and visible state', () => {
    const markup = renderToStaticMarkup(
      React.createElement(IntlProvider, { locale: 'en' }, React.createElement(DockviewM32HarnessRoute)),
    );

    expect(markup).toContain('data-testid="dockview-m3-2-harness"');
    expect(markup).toContain('Queue open Panel');
    expect(markup).toContain('Start gesture');
    expect(markup).toContain('Complete gesture');
    expect(markup).toContain('Programmatic focus Panel D');
    expect(markup).toContain('Flush before eviction');
    expect(markup).toContain('DockView M3.2 visible coordinator state');
    expect(markup).toContain('topologyAgreement');
    expect(dockviewReactBoundary.panelMarkupDuringFromJSON).toContain('data-renderer-key="craft-overview"');
  });
});

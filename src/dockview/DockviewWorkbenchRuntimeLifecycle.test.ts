// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Orientation, type SerializedDockview } from 'dockview';
import { DockviewWorkbench, type DockviewControllerApi } from './DockviewWorkbench';
import { getWindowDockviewRuntimeRegistry, getWindowDockviewWarmControllerCache } from './DockviewRuntimeRegistry';
import { productionDockviewSnapshotCodec } from '../store/dockviewSnapshotCodec';
import type { DockviewMutationRepository } from './DockviewMutationCoordinator';
import type { PanelTargetResolutionContext } from '../store/panelTargetRegistry';
import type { VoyageAggregate } from '../store/voyageRepository';

const lifecycle = vi.hoisted(() => ({
  nextApiId: 0,
  disposed: [] as string[],
}));

vi.mock('dockview-react', async () => {
  const ReactModule = await import('react');
  return {
    DockviewReact: (props: {
      components: Record<string, React.ComponentType<{ params?: { panelId?: string }; api: { id: string } }>>;
      onReady: (event: { api: DockviewControllerApi }) => void;
    }) => {
      const [panelIds, setPanelIds] = ReactModule.useState<string[]>([]);
      ReactModule.useEffect(() => {
        const apiId = ++lifecycle.nextApiId;
        const api: DockviewControllerApi = {
          fromJSON(snapshot) {
            setPanelIds(Object.keys(snapshot.panels));
          },
          toJSON: () => snapshot(panelIds.length ? panelIds : ['panel-a']),
          onDidActivePanelChange: () => ({ dispose: () => lifecycle.disposed.push(`active:${apiId}`) }),
          onDidLayoutChange: () => ({ dispose: () => lifecycle.disposed.push(`layout:${apiId}`) }),
        };
        props.onReady({ api });
      }, [props]);
      const Component = props.components['iframe-panel'];
      return ReactModule.createElement(ReactModule.Fragment, null, panelIds.map((panelId) => (
        Component
          ? ReactModule.createElement(Component, { key: panelId, params: { panelId }, api: { id: panelId } })
          : null
      )));
    },
  };
});

const workspaceId = 'workspace-a';
const craftWorkspaceId = workspaceId;

beforeEach(() => {
  lifecycle.nextApiId = 0;
  lifecycle.disposed = [];
  getWindowDockviewRuntimeRegistry().reset();
});

afterEach(() => {
  cleanup();
  getWindowDockviewRuntimeRegistry().reset();
});

describe('DockviewWorkbench M3.4 runtime lifecycle integration', () => {
  it('flushes and disposes production Dockview listeners exactly once on warm-cache eviction and unmount', async () => {
    render(React.createElement(React.Fragment, null,
      workbench('voyage-a'),
      workbench('voyage-b'),
      workbench('voyage-c'),
    ));

    await waitFor(() => expect(getWindowDockviewWarmControllerCache().ids()).toEqual(['voyage-b', 'voyage-c']));
    expect(lifecycle.disposed).toEqual(['active:1', 'layout:1']);

    cleanup();
    await waitFor(() => expect(lifecycle.disposed).toEqual([
      'active:1',
      'layout:1',
      'active:2',
      'layout:2',
      'active:3',
      'layout:3',
    ]));
  });

  it('replaces a stale cached Workbench controller on same-Voyage remount', async () => {
    const aggregate = voyage('voyage-replace', 'First title');
    const view = render(workbench(aggregate.id, aggregate));

    await waitFor(() => expect(getWindowDockviewWarmControllerCache().ids()).toContain(aggregate.id));
    view.rerender(workbench(aggregate.id, voyage(aggregate.id, 'Second title')));

    await waitFor(() => expect(lifecycle.disposed).toEqual(['active:1', 'layout:1']));
    expect(getWindowDockviewWarmControllerCache().ids().filter((id) => id === aggregate.id)).toHaveLength(1);

    cleanup();
    await waitFor(() => expect(lifecycle.disposed).toEqual(['active:1', 'layout:1', 'active:2', 'layout:2']));
  });

  it('keeps a foreground-visible iframe physically retained during same-panel reattach under budget pressure', async () => {
    const aggregate = voyage('voyage-visible', 'First title');
    const { rerender } = render(workbench(aggregate.id, aggregate));
    const runtimeId = `${aggregate.id}:panel-a`;

    await waitFor(() => expect(document.querySelector('iframe[data-panel-id="panel-a"]')).toBeTruthy());
    const firstIframe = document.querySelector('iframe[data-panel-id="panel-a"]') as HTMLIFrameElement;
    const bootId = getWindowDockviewRuntimeRegistry().requireRuntime(runtimeId).bootId;

    getWindowDockviewRuntimeRegistry().setIframeLimit(0);
    rerender(workbench(aggregate.id, voyage(aggregate.id, 'Second title')));

    await waitFor(() => {
      expect(document.querySelector('iframe[data-panel-id="panel-a"]')).toBe(firstIframe);
      expect(getWindowDockviewRuntimeRegistry().requireRuntime(runtimeId).bootId).toBe(bootId);
    });
    expect(getWindowDockviewRuntimeRegistry().status().reloadDisclosures[runtimeId]).toBeUndefined();
  });
});

function workbench(voyageId: string, aggregate = voyage(voyageId)) {
  return React.createElement(DockviewWorkbench, {
    aggregate,
    contextForCraft: () => context(),
    repository: repository(aggregate),
  });
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

function voyage(id: string, title = 'Panel title'): VoyageAggregate {
  const layout = productionDockviewSnapshotCodec.validateAndCanonicalize(snapshot(['panel-a']));
  return {
    id,
    revision: 1,
    activationSequence: 0,
    historyCursorSequence: 0,
    metadata: {
      name: id,
      mission: null,
      lifecycleState: 'active',
      lastOpenedAt: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    crafts: [{ craftWorkspaceId, sortKey: 'a' }],
    panels: [{
      id: 'panel-a',
      craftWorkspaceId,
      targetKind: 'craft-overview',
      targetVersion: 1,
      targetPayload: { workspaceId },
      titleMode: 'custom',
      customTitle: title,
      closePolicy: 'closable',
      lastActivatedSequence: null,
    }],
    layout,
    history: [],
  };
}

function context(): PanelTargetResolutionContext {
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

function repository(seed: VoyageAggregate): DockviewMutationRepository {
  return {
    async commitLayoutMutation() {
      return seed.revision;
    },
    async recordActivation() {
      return false;
    },
    async undo() {
      return false;
    },
    async redo() {
      return false;
    },
    async loadVoyage() {
      return seed;
    },
  };
}

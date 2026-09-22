import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Orientation, type SerializedDockview } from 'dockview';
import {
  DockviewPanelContent,
  createDockviewControllerCache,
  restoreDockviewController,
  type DockviewControllerApi,
} from './DockviewWorkbench';
import { productionDockviewSnapshotCodec } from '../store/dockviewSnapshotCodec';
import type { PanelTargetResolutionContext } from '../store/panelTargetRegistry';
import type { VoyageAggregate } from '../store/voyageRepository';

const hostOrigin = 'https://vd.test';
const workspaceId = 'workspace-a';
const craftWorkspaceId = workspaceId;
const craftId = 'craft-a';

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
});

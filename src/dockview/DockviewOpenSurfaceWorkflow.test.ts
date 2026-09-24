import Database from 'better-sqlite3';
import { Orientation } from 'dockview';
import { Kysely, SqliteDialect } from 'kysely';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { migrateExternalIntegrationsDb } from '../modules/plugins/kanban/server/migrate';
import type { DB } from '../store/kysely_types';
import { productionDockviewSnapshotCodec } from '../store/dockviewSnapshotCodec';
import type { JsonObject, PanelTargetResolutionContext } from '../store/panelTargetRegistry';
import {
  VoyageRepository,
  type StructuralPanelHistoryRecord,
} from '../store/voyageRepository';
import { DockviewOpenSurfaceWorkflow } from './DockviewOpenSurfaceWorkflow';

const workspaceId = 'workspace-a';

function panel(id: string, targetKind = 'agent-session', targetPayload: JsonObject = { workspaceId, sessionId: 'agent-1' }): StructuralPanelHistoryRecord {
  return {
    id,
    craftWorkspaceId: workspaceId,
    targetKind,
    targetVersion: 1,
    targetPayload,
    titleMode: 'automatic',
    customTitle: null,
    closePolicy: 'closable',
  };
}

function codePanel(id: string): StructuralPanelHistoryRecord {
  return panel(id, 'code', { workspaceId, folderIntent: 'workspace-root' });
}

function snapshot(ids: string[], activePanelId = ids[0]) {
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
    activeGroup: `group-${activePanelId}`,
  };
}

function context(): PanelTargetResolutionContext {
  return {
    craftId: workspaceId,
    hostOrigin: 'https://dashboard.example.test',
    crafts: { [workspaceId]: { workspaceId, allowedPluginTargets: [] } },
    workspaces: {
      [workspaceId]: {
        id: workspaceId,
        available: true,
        directory: '/workspace-a',
        origin: 'https://vk.example.test',
        repositoryIds: [],
        locations: {
          overview: '/overview',
          code: '/code',
          changes: '/changes',
          beads: '/beads',
          forms: '/forms',
        },
      },
    },
    agentSessions: { 'agent-1': { workspaceId, location: '/agent-1' } },
    terminals: {},
    previews: {},
    builtInRoutes: {},
    redirectGuards: {
      [`agent-session:agent-1`]: { deliveryUrl: 'https://dashboard.example.test/guard/agent', upstreamOrigin: 'https://vk.example.test' },
      [`code:${workspaceId}`]: { deliveryUrl: 'https://dashboard.example.test/guard/code', upstreamOrigin: 'https://vk.example.test' },
    },
  };
}

describe('DockviewOpenSurfaceWorkflow', () => {
  let sqlite: Database.Database;
  let db: Kysely<DB>;
  let repository: VoyageRepository;

  beforeEach(async () => {
    sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    db = new Kysely<DB>({ dialect: new SqliteDialect({ database: sqlite }) });
    await migrateExternalIntegrationsDb(db);
    repository = new VoyageRepository(db, { snapshotCodec: productionDockviewSnapshotCodec });
  });

  afterEach(async () => {
    await db.destroy();
    sqlite.close();
  });

  async function create(ids: string[], panels: StructuralPanelHistoryRecord[]) {
    await repository.createVoyage({
      id: 'voyage',
      name: 'Voyage',
      crafts: [{ craftWorkspaceId: workspaceId, sortKey: '0' }],
      panels,
      snapshot: snapshot(ids),
    });
  }

  it('opens Code beside an Agent idempotently through Voyage commands', async () => {
    await create(['agent'], [panel('agent')]);
    const presentation = { focusPanel: vi.fn(), maximizePanel: vi.fn() };
    const workflow = new DockviewOpenSurfaceWorkflow({
      repository,
      presentation,
      contextForCraft: () => context(),
    });

    const first = await workflow.open({
      voyageId: 'voyage',
      expectedRevision: 0,
      invokingPanelId: 'agent',
      surface: 'code',
      intent: 'beside',
    });
    expect(first).toMatchObject({ created: true, moved: false, focusedOnly: false, panelId: 'code-workspace-a', revision: 1 });
    let aggregate = await repository.loadVoyage('voyage');
    expect(aggregate.panels.map(({ id }) => id).sort()).toEqual(['agent', 'code-workspace-a']);
    expect(aggregate.panels.find(({ id }) => id === 'code-workspace-a')?.lastActivatedSequence).toBe(1);
    expect(aggregate.history).toHaveLength(2);

    const second = await workflow.open({
      voyageId: 'voyage',
      expectedRevision: 1,
      invokingPanelId: 'agent',
      surface: 'code',
      intent: 'beside',
    });
    expect(second).toMatchObject({ created: false, moved: false, focusedOnly: true, panelId: 'code-workspace-a', revision: 1 });
    aggregate = await repository.loadVoyage('voyage');
    expect(aggregate.panels.map(({ id }) => id).sort()).toEqual(['agent', 'code-workspace-a']);
    expect(aggregate.history).toHaveLength(2);
    expect(presentation.focusPanel).toHaveBeenCalledWith('code-workspace-a');
  });

  it('moves an existing same-Voyage equivalent Code Panel beside the invoking Agent', async () => {
    await create(['agent', 'notes', 'code-old'], [panel('agent'), panel('notes', 'forms', { workspaceId }), codePanel('code-old')]);
    await repository.recordActivation('voyage', 'code-old', 0);
    const workflow = new DockviewOpenSurfaceWorkflow({ repository, contextForCraft: () => context() });

    const result = await workflow.open({
      voyageId: 'voyage',
      expectedRevision: 1,
      invokingPanelId: 'agent',
      surface: 'code',
      intent: 'beside',
    });

    expect(result).toMatchObject({ created: false, moved: true, panelId: 'code-old', revision: 2 });
    const aggregate = await repository.loadVoyage('voyage');
    const canonical = productionDockviewSnapshotCodec.validateAndCanonicalize(aggregate.layout.snapshot).snapshot as unknown as ReturnType<typeof snapshot>;
    const order = ((canonical.grid.root as { data: Array<{ data: { activeView: string } }> }).data).map(({ data }) => data.activeView);
    expect(order.slice(0, 2)).toEqual(['agent', 'code-old']);
  });

  it('opens maximized Code without browser fullscreen and without moving existing placement', async () => {
    await create(['agent', 'notes', 'code-old'], [panel('agent'), panel('notes', 'forms', { workspaceId }), codePanel('code-old')]);
    const presentation = { focusPanel: vi.fn(), maximizePanel: vi.fn() };
    const workflow = new DockviewOpenSurfaceWorkflow({ repository, presentation, contextForCraft: () => context() });

    const result = await workflow.open({
      voyageId: 'voyage',
      expectedRevision: 0,
      invokingPanelId: 'agent',
      surface: 'code',
      intent: 'maximized',
    });

    expect(result).toMatchObject({ panelId: 'code-old', revision: 1, created: false, moved: false, focusedOnly: true, presentation: 'maximized' });
    expect(presentation.maximizePanel).toHaveBeenCalledWith('code-old');
    const aggregate = await repository.loadVoyage('voyage');
    expect(aggregate.history).toHaveLength(2);
    const order = ((aggregate.layout.snapshot as unknown as { grid: { root: { data: Array<{ data: { activeView: string } }> } } }).grid.root.data)
      .map(({ data }) => data.activeView);
    expect(order).toEqual(['agent', 'notes', 'code-old']);
    expect((aggregate.layout.snapshot as unknown as { grid: { maximizedNode?: { location: number[] } } }).grid.maximizedNode).toEqual({ location: [2] });
  });

  it('uses a maximized narrow fallback for Open beside without browser fullscreen', async () => {
    await create(['agent'], [panel('agent')]);
    const presentation = { focusPanel: vi.fn(), maximizePanel: vi.fn() };
    const workflow = new DockviewOpenSurfaceWorkflow({
      repository,
      presentation,
      splitMinWidth: 700,
      contextForCraft: () => context(),
    });

    const result = await workflow.open({
      voyageId: 'voyage',
      expectedRevision: 0,
      invokingPanelId: 'agent',
      surface: 'code',
      intent: 'beside',
    });

    expect(result).toMatchObject({ created: true, panelId: 'code-workspace-a', revision: 1 });
    expect(presentation.maximizePanel).toHaveBeenCalledWith('code-workspace-a');
    const aggregate = await repository.loadVoyage('voyage');
    expect((aggregate.layout.snapshot as unknown as { grid: { maximizedNode?: { location: number[] } } }).grid.maximizedNode).toEqual({ location: [1] });
  });
});

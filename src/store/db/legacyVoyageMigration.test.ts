/* eslint-disable formatjs/no-literal-string-in-object -- persistence fixtures intentionally use exact legacy strings */
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { initExternalIntegrationsDb as initDatabase, type ExternalIntegrationsDbHandle } from '../../modules/plugins/kanban/server/database';
import { getPluginRegistrySnapshot } from '../../modules/plugins/vibe-dashboard/registry';
import {
  FIRST_PARTY_AGENT_PLUGIN_ID,
  FIRST_PARTY_AGENT_SURFACE_KEY,
  FIRST_PARTY_CODE_PLUGIN_ID,
  FIRST_PARTY_CODE_SURFACE_KEY,
  FIRST_PARTY_FORMS_PLUGIN_ID,
  FIRST_PARTY_FORMS_SURFACE_KEY,
} from '../../modules/plugins/vibe-dashboard/craft-surfaces';
import {
  createEmptyPluginRegistryState,
  type PluginRegistryState,
} from '../../modules/plugins/vibe-dashboard/types';
import type { PanelTargetResolutionContext } from '../panelTargetRegistry';
import { productionDockviewSnapshotCodec } from '../dockviewSnapshotCodec';
import {
  LEGACY_SESSIONS_KEY,
  LEGACY_VOYAGE_MIGRATION_ID,
  LEGACY_WORKSPACE_KEY,
  assertOccurrenceOutputs,
  readLegacyVoyageSource,
} from './data_migrations/20260917100000_migrate_legacy_voyages';

const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

async function paths() {
  const directory = await mkdtemp(join(tmpdir(), 'vd-legacy-voyages-'));
  directories.push(directory);
  return { sourcePath: join(directory, 'configured-kv.db'), targetPath: join(directory, 'vd.sqlite') };
}

function trustedTestContext(
  craft: { id: string },
  workspaceId: string,
  pluginRegistry: PluginRegistryState = getPluginRegistrySnapshot(),
): PanelTargetResolutionContext {
  const craftId = craft.id;
  const origin = 'https://trusted.test';
  return {
    craftId, hostOrigin: origin,
    crafts: { [craftId]: { workspaceId, allowedPluginTargets: [...Object.keys(pluginRegistry.internalRoutes), ...Object.keys(pluginRegistry.craftSurfaces)] } },
    workspaces: { [workspaceId]: { id: workspaceId, available: true, directory: '/trusted', origin, repositoryIds: [], locations: { overview: '/overview', code: '/code', changes: '/changes', beads: '/beads', forms: '/forms' } } },
    agentSessions: {}, terminals: {}, previews: {}, builtInRoutes: {},
    redirectGuards: Object.fromEntries(['craft-overview', 'code', 'changes', 'beads', 'forms'].map((kind) => [`${kind}:${workspaceId}`, { deliveryUrl: `${origin}/guard/${kind}`, upstreamOrigin: origin }])),
    getPluginRegistry: () => pluginRegistry,
  };
}

function firstPartySurfaceRegistry(): PluginRegistryState {
  const registry = createEmptyPluginRegistryState();
  registry.craftSurfaces[FIRST_PARTY_AGENT_SURFACE_KEY] = {
    pluginId: FIRST_PARTY_AGENT_PLUGIN_ID,
    sourceKey: 'agent',
    key: FIRST_PARTY_AGENT_SURFACE_KEY,
    title: 'Agent',
    defaultTitle: 'Agent',
    urlTemplate: '{{origin}}/workspaces/{{workspaceId}}',
    order: 10,
  };
  registry.craftSurfaces[FIRST_PARTY_CODE_SURFACE_KEY] = {
    pluginId: FIRST_PARTY_CODE_PLUGIN_ID,
    sourceKey: 'code',
    key: FIRST_PARTY_CODE_SURFACE_KEY,
    title: 'Code',
    defaultTitle: 'Code',
    urlTemplate: '{{origin}}/?folder={{containerRef}}',
    order: 20,
  };
  registry.craftSurfaces[FIRST_PARTY_FORMS_SURFACE_KEY] = {
    pluginId: FIRST_PARTY_FORMS_PLUGIN_ID,
    sourceKey: 'forms',
    key: FIRST_PARTY_FORMS_SURFACE_KEY,
    title: 'Forms',
    defaultTitle: 'Forms',
    urlTemplate: 'internal://forms',
    order: 40,
  };
  return registry;
}

type InitOptions = Parameters<typeof initDatabase>[0];
function initExternalIntegrationsDb(options: InitOptions = {}): Promise<ExternalIntegrationsDbHandle> {
  return initDatabase({ ...options, dataMigrationDependencies: {
    ...options.dataMigrationDependencies,
    services: { legacyTargetContextForCraft: trustedTestContext, ...options.dataMigrationDependencies?.services },
  } });
}

function sourceDatabase(sourcePath: string, workspace: unknown, sessions: unknown): Database.Database {
  const sqlite = new Database(sourcePath);
  sqlite.exec('CREATE TABLE kvstore (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL UNIQUE, value TEXT NOT NULL)');
  const insert = sqlite.prepare('INSERT INTO kvstore (key, value) VALUES (?, ?)');
  insert.run(LEGACY_WORKSPACE_KEY, JSON.stringify(workspace));
  insert.run(LEGACY_SESSIONS_KEY, JSON.stringify(sessions));
  return sqlite;
}

const workspace = {
  spaces: [{ id: 'space-home', name: 'Home', icon: 'home', tabGroupIds: ['tg_home', 'craft-vk', 'craft-other'] }],
  tabGroups: [
    { id: 'tg_home', label: 'Overview', tabs: [{ id: 'tab_overview', title: 'Overview', url: 'internal://spaces-overview' }], pairs: [], order: 0 },
    {
      id: 'craft-vk', label: 'VK Craft', workspace: { workspaceId: 'vk-workspace-1', workspaceDir: '/legacy/private/path' }, order: 1,
      tabs: [
        { id: 'code', title: 'Code', url: 'https://stale.invalid/code' },
        { id: 'docs', title: 'Docs', url: 'https://docs.example.test/start' },
        { id: 'removed-plugin', title: 'Removed plugin', url: 'internal://plugins/removed/missing' },
        { id: 'craft-surface:craft-vk:preview', title: 'Generated', url: 'https://attacker.invalid', ephemeral: { kind: 'craft-surface', pluginId: 'gone', surfaceKey: 'preview', sourceKey: 'preview' } },
      ],
      pairs: [{ id: 'code+docs', tabIds: ['code', 'docs'], ratios: [50, 50] }],
    },
    { id: 'craft-other', label: 'Notes', tabs: [{ id: 'note', title: 'Note', url: 'https://notes.example.test' }], pairs: [], order: 2 },
  ],
  nextId: 20,
};

function session(id: string, entries: Array<{ id: string; tabGroupId: string; viewIds: string[] }>) {
  return {
    id, slug: id, name: id, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z',
    activeVoyageEntryId: entries.at(-1)?.id ?? '', voyageEntries: entries,
    activeSpaceId: 'space-home', activeTabGroupId: entries.at(-1)?.tabGroupId ?? '',
    activeItemsByVoyageEntryId: Object.fromEntries(entries.map((entry) => [entry.id, entry.viewIds[0] ?? ''])),
    visitedTabGroupIds: entries.map((entry) => entry.tabGroupId),
  };
}

describe('legacy Springboard Voyage data migration', () => {
  it('rejects missing, duplicate, orphaned, and extra output mappings', () => {
    const output = (reference: string, voyageId = 'voyage-a', craftWorkspaceId: string | null = 'craft-a') => ({ reference, voyageId, craftWorkspaceId });
    const diagnostic = (outputRefs: string[], voyageId = 'voyage-a', craftWorkspaceId: string | null = 'craft-a') => ({ outcome: 'migrated' as const, outputRefs, voyageId, craftWorkspaceId });
    expect(() => assertOccurrenceOutputs([diagnostic(['panel:a'])], [output('panel:b')]))
      .toThrowError(expect.objectContaining({ code: 'AUDIT_IMBALANCE' }));
    expect(() => assertOccurrenceOutputs([
      diagnostic(['panel:a']), diagnostic(['panel:a']),
    ], [output('panel:a')])).toThrowError(expect.objectContaining({ code: 'AUDIT_IMBALANCE' }));
    expect(() => assertOccurrenceOutputs([{ outcome: 'skipped', outputRefs: ['panel:a'], voyageId: null, craftWorkspaceId: null }], [output('panel:a')]))
      .toThrowError(expect.objectContaining({ code: 'AUDIT_IMBALANCE' }));
    expect(() => assertOccurrenceOutputs([], [output('panel:a')]))
      .toThrowError(expect.objectContaining({ code: 'AUDIT_IMBALANCE' }));
    expect(() => assertOccurrenceOutputs([diagnostic(['panel:a'], 'voyage-b')], [output('panel:a')]))
      .toThrowError(expect.objectContaining({ code: 'AUDIT_IMBALANCE' }));
    expect(() => assertOccurrenceOutputs([diagnostic(['panel:a'], 'voyage-a', 'craft-b')], [output('panel:a')]))
      .toThrowError(expect.objectContaining({ code: 'AUDIT_IMBALANCE' }));
  });

  it('uses the configured source, skips homepage-only state, and migrates mixed VK content deterministically', async () => {
    const configured = await paths();
    const source = sourceDatabase(configured.sourcePath, workspace, { version: 3, data: [
      session('homepage-only', [{ id: 'home', tabGroupId: 'tg_home', viewIds: ['tab_overview'] }]),
      session('mixed', [
        { id: 'mixed-home', tabGroupId: 'tg_home', viewIds: ['tab_overview'] },
        { id: 'non-vk', tabGroupId: 'craft-other', viewIds: ['note'] },
        { id: 'vk-code', tabGroupId: 'craft-vk', viewIds: ['code'] },
      ]),
    ] });
    const sourceBefore = source.prepare('SELECT key, value FROM kvstore ORDER BY key').all();
    source.close();

    const handle = await initExternalIntegrationsDb({ path: configured.targetPath, sourcePath: configured.sourcePath });
    let deterministicRows: unknown;
    try {
      expect(handle.appliedDataMigrations).toEqual([LEGACY_VOYAGE_MIGRATION_ID]);
      const voyages = handle.sqlite.prepare('SELECT id, name, activationSequence, historyCursorSequence FROM Voyage').all() as Array<Record<string, unknown>>;
      expect(voyages).toHaveLength(1);
      expect(voyages[0]).toMatchObject({ name: 'mixed', activationSequence: 2, historyCursorSequence: 0 });
      expect(handle.sqlite.prepare('SELECT craftWorkspaceId FROM VoyageCraft').all()).toEqual([{ craftWorkspaceId: 'vk-workspace-1' }]);
      const panels = handle.sqlite.prepare('SELECT targetKind, targetPayloadJson, lastActivatedSequence FROM VoyagePanel').all() as Array<Record<string, unknown>>;
      expect(panels).toHaveLength(1);
      expect(panels[0]?.targetKind).toBe('code');
      expect(panels[0]?.targetPayloadJson).not.toContain('/legacy/private/path');
      expect(handle.sqlite.prepare('SELECT COUNT(*) AS count FROM VoyageLayout').get()).toEqual({ count: 1 });
      expect(handle.sqlite.prepare('SELECT COUNT(*) AS count FROM VoyageHistory').get()).toEqual({ count: 1 });
      const diagnostics = handle.sqlite.prepare('SELECT sourceKind, outcome, reasonCode FROM VoyageMigrationDiagnostic ORDER BY sourceKind, reasonCode').all() as Array<Record<string, unknown>>;
      expect(diagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({ sourceKind: 'voyage', outcome: 'skipped', reasonCode: 'homepage-representation' }),
        expect.objectContaining({ sourceKind: 'craft-occurrence', outcome: 'skipped', reasonCode: 'non-vk-craft' }),
        expect.objectContaining({ sourceKind: 'view-selection', outcome: 'skipped', reasonCode: 'homepage-representation' }),
      ]));
      expect(handle.sqlite.prepare("SELECT COUNT(*) AS count FROM VoyageMigrationDiagnostic WHERE outcome NOT IN ('migrated','skipped','quarantined')").get()).toEqual({ count: 0 });
      const audit = handle.sqlite.prepare("SELECT detailsJson FROM VoyageMigrationDiagnostic WHERE sourceKind = 'audit-summary'").get() as { detailsJson: string };
      const counts = JSON.parse(audit.detailsJson) as { source: number; migrated: number; skipped: number; quarantined: number };
      expect(counts.migrated + counts.skipped + counts.quarantined).toBe(counts.source);
      deterministicRows = {
        voyages: handle.sqlite.prepare('SELECT id, name, activationSequence FROM Voyage ORDER BY id').all(),
        panels: handle.sqlite.prepare('SELECT id, voyageId, targetKind, targetPayloadJson FROM VoyagePanel ORDER BY id').all(),
        layouts: handle.sqlite.prepare('SELECT voyageId, snapshotJson, snapshotHash FROM VoyageLayout ORDER BY voyageId').all(),
        diagnostics: handle.sqlite.prepare('SELECT id, sourceKind, sourceId, outcome, reasonCode FROM VoyageMigrationDiagnostic ORDER BY id').all(),
      };
    } finally { await handle.db.destroy(); handle.sqlite.close(); }

    const deterministicTarget = join(configured.targetPath, '..', 'deterministic.sqlite');
    const repeated = await initExternalIntegrationsDb({ path: deterministicTarget, sourcePath: configured.sourcePath });
    expect({
      voyages: repeated.sqlite.prepare('SELECT id, name, activationSequence FROM Voyage ORDER BY id').all(),
      panels: repeated.sqlite.prepare('SELECT id, voyageId, targetKind, targetPayloadJson FROM VoyagePanel ORDER BY id').all(),
      layouts: repeated.sqlite.prepare('SELECT voyageId, snapshotJson, snapshotHash FROM VoyageLayout ORDER BY voyageId').all(),
      diagnostics: repeated.sqlite.prepare('SELECT id, sourceKind, sourceId, outcome, reasonCode FROM VoyageMigrationDiagnostic ORDER BY id').all(),
    }).toEqual(deterministicRows);
    await repeated.db.destroy(); repeated.sqlite.close();

    const rerun = await initExternalIntegrationsDb({ path: configured.targetPath, sourcePath: join(configured.sourcePath, 'missing-after-completion') });
    expect(rerun.appliedDataMigrations).toEqual([]);
    expect(rerun.sqlite.prepare('SELECT COUNT(*) AS count FROM Voyage').get()).toEqual({ count: 1 });
    await rerun.db.destroy(); rerun.sqlite.close();
    const unchangedSource = new Database(configured.sourcePath, { readonly: true });
    expect(unchangedSource.prepare('SELECT key, value FROM kvstore ORDER BY key').all()).toEqual(sourceBefore);
    unchangedSource.close();
  });

  it('records a fresh configured installation without inventing normalized state', async () => {
    const configured = await paths();
    const handle = await initExternalIntegrationsDb({ path: configured.targetPath, sourcePath: configured.sourcePath });
    try {
      expect(handle.appliedDataMigrations).toEqual([LEGACY_VOYAGE_MIGRATION_ID]);
      expect(handle.sqlite.prepare('SELECT COUNT(*) AS count FROM Voyage').get()).toEqual({ count: 0 });
      expect(handle.sqlite.prepare('SELECT sourceKind, outcome, reasonCode FROM VoyageMigrationDiagnostic').all()).toEqual([
        { sourceKind: 'installation', outcome: 'skipped', reasonCode: 'fresh-install' },
      ]);
    } finally { await handle.db.destroy(); handle.sqlite.close(); }
  });

  it('accepts the production raw-array session container', async () => {
    const configured = await paths();
    sourceDatabase(configured.sourcePath, workspace, [session('raw-array', [
      { id: 'code-entry', tabGroupId: 'craft-vk', viewIds: ['code'] },
    ])]).close();
    const handle = await initExternalIntegrationsDb({ path: configured.targetPath, sourcePath: configured.sourcePath });
    try {
      expect(handle.sqlite.prepare('SELECT name FROM Voyage').all()).toEqual([{ name: 'raw-array' }]);
      expect(handle.sqlite.prepare('SELECT targetKind FROM VoyagePanel').all()).toEqual([{ targetKind: 'code' }]);
    } finally { await handle.db.destroy(); handle.sqlite.close(); }
  });

  it('classifies each homepage representation independently without creating homepage state', async () => {
    const configured = await paths();
    const homepageSignals = {
      ...workspace,
      tabGroups: workspace.tabGroups.map((craft) => craft.id === 'craft-vk' ? {
        ...craft,
        tabs: [
          { id: 'tab_overview', title: 'By ID', url: 'https://example.test/id' },
          { id: 'by-url', title: 'By URL', url: 'internal://spaces-overview' },
          { id: 'code', title: 'Code', url: 'https://stale.invalid/code' },
        ],
      } : craft),
    };
    sourceDatabase(configured.sourcePath, homepageSignals, { version: 2, data: [session('signals', [
      { id: 'group-signal', tabGroupId: 'tg_home', viewIds: ['tab_overview'] },
      { id: 'id-signal', tabGroupId: 'craft-vk', viewIds: ['tab_overview'] },
      { id: 'url-signal', tabGroupId: 'craft-vk', viewIds: ['by-url'] },
      { id: 'valid', tabGroupId: 'craft-vk', viewIds: ['code'] },
    ])] }).close();
    const handle = await initExternalIntegrationsDb({ path: configured.targetPath, sourcePath: configured.sourcePath });
    try {
      expect(handle.sqlite.prepare('SELECT COUNT(*) AS count FROM Voyage').get()).toEqual({ count: 1 });
      expect(handle.sqlite.prepare('SELECT COUNT(*) AS count FROM VoyagePanel').get()).toEqual({ count: 1 });
      expect(handle.sqlite.prepare("SELECT COUNT(*) AS count FROM VoyageMigrationDiagnostic WHERE sourceKind = 'view-selection' AND reasonCode = 'homepage-representation'").get()).toEqual({ count: 3 });
      expect(handle.sqlite.prepare('SELECT COUNT(*) AS count FROM VoyageSettings').get()).toEqual({ count: 0 });
    } finally { await handle.db.destroy(); handle.sqlite.close(); }
  });

  it('expands valid pairs in order, skips ephemeral placeholders, and emits topology only for two resolved members', async () => {
    const configured = await paths();
    const schemaOnly = await initExternalIntegrationsDb({ path: configured.targetPath, runDataMigrations: false });
    await schemaOnly.db.destroy(); schemaOnly.sqlite.close();
    const pairSession = session('pairs', [
      { id: 'pair-entry', tabGroupId: 'craft-vk', viewIds: ['code+docs'] },
      { id: 'ephemeral-entry', tabGroupId: 'craft-vk', viewIds: ['craft-surface:craft-vk:preview'] },
      { id: 'removed-plugin-entry', tabGroupId: 'craft-vk', viewIds: ['removed-plugin'] },
    ]);
    pairSession.activeVoyageEntryId = 'pair-entry';
    pairSession.activeItemsByVoyageEntryId['pair-entry'] = 'code+docs';
    sourceDatabase(configured.sourcePath, workspace, { sessions: [pairSession] }).close();
    const handle = await initExternalIntegrationsDb({ path: configured.targetPath, sourcePath: configured.sourcePath });
    try {
      expect(handle.sqlite.prepare('SELECT targetKind FROM VoyagePanel ORDER BY rowid').all()).toEqual([
        { targetKind: 'code' }, { targetKind: 'custom-url' },
      ]);
      const storedLayout = handle.sqlite.prepare('SELECT dockviewVersion, snapshotJson FROM VoyageLayout').get() as { dockviewVersion: string; snapshotJson: string };
      const layout = JSON.parse(storedLayout.snapshotJson) as { grid: { root: { data: unknown[] } }; panels: Record<string, unknown>; activeGroup?: string };
      expect(storedLayout.dockviewVersion).toBe('8.3.1');
      expect(layout.grid.root.data).toHaveLength(2);
      expect(Object.keys(layout.panels)).toHaveLength(2);
      expect(layout.activeGroup).toMatch(/^group-panel-/);
      const canonical = productionDockviewSnapshotCodec.validateAndCanonicalize(layout);
      expect(new Set(canonical.panelIds)).toEqual(new Set((handle.sqlite.prepare('SELECT id FROM VoyagePanel').all() as Array<{ id: string }>).map(({ id }) => id)));
      expect(handle.sqlite.prepare("SELECT reasonCode FROM VoyageMigrationDiagnostic WHERE reasonCode = 'ephemeral-plugin-placeholder'").all()).toHaveLength(2);
      expect(handle.sqlite.prepare("SELECT outcome, reasonCode FROM VoyageMigrationDiagnostic WHERE sourceKind = 'view-selection' AND sourceId LIKE '%removed-plugin-entry%'").all())
        .toEqual([{ outcome: 'quarantined', reasonCode: 'target-unresolvable' }]);
    } finally { await handle.db.destroy(); handle.sqlite.close(); }
  });

  it('reads both source keys from one SQLite snapshot under a concurrent WAL update', async () => {
    const configured = await paths();
    const source = sourceDatabase(configured.sourcePath, { ...workspace, nextId: 1 }, { version: 3, data: [] });
    source.pragma('journal_mode = WAL');
    source.close();
    const writer = new Database(configured.sourcePath);
    writer.pragma('journal_mode = WAL');
    const snapshot = await readLegacyVoyageSource(configured, {
      afterWorkspaceRead: () => writer.prepare('UPDATE kvstore SET value = ? WHERE key = ?').run(JSON.stringify({ version: 3, data: [session('new', [])] }), LEGACY_SESSIONS_KEY),
    });
    writer.close();
    expect(snapshot).toMatchObject({ kind: 'snapshot' });
    if (snapshot.kind !== 'snapshot') return;
    expect(JSON.parse(snapshot.workspaceJson!).nextId).toBe(1);
    expect(JSON.parse(snapshot.sessionsJson!).data).toEqual([]);
  });

  it('seeds MRU from ordered duplicate visit evidence and applies the active selection last', async () => {
    const configured = await paths();
    const twoCrafts = {
      ...workspace,
      tabGroups: [...workspace.tabGroups, {
        id: 'craft-vk-2', label: 'VK Craft 2',
        workspace: { workspaceId: 'vk-workspace-2', workspaceDir: '/ignored' },
        tabs: [{ id: 'code', title: 'Code', url: 'https://stale.invalid/code' }], pairs: [], order: 3,
      }],
    };
    const ordered = session('ordered-mru', [
      { id: 'first-layout', tabGroupId: 'craft-vk', viewIds: ['code', 'docs'] },
      { id: 'second-layout', tabGroupId: 'craft-vk-2', viewIds: ['code'] },
    ]);
    ordered.visitedTabGroupIds = ['craft-vk-2', 'craft-vk', 'craft-vk-2'];
    ordered.activeVoyageEntryId = 'first-layout';
    ordered.activeItemsByVoyageEntryId['first-layout'] = 'code';
    sourceDatabase(configured.sourcePath, twoCrafts, { version: 3, data: [ordered] }).close();
    const handle = await initExternalIntegrationsDb({ path: configured.targetPath, sourcePath: configured.sourcePath });
    try {
      expect(handle.sqlite.prepare('SELECT craftWorkspaceId, targetKind, lastActivatedSequence FROM VoyagePanel ORDER BY craftWorkspaceId, targetKind').all()).toEqual([
        { craftWorkspaceId: 'vk-workspace-1', targetKind: 'code', lastActivatedSequence: 4 },
        { craftWorkspaceId: 'vk-workspace-1', targetKind: 'custom-url', lastActivatedSequence: null },
        { craftWorkspaceId: 'vk-workspace-2', targetKind: 'code', lastActivatedSequence: 3 },
      ]);
      expect(handle.sqlite.prepare('SELECT activationSequence FROM Voyage').get()).toEqual({ activationSequence: 4 });
    } finally { await handle.db.destroy(); handle.sqlite.close(); }
  });

  it('validates sanitized production-like generated surfaces, stale selections, duplicate Crafts, and Create Workspace compatibility', async () => {
    const configured = await paths();
    const productionLikeWorkspace = {
      spaces: [{
        id: 'space-home',
        name: 'Home',
        icon: 'home',
        tabGroupIds: ['tg_home', 'craft-create-workspace', 'craft-alpha', 'craft-alpha-duplicate', 'craft-beta'],
      }],
      tabGroups: [
        { id: 'tg_home', label: 'Home', tabs: [{ id: 'tab_overview', title: 'Overview', url: 'internal://spaces-overview' }], pairs: [], order: 0 },
        { id: 'craft-create-workspace', label: 'Create Workspace', tabs: [{ id: 'tab_create_workspace', title: 'Create Workspace', url: 'https://trusted.test/workspaces' }], pairs: [], order: 1 },
        {
          id: 'craft-alpha',
          label: 'Alpha',
          workspace: { workspaceId: 'workspace-alpha', workspaceDir: '/private/alpha' },
          tabs: [{ id: 'beads', title: 'Beads', url: 'https://legacy-beads.example.test/workspace-alpha' }],
          pairs: [{ id: 'agent+beads', tabIds: ['agent', 'beads'], ratios: [50, 50] }],
          order: 2,
        },
        { id: 'craft-alpha-duplicate', label: 'Alpha Duplicate', workspace: { workspaceId: 'workspace-alpha', workspaceDir: '/private/alpha-copy' }, tabs: [], pairs: [], order: 3 },
        { id: 'craft-beta', label: 'Beta', workspace: { workspaceId: 'workspace-beta', workspaceDir: '/private/beta' }, tabs: [], pairs: [], order: 4 },
      ],
      nextId: 42,
    };
    const productionLikeSession = session('production-like-shadow', [
      { id: 'home-entry', tabGroupId: 'tg_home', viewIds: ['tab_overview'] },
      { id: 'create-entry', tabGroupId: 'craft-create-workspace', viewIds: ['tab_create_workspace'] },
      { id: 'alpha-entry', tabGroupId: 'craft-alpha', viewIds: ['agent', 'code', 'forms', 'tab_101', 'beads', 'agent+beads'] },
      { id: 'alpha-duplicate-entry', tabGroupId: 'craft-alpha-duplicate', viewIds: ['agent'] },
      { id: 'beta-entry', tabGroupId: 'craft-beta', viewIds: ['agent', 'code'] },
    ]);
    productionLikeSession.activeVoyageEntryId = 'beta-entry';
    productionLikeSession.activeItemsByVoyageEntryId['beta-entry'] = 'code';
    sourceDatabase(configured.sourcePath, productionLikeWorkspace, { version: 3, data: [productionLikeSession] }).close();

    const registry = firstPartySurfaceRegistry();
    const handle = await initExternalIntegrationsDb({
      path: configured.targetPath,
      sourcePath: configured.sourcePath,
      dataMigrationDependencies: {
        services: {
          legacyTargetContextForCraft: (craft: { id: string }, workspaceId: string) => trustedTestContext(craft, workspaceId, registry),
        },
      },
    });
    try {
      expect(handle.sqlite.prepare('SELECT name FROM Voyage').all()).toEqual([{ name: 'production-like-shadow' }]);
      expect(handle.sqlite.prepare('SELECT craftWorkspaceId FROM VoyageCraft ORDER BY craftWorkspaceId').all()).toEqual([
        { craftWorkspaceId: 'workspace-alpha' },
        { craftWorkspaceId: 'workspace-beta' },
      ]);
      expect(handle.sqlite.prepare('SELECT craftWorkspaceId, targetKind FROM VoyagePanel ORDER BY craftWorkspaceId, targetKind, id').all()).toEqual([
        { craftWorkspaceId: 'workspace-alpha', targetKind: 'code' },
        { craftWorkspaceId: 'workspace-alpha', targetKind: 'craft-overview' },
        { craftWorkspaceId: 'workspace-alpha', targetKind: 'craft-overview' },
        { craftWorkspaceId: 'workspace-alpha', targetKind: 'craft-overview' },
        { craftWorkspaceId: 'workspace-alpha', targetKind: 'forms' },
        { craftWorkspaceId: 'workspace-beta', targetKind: 'code' },
        { craftWorkspaceId: 'workspace-beta', targetKind: 'craft-overview' },
      ]);
      expect(handle.sqlite.prepare("SELECT COUNT(*) AS count FROM VoyagePanel WHERE targetKind = 'beads'").get()).toEqual({ count: 0 });
      expect(handle.sqlite.prepare("SELECT reasonCode, outcome FROM VoyageMigrationDiagnostic WHERE sourceKind = 'craft-occurrence' AND sourceId LIKE '%alpha-duplicate-entry%'").all())
        .toEqual([{ reasonCode: 'duplicate-membership-occurrence', outcome: 'skipped' }]);
      expect(handle.sqlite.prepare("SELECT reasonCode, outcome FROM VoyageMigrationDiagnostic WHERE sourceKind = 'view-selection' AND sourceId LIKE '%tab_101%'").all())
        .toEqual([{ reasonCode: 'missing-view', outcome: 'quarantined' }]);
      expect(handle.sqlite.prepare("SELECT reasonCode, outcome FROM VoyageMigrationDiagnostic WHERE sourceKind = 'view-selection' AND sourceId LIKE '%selection%beads'").all())
        .toEqual([
          { reasonCode: 'removed-beads-surface', outcome: 'skipped' },
          { reasonCode: 'pair-incomplete', outcome: 'quarantined' },
        ]);
      expect(handle.sqlite.prepare("SELECT reasonCode, outcome FROM VoyageMigrationDiagnostic WHERE sourceKind = 'pair-member' AND sourceId LIKE '%agent+beads%member:0:agent'").all())
        .toEqual([{ reasonCode: 'resolved', outcome: 'migrated' }]);
      expect(handle.sqlite.prepare("SELECT reasonCode, outcome FROM VoyageMigrationDiagnostic WHERE sourceKind = 'pair-member' AND sourceId LIKE '%agent+beads%member:1:beads'").all())
        .toEqual([{ reasonCode: 'removed-beads-surface', outcome: 'skipped' }]);
      expect(handle.sqlite.prepare("SELECT COUNT(*) AS count FROM VoyageMigrationDiagnostic WHERE reasonCode = 'temporary-create-workspace'").get())
        .toEqual({ count: 4 });
      const audit = handle.sqlite.prepare("SELECT detailsJson FROM VoyageMigrationDiagnostic WHERE sourceKind = 'audit-summary'").get() as { detailsJson: string };
      const counts = JSON.parse(audit.detailsJson) as { source: number; migrated: number; skipped: number; quarantined: number };
      expect(counts.migrated + counts.skipped + counts.quarantined).toBe(counts.source);
      const storedLayout = handle.sqlite.prepare('SELECT snapshotJson FROM VoyageLayout').get() as { snapshotJson: string };
      const canonical = productionDockviewSnapshotCodec.validateAndCanonicalize(JSON.parse(storedLayout.snapshotJson));
      expect(canonical.panelIds).toHaveLength(7);
    } finally { await handle.db.destroy(); handle.sqlite.close(); }
  });

  it('uses injected current definitions and quarantines targets when their workspace authority is removed', async () => {
    const configured = await paths();
    sourceDatabase(configured.sourcePath, workspace, { version: 3, data: [session('removed-owner', [
      { id: 'code', tabGroupId: 'craft-vk', viewIds: ['code'] },
    ])] }).close();
    const handle = await initExternalIntegrationsDb({
      path: configured.targetPath,
      sourcePath: configured.sourcePath,
      dataMigrationDependencies: { services: { legacyTargetContextForCraft: () => null } },
    });
    try {
      expect(handle.sqlite.prepare('SELECT COUNT(*) AS count FROM Voyage').get()).toEqual({ count: 0 });
      expect(handle.sqlite.prepare("SELECT COUNT(*) AS count FROM VoyageMigrationDiagnostic WHERE outcome = 'quarantined' AND reasonCode = 'target-unresolvable'").get())
        .toEqual({ count: 1 });
    } finally { await handle.db.destroy(); handle.sqlite.close(); }
  });

  it('fails closed when production does not inject an authoritative resolver snapshot', async () => {
    const configured = await paths();
    sourceDatabase(configured.sourcePath, workspace, { version: 3, data: [session('authority', [
      { id: 'code', tabGroupId: 'craft-vk', viewIds: ['code'] },
    ])] }).close();
    await expect(initDatabase({ path: configured.targetPath, sourcePath: configured.sourcePath }))
      .rejects.toMatchObject({ name: 'DataMigrationStartupError', causeCode: 'MIGRATION_AUTHORITY_UNAVAILABLE' });
    const target = new Database(configured.targetPath, { readonly: true });
    expect(target.prepare('SELECT COUNT(*) AS count FROM Voyage').get()).toEqual({ count: 0 });
    expect(target.prepare('SELECT COUNT(*) AS count FROM Migration WHERE name = ?').get(LEGACY_VOYAGE_MIGRATION_ID)).toEqual({ count: 0 });
    target.close();
  });

  it('rejects an occurrence audit with duplicate source identities before any target write', async () => {
    const configured = await paths();
    const duplicate = session('duplicate', [{ id: 'code', tabGroupId: 'craft-vk', viewIds: ['code'] }]);
    sourceDatabase(configured.sourcePath, workspace, { version: 3, data: [duplicate, duplicate] }).close();
    await expect(initExternalIntegrationsDb({ path: configured.targetPath, sourcePath: configured.sourcePath }))
      .rejects.toMatchObject({ name: 'DataMigrationStartupError', causeCode: 'AUDIT_IMBALANCE' });
    const target = new Database(configured.targetPath, { readonly: true });
    expect(target.prepare('SELECT COUNT(*) AS count FROM Voyage').get()).toEqual({ count: 0 });
    expect(target.prepare('SELECT COUNT(*) AS count FROM VoyageMigrationDiagnostic').get()).toEqual({ count: 0 });
    expect(target.prepare('SELECT COUNT(*) AS count FROM Migration WHERE name = ?').get(LEGACY_VOYAGE_MIGRATION_ID)).toEqual({ count: 0 });
    target.close();
  });

  it.each(['missing-key', 'malformed-container', 'normalized-write-failure', 'diagnostic-failure'])('fails closed without rows or completion for %s', async (failure) => {
    const configured = await paths();
    const source = new Database(configured.sourcePath);
    source.exec('CREATE TABLE kvstore (id INTEGER PRIMARY KEY, key TEXT UNIQUE, value TEXT NOT NULL)');
    const insert = source.prepare('INSERT INTO kvstore (key, value) VALUES (?, ?)');
    insert.run(LEGACY_WORKSPACE_KEY, failure === 'malformed-container' ? '{bad' : JSON.stringify(workspace));
    if (failure !== 'missing-key') insert.run(LEGACY_SESSIONS_KEY, JSON.stringify({ version: 3, data: [session('failure', [{ id: 'code', tabGroupId: 'craft-vk', viewIds: ['code'] }])] }));
    source.close();
    await expect(initExternalIntegrationsDb({
      path: configured.targetPath,
      sourcePath: configured.sourcePath,
      ...(failure.endsWith('-failure') ? { dataMigrationDependencies: { onPhase: (_id: string, phase: string) => {
        const expected = failure === 'diagnostic-failure' ? 'diagnostics' : 'normalized-writes';
        if (phase === expected) throw new Error('injected');
      } } } : {}),
    })).rejects.toMatchObject({ name: 'DataMigrationStartupError' });
    const target = new Database(configured.targetPath, { readonly: true });
    expect(target.prepare('SELECT COUNT(*) AS count FROM Voyage').get()).toEqual({ count: 0 });
    expect(target.prepare('SELECT COUNT(*) AS count FROM VoyageMigrationDiagnostic').get()).toEqual({ count: 0 });
    expect(target.prepare('SELECT COUNT(*) AS count FROM Migration WHERE name = ?').get(LEGACY_VOYAGE_MIGRATION_ID)).toEqual({ count: 0 });
    target.close();
  });
});

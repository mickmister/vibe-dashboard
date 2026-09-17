import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import Database from 'better-sqlite3';
import { getSavedWorkspaceSessions } from '../../../lib/savedVoyageState';
import { getBuiltInWorkspaceMetadata } from '../../../modules/plugins/vibe-dashboard/craft-surfaces';
import type { Craft, SavedWorkspaceSession, WorkspaceState } from '../../../types';
import {
  classifyLegacyPanelRepresentation,
  getLegacyStoredPanelTarget,
  type StoredPanelTarget,
} from '../../panelTargetRegistry';
import type { DataMigration, DataMigrationPaths } from './runner';

export const LEGACY_VOYAGE_MIGRATION_ID = '20260917100000_migrate_legacy_voyages';
export const LEGACY_WORKSPACE_KEY = 'engine|module|workspace|state.persistent|workspace';
export const LEGACY_SESSIONS_KEY = 'engine|module|workspace|state.persistent|workspace-sessions';

export type LegacyVoyageSource =
  | { kind: 'absent' }
  | { kind: 'snapshot'; workspaceJson: string | null; sessionsJson: string | null };

export async function readLegacyVoyageSource(
  paths: Readonly<DataMigrationPaths>,
  hooks: { afterWorkspaceRead?(): void } = {},
): Promise<LegacyVoyageSource> {
  try {
    const source = await stat(paths.sourcePath);
    if (!source.isFile()) throw Object.assign(new Error('Configured legacy source is not a file'), { code: 'INVALID_SOURCE' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'absent' };
    throw error;
  }

  const sqlite = new Database(paths.sourcePath, { readonly: true, fileMustExist: true });
  try {
    return sqlite.transaction((): LegacyVoyageSource => {
      const select = sqlite.prepare('SELECT value FROM kvstore WHERE key = ?');
      const workspace = select.get(LEGACY_WORKSPACE_KEY) as { value: string } | undefined;
      hooks.afterWorkspaceRead?.();
      const sessions = select.get(LEGACY_SESSIONS_KEY) as { value: string } | undefined;
      return { kind: 'snapshot', workspaceJson: workspace?.value ?? null, sessionsJson: sessions?.value ?? null };
    }).deferred();
  } finally {
    sqlite.close();
  }
}

function hash(...parts: string[]): string {
  return createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 24);
}

function parseJson(value: string, label: string): unknown {
  try { return JSON.parse(value); }
  catch { throw Object.assign(new Error(`Malformed ${label} container`), { code: 'MALFORMED_SOURCE' }); }
}

function isWorkspace(value: unknown): value is WorkspaceState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return Array.isArray(candidate.spaces) && Array.isArray(candidate.tabGroups)
    && Number.isSafeInteger(candidate.nextId)
    && candidate.tabGroups.every((craft) => craft && typeof craft === 'object'
      && typeof (craft as Craft).id === 'string' && typeof (craft as Craft).label === 'string'
      && Array.isArray((craft as Craft).tabs) && (craft as Craft).tabs.every((view) => view
        && typeof view.id === 'string' && typeof view.title === 'string' && typeof view.url === 'string')
      && Array.isArray((craft as Craft).pairs) && (craft as Craft).pairs.every((pair) => pair
        && typeof pair.id === 'string' && Array.isArray(pair.tabIds)
        && pair.tabIds.every((id) => typeof id === 'string')));
}

function rawSessions(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  if (Array.isArray(candidate.sessions)) return candidate.sessions;
  if ((candidate.version === 2 || candidate.version === 3) && Array.isArray(candidate.data)) return candidate.data;
  return null;
}

type Diagnostic = {
  sourceKind: string;
  sourceId: string;
  outcome: 'migrated' | 'skipped' | 'rejected';
  reasonCode: string;
  voyageId: string | null;
};

type Panel = {
  id: string;
  craftWorkspaceId: string;
  target: StoredPanelTarget;
  lastActivatedSequence: number | null;
};

function buildMigration(source: LegacyVoyageSource) {
  if (source.kind === 'absent' || (source.workspaceJson === null && source.sessionsJson === null)) {
    return { voyages: [], diagnostics: [{ sourceKind: 'installation', sourceId: 'legacy-source', outcome: 'skipped', reasonCode: 'fresh-install', voyageId: null }] satisfies Diagnostic[] };
  }
  if (source.workspaceJson === null || source.sessionsJson === null) {
    throw Object.assign(new Error('Legacy source keys are incomplete'), { code: 'INCOMPLETE_SOURCE' });
  }
  const workspaceValue = parseJson(source.workspaceJson, 'workspace');
  const sessionsValue = parseJson(source.sessionsJson, 'workspace-sessions');
  if (!isWorkspace(workspaceValue)) throw Object.assign(new Error('Malformed workspace container'), { code: 'MALFORMED_SOURCE' });
  const sourceSessions = rawSessions(sessionsValue);
  if (!sourceSessions) throw Object.assign(new Error('Malformed workspace-sessions container'), { code: 'MALFORMED_SOURCE' });
  const sessions = getSavedWorkspaceSessions(sessionsValue);
  if (sessions.length !== sourceSessions.length) throw Object.assign(new Error('Malformed saved Voyage item'), { code: 'MALFORMED_SOURCE' });
  const sourceVisits = new Map(sourceSessions.map((raw) => {
    const candidate = raw as { id?: unknown; visitedTabGroupIds?: unknown };
    return [candidate.id, Array.isArray(candidate.visitedTabGroupIds)
      ? candidate.visitedTabGroupIds.filter((id): id is string => typeof id === 'string')
      : []] as const;
  }));

  const crafts = new Map(workspaceValue.tabGroups.map((craft) => [craft.id, craft]));
  const diagnostics: Diagnostic[] = [];
  const voyages: Array<{ id: string; session: SavedWorkspaceSession; crafts: Array<{ workspaceId: string; sortKey: string }>; panels: Panel[]; pairs: Array<{ pairId: string; panelIds: string[]; ratios: [50, 50] }> }> = [];

  sessions.forEach((session) => {
    const diagnosticStart = diagnostics.length;
    const voyageId = `voyage-${hash(session.id)}`;
    const memberships = new Map<string, string>();
    const panels: Panel[] = [];
    const pairs: Array<{ pairId: string; panelIds: string[]; ratios: [50, 50] }> = [];
    let activationSequence = 0;
    let activePanelId: string | null = null;
    const visited = new Set(sourceVisits.get(session.id) ?? []);

    session.voyageEntries.forEach((entry, entryIndex) => {
      const entrySourceId = `${session.id}:entry:${entry.id || entryIndex}`;
      const craft = crafts.get(entry.tabGroupId);
      const metadata = craft ? getBuiltInWorkspaceMetadata(craft) : null;
      const isHomepageGroup = entry.tabGroupId === 'tg_home';
      const isCreateWorkspace = Boolean(craft && (/create workspace/i.test(craft.label) || /create[_-]?workspace/i.test(craft.id)));
      if (!craft || isHomepageGroup || isCreateWorkspace || !metadata) {
        const reasonCode = isHomepageGroup ? 'homepage-representation' : isCreateWorkspace ? 'temporary-create-workspace' : !craft ? 'craft-unavailable' : 'non-vk-craft';
        diagnostics.push({ sourceKind: 'craft-occurrence', sourceId: entrySourceId, outcome: !craft ? 'rejected' : 'skipped', reasonCode, voyageId: null });
        for (const viewId of entry.viewIds) diagnostics.push({ sourceKind: 'view-selection', sourceId: `${entrySourceId}:view:${viewId}`, outcome: !craft ? 'rejected' : 'skipped', reasonCode, voyageId: null });
        return;
      }
      if (!memberships.has(metadata.workspaceId)) memberships.set(metadata.workspaceId, String(entryIndex).padStart(8, '0'));
      diagnostics.push({ sourceKind: 'craft-occurrence', sourceId: entrySourceId, outcome: 'migrated', reasonCode: 'vk-craft', voyageId });
      const fallbackSelection = session.activeItemsByVoyageEntryId[entry.id];
      const selectedIds: string[] = entry.viewIds.length
        ? entry.viewIds
        : fallbackSelection ? [fallbackSelection] : [];
      selectedIds.forEach((selectedId, selectionIndex) => {
        const pair = craft.pairs.find((candidate) => candidate.id === selectedId);
        if (pair) {
          const classification = classifyLegacyPanelRepresentation({
            groupId: craft.id, view: { id: pair.id, url: '' }, pair, views: craft.tabs,
            resolveMember: (view) => getLegacyStoredPanelTarget({ view, workspaceId: metadata.workspaceId }),
          });
          if (classification.outcome !== 'pair') return;
          const pairMigrated = 'topology' in classification && Boolean(classification.topology);
          diagnostics.push({
            sourceKind: 'view-selection', sourceId: `${entrySourceId}:view:${selectedId}`,
            outcome: pairMigrated ? 'migrated' : 'rejected',
            reasonCode: pairMigrated ? 'pair-expanded' : 'pair-incomplete',
            voyageId: pairMigrated ? voyageId : null,
          });
          const pairPanelIds: string[] = [];
          classification.diagnostics.forEach((item, memberIndex) => {
            const outcome = item.status === 'resolved' ? 'migrated' : item.status === 'skipped' ? 'skipped' : 'rejected';
            diagnostics.push({ sourceKind: 'pair-member', sourceId: `${entrySourceId}:pair:${pair.id}:${memberIndex}:${item.tabId}`, outcome, reasonCode: item.reason ?? item.status, voyageId: outcome === 'migrated' ? voyageId : null });
            const target = classification.targets[pairPanelIds.length];
            if (item.status === 'resolved' && target) {
              const panelId = `panel-${hash(session.id, entrySourceId, pair.id, String(memberIndex), item.tabId)}`;
              panels.push({ id: panelId, craftWorkspaceId: metadata.workspaceId, target, lastActivatedSequence: visited.has(craft.id) ? ++activationSequence : null });
              pairPanelIds.push(panelId);
              if (entry.id === session.activeVoyageEntryId && session.activeItemsByVoyageEntryId[entry.id] === pair.id) activePanelId = panelId;
            }
          });
          if ('topology' in classification && classification.topology && pairPanelIds.length === 2) {
            pairs.push({ pairId: pair.id, panelIds: pairPanelIds, ratios: [50, 50] });
          }
          return;
        }
        const view = craft.tabs.find((candidate) => candidate.id === selectedId);
        if (!view) {
          diagnostics.push({ sourceKind: 'view-selection', sourceId: `${entrySourceId}:view:${selectedId}`, outcome: 'rejected', reasonCode: 'missing-view', voyageId: null });
          return;
        }
        const classification = classifyLegacyPanelRepresentation({ groupId: craft.id, view });
        if (classification.outcome === 'skip') {
          diagnostics.push({ sourceKind: 'view-selection', sourceId: `${entrySourceId}:view:${selectedId}`, outcome: 'skipped', reasonCode: classification.reason, voyageId: null });
          return;
        }
        const target = getLegacyStoredPanelTarget({ view, workspaceId: metadata.workspaceId });
        if (!target) {
          diagnostics.push({ sourceKind: 'view-selection', sourceId: `${entrySourceId}:view:${selectedId}`, outcome: 'rejected', reasonCode: 'target-unresolvable', voyageId: null });
          return;
        }
        const panelId = `panel-${hash(session.id, entrySourceId, selectedId, String(selectionIndex))}`;
        panels.push({ id: panelId, craftWorkspaceId: metadata.workspaceId, target, lastActivatedSequence: visited.has(craft.id) ? ++activationSequence : null });
        diagnostics.push({ sourceKind: 'view-selection', sourceId: `${entrySourceId}:view:${selectedId}`, outcome: 'migrated', reasonCode: 'panel', voyageId });
        if (entry.id === session.activeVoyageEntryId && session.activeItemsByVoyageEntryId[entry.id] === selectedId) activePanelId = panelId;
      });
    });

    if (panels.length === 0) {
      const sessionDiagnostics = diagnostics.slice(diagnosticStart);
      diagnostics.push({ sourceKind: 'voyage', sourceId: session.id, outcome: 'skipped', reasonCode: sessionDiagnostics.some((item) => item.reasonCode === 'homepage-representation') ? 'homepage-representation' : 'no-migratable-panels', voyageId: null });
      return;
    }
    if (activePanelId) {
      const active = panels.find((panel) => panel.id === activePanelId)!;
      active.lastActivatedSequence = ++activationSequence;
    }
    diagnostics.push({ sourceKind: 'voyage', sourceId: session.id, outcome: 'migrated', reasonCode: 'normalized-voyage', voyageId });
    voyages.push({ id: voyageId, session, crafts: [...memberships].map(([workspaceId, sortKey]) => ({ workspaceId, sortKey })), panels, pairs });
  });
  return { voyages, diagnostics };
}

export const migrateLegacyVoyages: DataMigration = {
  id: LEGACY_VOYAGE_MIGRATION_ID,
  requiresSource: true,
  async run({ db, source, checkpoint }) {
    const result = buildMigration(source as LegacyVoyageSource);
    for (const voyage of result.voyages) {
      const activationSequence = Math.max(0, ...voyage.panels.map((panel) => panel.lastActivatedSequence ?? 0));
      await db.insertInto('Voyage').values({
        id: voyage.id, name: voyage.session.name.trim() || 'Saved voyage', lifecycleState: 'active',
        activationSequence, historyCursorSequence: 0,
        createdAt: voyage.session.createdAt, updatedAt: voyage.session.updatedAt,
      }).execute();
      await db.insertInto('VoyageCraft').values(voyage.crafts.map((craft) => ({ voyageId: voyage.id, craftWorkspaceId: craft.workspaceId, sortKey: craft.sortKey }))).execute();
      await db.insertInto('VoyagePanel').values(voyage.panels.map((panel) => ({
        id: panel.id, voyageId: voyage.id, craftWorkspaceId: panel.craftWorkspaceId,
        targetKind: panel.target.kind, targetVersion: panel.target.version,
        targetPayloadJson: JSON.stringify(panel.target.payload), titleMode: 'automatic', customTitle: null,
        closePolicy: 'closable', lastActivatedSequence: panel.lastActivatedSequence,
      }))).execute();
      const snapshot = { version: 1, panels: voyage.panels.map((panel) => panel.id), pairs: voyage.pairs };
      const snapshotJson = JSON.stringify(snapshot);
      const snapshotHash = createHash('sha256').update(snapshotJson).digest('hex');
      const panelsJson = JSON.stringify(voyage.panels.map((panel) => ({
        id: panel.id, craftWorkspaceId: panel.craftWorkspaceId, targetKind: panel.target.kind,
        targetVersion: panel.target.version, targetPayload: panel.target.payload,
        titleMode: 'automatic', customTitle: null, closePolicy: 'closable',
      })));
      await db.insertInto('VoyageLayout').values({ voyageId: voyage.id, formatVersion: 1, dockviewVersion: 'migration-v1', aggregateRevision: 0, snapshotJson, snapshotHash }).execute();
      await db.insertInto('VoyageHistory').values({ id: `history-${hash(voyage.id, '0')}`, voyageId: voyage.id, sequence: 0, aggregateRevision: 0, panelsJson, snapshotJson }).execute();
    }
    await checkpoint('normalized-writes');
    if (result.diagnostics.length) {
      await db.insertInto('VoyageMigrationDiagnostic').values(result.diagnostics.map((diagnostic, index) => ({
        id: `diagnostic-${hash(LEGACY_VOYAGE_MIGRATION_ID, String(index), diagnostic.sourceKind, diagnostic.sourceId)}`,
        migrationName: LEGACY_VOYAGE_MIGRATION_ID, voyageId: diagnostic.voyageId,
        sourceKind: diagnostic.sourceKind, sourceId: diagnostic.sourceId,
        // The canonical schema names rejected legacy input "quarantined". Keep
        // classification terminology internal and persist only schema outcomes.
        outcome: diagnostic.outcome === 'rejected' ? 'quarantined' : diagnostic.outcome,
        reasonCode: diagnostic.reasonCode, detailsJson: null,
      }))).execute();
    }
    await checkpoint('diagnostics');
  },
};

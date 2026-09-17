import { stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { getSavedWorkspaceSessions } from '../../../lib/savedVoyageState';
import { getBuiltInWorkspaceMetadata } from '../../../modules/plugins/vibe-dashboard/craft-surfaces';
import type { Craft, SavedWorkspaceSession, WorkspaceState } from '../../../types';
import { classifyLegacyPanelRepresentation, createPanelTargetRegistry, resolveLegacyPanelTarget, type PanelTargetResolutionContext, type StoredPanelTarget } from '../../panelTargetRegistry';
import { buildMigratedDockviewSnapshot, productionDockviewSnapshotCodec } from '../../dockviewSnapshotCodec';
import type { DataMigration, DataMigrationPaths } from './runner';

export const LEGACY_VOYAGE_MIGRATION_ID = '20260917100000_migrate_legacy_voyages';
export const LEGACY_WORKSPACE_KEY = 'engine|module|workspace|state.persistent|workspace';
export const LEGACY_SESSIONS_KEY = 'engine|module|workspace|state.persistent|workspace-sessions';
export type LegacyVoyageSource = { kind: 'absent' } | { kind: 'snapshot'; workspaceJson: string | null; sessionsJson: string | null };

export async function readLegacyVoyageSource(paths: Readonly<DataMigrationPaths>, hooks: { afterWorkspaceRead?(): void } = {}): Promise<LegacyVoyageSource> {
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
  } finally { sqlite.close(); }
}

function hash(...parts: string[]): string { return createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 24); }
function parseJson(value: string, label: string): unknown {
  try { return JSON.parse(value); } catch { throw Object.assign(new Error(`Malformed ${label} container`), { code: 'MALFORMED_SOURCE' }); }
}
function isWorkspace(value: unknown): value is WorkspaceState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return Array.isArray(candidate.spaces) && Array.isArray(candidate.tabGroups) && Number.isSafeInteger(candidate.nextId)
    && candidate.tabGroups.every((craft) => craft && typeof craft === 'object' && typeof (craft as Craft).id === 'string' && typeof (craft as Craft).label === 'string'
      && Array.isArray((craft as Craft).tabs) && (craft as Craft).tabs.every((view) => view && typeof view.id === 'string' && typeof view.title === 'string' && typeof view.url === 'string')
      && Array.isArray((craft as Craft).pairs) && (craft as Craft).pairs.every((pair) => pair && typeof pair.id === 'string' && Array.isArray(pair.tabIds) && pair.tabIds.every((id) => typeof id === 'string')));
}
function rawSessions(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  if (Array.isArray(candidate.sessions)) return candidate.sessions;
  return (candidate.version === 2 || candidate.version === 3) && Array.isArray(candidate.data) ? candidate.data : null;
}

type Outcome = 'migrated' | 'skipped' | 'quarantined';
type Diagnostic = { sourceKind: string; sourceId: string; outcome: Outcome; reasonCode: string; voyageId: string | null; outputRefs?: string[]; details?: unknown };
type Panel = { id: string; legacyGroupId: string; legacyEntryId: string; legacySelectionId: string; craftWorkspaceId: string; target: StoredPanelTarget; lastActivatedSequence: number | null };
type Voyage = { id: string; session: SavedWorkspaceSession; crafts: Array<{ workspaceId: string; sortKey: string }>; panels: Panel[]; pairs: Array<{ pairId: string; panelIds: string[]; ratios: [50, 50] }>; activePanelId: string | null };

export function assertOccurrenceOutputs(diagnostics: ReadonlyArray<Pick<Diagnostic, 'outcome' | 'outputRefs'>>, outputRefs: ReadonlySet<string>): void {
  const claimed = new Set<string>();
  for (const diagnostic of diagnostics) {
    const references = diagnostic.outputRefs ?? [];
    if ((diagnostic.outcome === 'migrated') !== (references.length > 0)) throw Object.assign(new Error('Migration outcome has no constructed output'), { code: 'AUDIT_IMBALANCE' });
    for (const reference of references) {
      if (!outputRefs.has(reference) || claimed.has(reference)) throw Object.assign(new Error('Migration output mapping is missing or duplicated'), { code: 'AUDIT_IMBALANCE' });
      claimed.add(reference);
    }
  }
  if (claimed.size !== outputRefs.size || [...outputRefs].some((reference) => !claimed.has(reference))) throw Object.assign(new Error('Constructed migration output is not audited'), { code: 'AUDIT_IMBALANCE' });
}

class OccurrenceLedger {
  private readonly entries = new Map<string, Diagnostic>();
  add(entry: Diagnostic): void {
    const key = `${entry.sourceKind}\0${entry.sourceId}`;
    if (this.entries.has(key)) throw Object.assign(new Error('Duplicate migration occurrence'), { code: 'AUDIT_IMBALANCE' });
    this.entries.set(key, entry);
  }
  detachVoyage(voyageId: string): void {
    for (const entry of this.entries.values()) if (entry.voyageId === voyageId) {
      entry.voyageId = null;
      entry.outputRefs = undefined;
      if (entry.outcome === 'migrated') {
        entry.outcome = 'skipped';
        entry.reasonCode = 'no-migratable-voyage-output';
      }
    }
  }
  finish(expected: number, outputRefs: ReadonlySet<string>): Diagnostic[] {
    if (this.entries.size !== expected) throw Object.assign(new Error('Unclassified migration occurrence'), { code: 'AUDIT_IMBALANCE' });
    const diagnostics = [...this.entries.values()];
    const counts = { migrated: 0, skipped: 0, quarantined: 0 };
    diagnostics.forEach(({ outcome }) => { counts[outcome] += 1; });
    if (Object.values(counts).reduce((sum, count) => sum + count, 0) !== expected) throw Object.assign(new Error('Unbalanced migration audit'), { code: 'AUDIT_IMBALANCE' });
    assertOccurrenceOutputs(diagnostics, outputRefs);
    diagnostics.forEach((diagnostic) => { if (diagnostic.outputRefs?.length) diagnostic.details = { outputRefs: diagnostic.outputRefs }; });
    const scoped = (pattern: RegExp) => Object.fromEntries([...new Set(diagnostics.flatMap(({ sourceId }) => sourceId.match(pattern)?.[1] ?? []))]
      .sort().map((scope) => {
        const entries = diagnostics.filter(({ sourceId }) => sourceId.match(pattern)?.[1] === scope);
        return [scope, {
          source: entries.length,
          migrated: entries.filter(({ outcome }) => outcome === 'migrated').length,
          skipped: entries.filter(({ outcome }) => outcome === 'skipped').length,
          quarantined: entries.filter(({ outcome }) => outcome === 'quarantined').length,
        }];
      }));
    return [...diagnostics, {
      sourceKind: 'audit-summary', sourceId: 'global', outcome: 'migrated', reasonCode: 'balanced', voyageId: null,
      details: { source: expected, ...counts, byVoyage: scoped(/^(voyage:\d+)/), byCraft: scoped(/(group:[^:]+)/) },
    }];
  }
}

type ContextFactory = (craftId: string, workspaceId: string) => PanelTargetResolutionContext | null;
function snapshotContext(context: PanelTargetResolutionContext): PanelTargetResolutionContext {
  const plugins = context.getPluginRegistry ? structuredClone(context.getPluginRegistry()) : undefined;
  return {
    ...context,
    crafts: structuredClone(context.crafts),
    workspaces: structuredClone(context.workspaces),
    agentSessions: structuredClone(context.agentSessions),
    terminals: structuredClone(context.terminals),
    previews: structuredClone(context.previews),
    builtInRoutes: structuredClone(context.builtInRoutes),
    redirectGuards: structuredClone(context.redirectGuards),
    getPluginRegistry: plugins ? () => plugins : context.getPluginRegistry,
  };
}

function selections(session: SavedWorkspaceSession, entry: SavedWorkspaceSession['voyageEntries'][number]): string[] {
  return entry.viewIds.length ? entry.viewIds : session.activeItemsByVoyageEntryId[entry.id] ? [session.activeItemsByVoyageEntryId[entry.id]!] : [];
}
function countExpected(workspace: WorkspaceState, sessions: SavedWorkspaceSession[]): number {
  const inventory = workspace.tabGroups.reduce((count, craft) => count + 1 + craft.tabs.length + craft.pairs.length, 0);
  return inventory + sessions.reduce((count, session) => count + 1 + session.voyageEntries.reduce((entryCount, entry) => {
    const craft = workspace.tabGroups.find(({ id }) => id === entry.tabGroupId);
    return entryCount + 1 + selections(session, entry).reduce((selectionCount, id) => selectionCount + 1 + (craft?.pairs.find((pair) => pair.id === id)?.tabIds.length ?? 0), 0);
  }, 0), 0);
}

function buildMigration(source: LegacyVoyageSource, contextFactory: ContextFactory) {
  if (source.kind === 'absent' || (source.workspaceJson === null && source.sessionsJson === null)) return { voyages: [] as Voyage[], diagnostics: [{ sourceKind: 'installation', sourceId: 'legacy-source', outcome: 'skipped', reasonCode: 'fresh-install', voyageId: null }] satisfies Diagnostic[] };
  if (source.workspaceJson === null || source.sessionsJson === null) throw Object.assign(new Error('Legacy source keys are incomplete'), { code: 'INCOMPLETE_SOURCE' });
  const workspace = parseJson(source.workspaceJson, 'workspace');
  const sessionsValue = parseJson(source.sessionsJson, 'workspace-sessions');
  if (!isWorkspace(workspace)) throw Object.assign(new Error('Malformed workspace container'), { code: 'MALFORMED_SOURCE' });
  const raw = rawSessions(sessionsValue);
  if (!raw) throw Object.assign(new Error('Malformed workspace-sessions container'), { code: 'MALFORMED_SOURCE' });
  const sessions = getSavedWorkspaceSessions(sessionsValue);
  if (sessions.length !== raw.length) throw Object.assign(new Error('Malformed saved Voyage item'), { code: 'MALFORMED_SOURCE' });
  if (new Set(sessions.map(({ id }) => id)).size !== sessions.length
    || new Set(workspace.tabGroups.map(({ id }) => id)).size !== workspace.tabGroups.length) {
    throw Object.assign(new Error('Non-unique migration source identity'), { code: 'AUDIT_IMBALANCE' });
  }
  const sourceVisits = new Map(raw.map((value) => {
    const candidate = value as { id?: unknown; visitedTabGroupIds?: unknown };
    return [candidate.id, Array.isArray(candidate.visitedTabGroupIds) && candidate.visitedTabGroupIds.every((id) => typeof id === 'string') ? candidate.visitedTabGroupIds as string[] : []] as const;
  }));
  const ledger = new OccurrenceLedger();
  const crafts = new Map(workspace.tabGroups.map((craft) => [craft.id, craft]));
  const registry = createPanelTargetRegistry();
  const contexts = new Map<string, PanelTargetResolutionContext | null>();
  const resolve = (craftId: string, workspaceId: string, view: { id: string; url: string }) => {
    const key = `${craftId}\0${workspaceId}`;
    if (!contexts.has(key)) {
      const supplied = contextFactory(craftId, workspaceId);
      contexts.set(key, supplied ? snapshotContext(supplied) : null);
    }
    const context = contexts.get(key) ?? null;
    return context ? resolveLegacyPanelTarget({ view, workspaceId, context, registry }) : null;
  };

  workspace.tabGroups.forEach((craft, craftIndex) => {
    const metadata = getBuiltInWorkspaceMetadata(craft);
    const homepage = craft.id === 'tg_home';
    const temporary = /create workspace/i.test(craft.label) || /create[_-]?workspace/i.test(craft.id);
    const outcome: Outcome = 'skipped';
    const reason = homepage ? 'homepage-representation' : temporary ? 'temporary-create-workspace' : metadata ? 'unselected-source-definition' : 'non-vk-craft';
    const craftSource = `group:${craft.id}:occurrence:${craftIndex}`;
    ledger.add({ sourceKind: 'source-group', sourceId: craftSource, outcome, reasonCode: reason, voyageId: null });
    craft.tabs.forEach((view, viewIndex) => {
      const classification = classifyLegacyPanelRepresentation({ groupId: craft.id, view });
      const target = metadata && classification.outcome === 'durable-candidate' ? resolve(craft.id, metadata.workspaceId, view) : null;
      ledger.add({ sourceKind: 'source-view', sourceId: `${craftSource}:view:${viewIndex}:${view.id}`,
        outcome: 'skipped',
        reasonCode: classification.outcome === 'skip' ? classification.reason : target ? 'unselected-source-definition' : reason, voyageId: null });
    });
    craft.pairs.forEach((pair, pairIndex) => {
      const valid = pair.tabIds.length === 2 && new Set(pair.tabIds).size === 2;
      ledger.add({ sourceKind: 'source-pair', sourceId: `${craftSource}:pair:${pairIndex}:${pair.id}`, outcome: valid ? 'skipped' : 'quarantined', reasonCode: valid ? 'unselected-source-definition' : 'pair-cardinality', voyageId: null });
    });
  });

  const voyages: Voyage[] = [];
  sessions.forEach((session, sessionIndex) => {
    const voyageId = `voyage-${hash(session.id)}`;
    const memberships = new Map<string, string>();
    const panels: Panel[] = [];
    const pairs: Voyage['pairs'] = [];
    let activePanelId: string | null = null;
    let sawHomepage = false;
    session.voyageEntries.forEach((entry, entryIndex) => {
      const occurrence = `voyage:${sessionIndex}:entry:${entryIndex}:${entry.id}:group:${entry.tabGroupId}`;
      const craft = crafts.get(entry.tabGroupId);
      const metadata = craft ? getBuiltInWorkspaceMetadata(craft) : null;
      const homepage = entry.tabGroupId === 'tg_home';
      const temporary = Boolean(craft && (/create workspace/i.test(craft.label) || /create[_-]?workspace/i.test(craft.id)));
      const reason = homepage ? 'homepage-representation' : temporary ? 'temporary-create-workspace' : !craft ? 'craft-unavailable' : !metadata ? 'non-vk-craft' : 'vk-craft';
      const outcome: Outcome = !craft ? 'quarantined' : homepage || temporary || !metadata ? 'skipped' : 'migrated';
      sawHomepage ||= homepage;
      const isNewMembership = metadata !== null && !memberships.has(metadata.workspaceId);
      ledger.add({ sourceKind: 'craft-occurrence', sourceId: occurrence, outcome: outcome === 'migrated' && !isNewMembership ? 'skipped' : outcome,
        reasonCode: outcome === 'migrated' && !isNewMembership ? 'duplicate-membership-occurrence' : reason,
        voyageId: outcome === 'migrated' && isNewMembership ? voyageId : null,
        outputRefs: outcome === 'migrated' && isNewMembership ? [`membership:${voyageId}:${metadata!.workspaceId}`] : undefined });
      const selected = selections(session, entry);
      if (!craft || !metadata || outcome !== 'migrated') {
        selected.forEach((id, index) => ledger.add({ sourceKind: 'view-selection', sourceId: `${occurrence}:selection:${index}:${id}`, outcome, reasonCode: reason, voyageId: null }));
        return;
      }
      if (!memberships.has(metadata.workspaceId)) memberships.set(metadata.workspaceId, String(entryIndex).padStart(8, '0'));
      selected.forEach((selectedId, selectionIndex) => {
        const selectionId = `${occurrence}:selection:${selectionIndex}:${selectedId}`;
        const pair = craft.pairs.find(({ id }) => id === selectedId);
        if (pair) {
          const classification = classifyLegacyPanelRepresentation({ groupId: craft.id, view: { id: pair.id, url: '' }, pair, views: craft.tabs, resolveMember: (view) => resolve(craft.id, metadata.workspaceId, view) });
          if (classification.outcome !== 'pair') throw Object.assign(new Error('Pair classification failed'), { code: 'AUDIT_IMBALANCE' });
          const complete = 'topology' in classification && Boolean(classification.topology);
          const topologyRefs = complete ? classification.targets.map((_, memberIndex) => `topology:${voyageId}:group-${`panel-${hash(session.id, occurrence, pair.id, String(memberIndex), classification.diagnostics[memberIndex]!.tabId)}`}`) : undefined;
          ledger.add({ sourceKind: 'view-selection', sourceId: selectionId, outcome: complete ? 'migrated' : 'quarantined', reasonCode: complete ? 'pair-expanded' : 'pair-incomplete', voyageId: complete ? voyageId : null, outputRefs: topologyRefs });
          const pairPanelIds: string[] = [];
          let targetIndex = 0;
          classification.diagnostics.forEach((item, memberIndex) => {
            const memberOutcome: Outcome = item.status === 'resolved' ? 'migrated' : item.status === 'skipped' ? 'skipped' : 'quarantined';
            if (item.status === 'resolved') {
              const target = classification.targets[targetIndex++];
              if (!target) throw Object.assign(new Error('Pair target audit mismatch'), { code: 'AUDIT_IMBALANCE' });
              const panelId = `panel-${hash(session.id, occurrence, pair.id, String(memberIndex), item.tabId)}`;
              panels.push({ id: panelId, legacyGroupId: craft.id, legacyEntryId: entry.id, legacySelectionId: pair.id, craftWorkspaceId: metadata.workspaceId, target, lastActivatedSequence: null });
              ledger.add({ sourceKind: 'pair-member', sourceId: `${selectionId}:member:${memberIndex}:${item.tabId}`, outcome: memberOutcome, reasonCode: item.reason ?? item.status, voyageId, outputRefs: [`panel:${panelId}`] });
              pairPanelIds.push(panelId);
              if (entry.id === session.activeVoyageEntryId && session.activeItemsByVoyageEntryId[entry.id] === pair.id && memberIndex === 0) activePanelId = panelId;
            } else ledger.add({ sourceKind: 'pair-member', sourceId: `${selectionId}:member:${memberIndex}:${item.tabId}`, outcome: memberOutcome, reasonCode: item.reason ?? item.status, voyageId: null });
          });
          if (complete && pairPanelIds.length === 2) pairs.push({ pairId: pair.id, panelIds: pairPanelIds, ratios: [50, 50] });
          return;
        }
        const view = craft.tabs.find(({ id }) => id === selectedId);
        if (!view) { ledger.add({ sourceKind: 'view-selection', sourceId: selectionId, outcome: 'quarantined', reasonCode: 'missing-view', voyageId: null }); return; }
        const classification = classifyLegacyPanelRepresentation({ groupId: craft.id, view });
        if (classification.outcome === 'skip') { ledger.add({ sourceKind: 'view-selection', sourceId: selectionId, outcome: 'skipped', reasonCode: classification.reason, voyageId: null }); return; }
        const target = resolve(craft.id, metadata.workspaceId, view);
        if (!target) { ledger.add({ sourceKind: 'view-selection', sourceId: selectionId, outcome: 'quarantined', reasonCode: 'target-unresolvable', voyageId: null }); return; }
        const panelId = `panel-${hash(session.id, occurrence, selectedId, String(selectionIndex))}`;
        panels.push({ id: panelId, legacyGroupId: craft.id, legacyEntryId: entry.id, legacySelectionId: selectedId, craftWorkspaceId: metadata.workspaceId, target, lastActivatedSequence: null });
        ledger.add({ sourceKind: 'view-selection', sourceId: selectionId, outcome: 'migrated', reasonCode: 'panel', voyageId, outputRefs: [`panel:${panelId}`, `topology:${voyageId}:group-${panelId}`] });
        if (entry.id === session.activeVoyageEntryId && session.activeItemsByVoyageEntryId[entry.id] === selectedId) activePanelId = panelId;
      });
    });
    if (!panels.length) {
      ledger.detachVoyage(voyageId);
      ledger.add({ sourceKind: 'voyage', sourceId: `voyage:${sessionIndex}:${session.id}`, outcome: 'skipped', reasonCode: sawHomepage ? 'homepage-representation' : 'no-migratable-panels', voyageId: null });
      return;
    }
    let activationSequence = 0;
    for (const groupId of sourceVisits.get(session.id) ?? []) {
      for (const entry of session.voyageEntries.filter(({ tabGroupId }) => tabGroupId === groupId)) {
        const activeSelection = session.activeItemsByVoyageEntryId[entry.id];
        if (!activeSelection) continue;
        for (const panel of panels.filter((candidate) => candidate.legacyEntryId === entry.id && candidate.legacySelectionId === activeSelection)) {
          panel.lastActivatedSequence = ++activationSequence;
        }
      }
    }
    if (activePanelId) panels.find(({ id }) => id === activePanelId)!.lastActivatedSequence = ++activationSequence;
    ledger.add({ sourceKind: 'voyage', sourceId: `voyage:${sessionIndex}:${session.id}`, outcome: 'migrated', reasonCode: 'normalized-voyage', voyageId, outputRefs: [`voyage:${voyageId}`] });
    voyages.push({ id: voyageId, session, crafts: [...memberships].map(([workspaceId, sortKey]) => ({ workspaceId, sortKey })), panels, pairs, activePanelId });
  });
  const outputs = new Set(voyages.flatMap((voyage) => [
    `voyage:${voyage.id}`,
    ...voyage.crafts.map(({ workspaceId }) => `membership:${voyage.id}:${workspaceId}`),
    ...voyage.panels.flatMap(({ id }) => [`panel:${id}`, `topology:${voyage.id}:group-${id}`]),
  ]));
  return { voyages, diagnostics: ledger.finish(countExpected(workspace, sessions), outputs) };
}

export const migrateLegacyVoyages: DataMigration = {
  id: LEGACY_VOYAGE_MIGRATION_ID,
  requiresSource: true,
  async run({ db, source, services, checkpoint }) {
    if (typeof services.legacyTargetContextForCraft !== 'function') throw Object.assign(new Error('Authoritative legacy target resolver is unavailable'), { code: 'MIGRATION_AUTHORITY_UNAVAILABLE' });
    const contextFactory = services.legacyTargetContextForCraft as ContextFactory;
    const result = buildMigration(source as LegacyVoyageSource, contextFactory);
    for (const voyage of result.voyages) {
      const activationSequence = Math.max(0, ...voyage.panels.map(({ lastActivatedSequence }) => lastActivatedSequence ?? 0));
      await db.insertInto('Voyage').values({ id: voyage.id, name: voyage.session.name.trim() || 'Saved voyage', lifecycleState: 'active', activationSequence, historyCursorSequence: 0, createdAt: voyage.session.createdAt, updatedAt: voyage.session.updatedAt }).execute();
      await db.insertInto('VoyageCraft').values(voyage.crafts.map((craft) => ({ voyageId: voyage.id, craftWorkspaceId: craft.workspaceId, sortKey: craft.sortKey }))).execute();
      await db.insertInto('VoyagePanel').values(voyage.panels.map((panel) => ({ id: panel.id, voyageId: voyage.id, craftWorkspaceId: panel.craftWorkspaceId, targetKind: panel.target.kind, targetVersion: panel.target.version, targetPayloadJson: JSON.stringify(panel.target.payload), titleMode: 'automatic', customTitle: null, closePolicy: 'closable', lastActivatedSequence: panel.lastActivatedSequence }))).execute();
      const canonical = productionDockviewSnapshotCodec.validateAndCanonicalize(buildMigratedDockviewSnapshot({ panelIds: voyage.panels.map(({ id }) => id), pairs: voyage.pairs, activePanelId: voyage.activePanelId }));
      if (new Set(canonical.panelIds).size !== voyage.panels.length || voyage.panels.some(({ id }) => !canonical.panelIds.includes(id))) throw Object.assign(new Error('Dockview/domain Panel mismatch'), { code: 'LAYOUT_MISMATCH' });
      const panelsJson = JSON.stringify(voyage.panels.map((panel) => ({ id: panel.id, craftWorkspaceId: panel.craftWorkspaceId, targetKind: panel.target.kind, targetVersion: panel.target.version, targetPayload: panel.target.payload, titleMode: 'automatic', customTitle: null, closePolicy: 'closable' })));
      await db.insertInto('VoyageLayout').values({ voyageId: voyage.id, formatVersion: canonical.formatVersion, dockviewVersion: canonical.dockviewVersion, aggregateRevision: 0, snapshotJson: canonical.serialized, snapshotHash: canonical.hash }).execute();
      await db.insertInto('VoyageHistory').values({ id: `history-${hash(voyage.id, '0')}`, voyageId: voyage.id, sequence: 0, aggregateRevision: 0, panelsJson, snapshotJson: canonical.serialized }).execute();
    }
    await checkpoint('normalized-writes');
    if (result.diagnostics.length) await db.insertInto('VoyageMigrationDiagnostic').values(result.diagnostics.map((diagnostic, index) => ({ id: `diagnostic-${hash(LEGACY_VOYAGE_MIGRATION_ID, String(index), diagnostic.sourceKind, diagnostic.sourceId)}`, migrationName: LEGACY_VOYAGE_MIGRATION_ID, voyageId: diagnostic.voyageId, sourceKind: diagnostic.sourceKind, sourceId: diagnostic.sourceId, outcome: diagnostic.outcome, reasonCode: diagnostic.reasonCode, detailsJson: diagnostic.details === undefined ? null : JSON.stringify(diagnostic.details) }))).execute();
    await checkpoint('diagnostics');
  },
};

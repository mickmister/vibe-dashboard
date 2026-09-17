import { createHash, randomUUID } from 'node:crypto';
import { sql, type Kysely, type Selectable, type Transaction } from 'kysely';
import type { DB, VoyagePanel } from './kysely_types';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface VoyageCraftRecord {
  craftWorkspaceId: string;
  sortKey: string;
}

export interface VoyagePanelRecord {
  id: string;
  craftWorkspaceId: string | null;
  targetKind: string;
  targetVersion: number;
  targetPayload: { [key: string]: JsonValue };
  titleMode: 'automatic' | 'custom';
  customTitle: string | null;
  closePolicy: string;
  lastActivatedSequence: number | null;
}

export type StructuralPanelHistoryRecord = Omit<VoyagePanelRecord, 'lastActivatedSequence'>;

export interface CanonicalVoyageSnapshot {
  formatVersion: number;
  dockviewVersion: string;
  snapshot: { [key: string]: JsonValue };
  serialized: string;
  hash: string;
}

export interface VoyageSnapshotCodec {
  validateAndCanonicalize(snapshot: unknown): CanonicalVoyageSnapshot;
}

export function createVoyageSnapshotCodec(
  formatVersion: number,
  dockviewVersion: string,
  parse: (snapshot: unknown) => { [key: string]: JsonValue },
): VoyageSnapshotCodec {
  if (!Number.isInteger(formatVersion) || formatVersion < 1 || !dockviewVersion) {
    throw new VoyageInvariantError('Snapshot codec versions must be explicit');
  }
  return {
    validateAndCanonicalize(snapshot) {
      let parsed: { [key: string]: JsonValue };
      try {
        parsed = parse(snapshot);
      } catch (error) {
        if (error instanceof VoyageInvariantError) throw error;
        throw new VoyageInvariantError(`Snapshot validation failed: ${error instanceof Error ? error.message : 'unknown error'}`);
      }
      const value = validateJson(parsed, 'snapshot');
      if (!value || Array.isArray(value) || typeof value !== 'object') {
        throw new VoyageInvariantError('Snapshot validator must return a JSON object');
      }
      const serialized = canonicalStringify(value);
      return {
        formatVersion,
        dockviewVersion,
        snapshot: value,
        serialized,
        hash: createHash('sha256').update(serialized).digest('hex'),
      };
    },
  };
}

export interface VoyageAggregate {
  id: string;
  revision: number;
  activationSequence: number;
  historyCursorSequence: number | null;
  metadata: {
    name: string;
    mission: string | null;
    lifecycleState: string;
    lastOpenedAt: string | null;
  };
  crafts: VoyageCraftRecord[];
  panels: VoyagePanelRecord[];
  layout: CanonicalVoyageSnapshot;
  history: Array<{
    sequence: number;
    aggregateRevision: number;
    panels: StructuralPanelHistoryRecord[];
    snapshot: { [key: string]: JsonValue };
  }>;
}

export class VoyageConflictError extends Error {
  constructor(readonly voyageId: string, readonly expectedRevision: number) {
    super(`Voyage ${voyageId} is no longer at revision ${expectedRevision}`);
    this.name = 'VoyageConflictError';
  }
}

export class VoyageInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VoyageInvariantError';
  }
}

type VoyageTransaction = Transaction<DB>;

export interface VoyageRepositoryOptions {
  snapshotCodec: VoyageSnapshotCodec;
  onCoordinatorAcquired?: (voyageId: string) => void;
}

export interface CommitLayoutMutationInput {
  voyageId: string;
  expectedRevision: number;
  crafts: VoyageCraftRecord[];
  panels: VoyagePanelRecord[];
  snapshot: unknown;
  metadata?: VoyageAggregate['metadata'];
}

export interface MoveCraftInput {
  sourceVoyageId: string;
  destinationVoyageId: string;
  sourceExpectedRevision: number;
  destinationExpectedRevision: number;
  craftWorkspaceId: string;
  destinationSortKey: string;
  sourceSnapshot: unknown;
  destinationSnapshot: unknown;
}

class VoyageCoordinatorLocks {
  private readonly tails = new Map<string, Promise<void>>();

  async run<T>(ids: string[], onAcquired: ((id: string) => void) | undefined, operation: () => Promise<T>): Promise<T> {
    const locks: Array<{ id: string; release: () => void; tail: Promise<void> }> = [];
    for (const id of [...new Set(ids)].sort()) {
      const previous = this.tails.get(id) ?? Promise.resolve();
      let release!: () => void;
      const current = new Promise<void>((resolve) => { release = resolve; });
      const tail = previous.then(() => current);
      this.tails.set(id, tail);
      await previous;
      locks.push({ id, release, tail });
      onAcquired?.(id);
    }
    try {
      return await operation();
    } finally {
      for (const lock of locks.reverse()) {
        lock.release();
        if (this.tails.get(lock.id) === lock.tail) this.tails.delete(lock.id);
      }
    }
  }
}

const coordinatorLocks = new VoyageCoordinatorLocks();

export class VoyageRepository {
  private readonly snapshotCodec: VoyageSnapshotCodec;

  constructor(private readonly db: Kysely<DB>, private readonly options: VoyageRepositoryOptions) {
    this.snapshotCodec = options.snapshotCodec;
  }

  async createVoyage(input: {
    id: string;
    name: string;
    crafts: VoyageCraftRecord[];
    panels: VoyagePanelRecord[];
    snapshot: unknown;
  }): Promise<void> {
    if (!input.id || !input.name.trim()) throw new VoyageInvariantError('Voyage ID and name are required');
    validateAggregate(input.crafts, input.panels);
    const layout = this.snapshotCodec.validateAndCanonicalize(input.snapshot);
    await coordinatorLocks.run([input.id], this.options.onCoordinatorAcquired, async () => {
      await this.db.transaction().execute(async (transaction) => {
        await transaction.insertInto('Voyage').values({ id: input.id, name: input.name }).execute();
        await syncDomainRows(transaction, input.id, input.crafts, input.panels);
        await writeLayout(transaction, input.id, 0, layout);
        await transaction.insertInto('VoyageHistory').values({
          id: randomUUID(),
          voyageId: input.id,
          sequence: 0,
          aggregateRevision: 0,
          panelsJson: canonicalStringify(input.panels.map(structuralPanel)),
          snapshotJson: layout.serialized,
        }).execute();
        await transaction.updateTable('Voyage').set({ historyCursorSequence: 0 }).where('id', '=', input.id).execute();
      });
    });
  }

  async loadVoyage(voyageId: string): Promise<VoyageAggregate> {
    return coordinatorLocks.run([voyageId], this.options.onCoordinatorAcquired, () =>
      this.db.transaction().execute((transaction) => this.loadVoyageTransaction(transaction, voyageId)),
    );
  }

  private async loadVoyageTransaction(transaction: VoyageTransaction, voyageId: string): Promise<VoyageAggregate> {
    const voyage = await transaction.selectFrom('Voyage').selectAll().where('id', '=', voyageId).executeTakeFirst();
    if (!voyage) throw new VoyageInvariantError(`Unknown Voyage ${voyageId}`);
    const [craftRows, panelRows, layoutRow, historyRows] = await Promise.all([
      transaction.selectFrom('VoyageCraft').selectAll().where('voyageId', '=', voyageId).orderBy('sortKey').orderBy('craftWorkspaceId').execute(),
      transaction.selectFrom('VoyagePanel').selectAll().where('voyageId', '=', voyageId).orderBy('id').execute(),
      transaction.selectFrom('VoyageLayout').selectAll().where('voyageId', '=', voyageId).executeTakeFirstOrThrow(),
      transaction.selectFrom('VoyageHistory').selectAll().where('voyageId', '=', voyageId).orderBy('sequence').execute(),
    ]);
    const crafts = craftRows.map(({ craftWorkspaceId, sortKey }) => ({ craftWorkspaceId, sortKey }));
    const history = historyRows.map((row) => {
      const panels = parseStructuralPanels(row.panelsJson);
      validateAggregate(crafts, panels.map((panel) => ({ ...panel, lastActivatedSequence: null })));
      const snapshot = this.snapshotCodec.validateAndCanonicalize(parseJsonObject(row.snapshotJson, 'history snapshot')).snapshot;
      return { sequence: row.sequence, aggregateRevision: row.aggregateRevision, panels, snapshot };
    });
    return {
      id: voyage.id,
      revision: voyage.revision,
      activationSequence: voyage.activationSequence,
      historyCursorSequence: voyage.historyCursorSequence,
      metadata: {
        name: voyage.name,
        mission: voyage.mission,
        lifecycleState: voyage.lifecycleState,
        lastOpenedAt: voyage.lastOpenedAt,
      },
      crafts,
      panels: panelRows.map(panelFromRow),
      layout: validateStoredLayout(this.snapshotCodec, layoutRow),
      history,
    };
  }

  async commitLayoutMutation(input: CommitLayoutMutationInput): Promise<number> {
    validateAggregate(input.crafts, input.panels);
    if (input.metadata && (!input.metadata.name.trim() || !['active', 'archived'].includes(input.metadata.lifecycleState))) {
      throw new VoyageInvariantError('Voyage metadata is invalid');
    }
    const layout = this.snapshotCodec.validateAndCanonicalize(input.snapshot);
    return coordinatorLocks.run([input.voyageId], this.options.onCoordinatorAcquired, () =>
      this.db.transaction().execute(async (transaction) => {
        const revision = await advanceRevision(transaction, input.voyageId, input.expectedRevision);
        if (input.metadata) {
          await transaction.updateTable('Voyage').set(input.metadata).where('id', '=', input.voyageId).execute();
        }
        await syncDomainRows(transaction, input.voyageId, input.crafts, input.panels);
        await writeLayout(transaction, input.voyageId, revision, layout);
        const sequence = await appendHistory(transaction, input.voyageId, revision, input.panels, layout);
        await transaction.updateTable('Voyage').set({ historyCursorSequence: sequence }).where('id', '=', input.voyageId).execute();
        return revision;
      }),
    );
  }

  async recordActivation(voyageId: string, panelId: string, expectedRevision: number): Promise<boolean> {
    return coordinatorLocks.run([voyageId], this.options.onCoordinatorAcquired, () =>
      this.db.transaction().execute(async (transaction) => {
        const voyage = await transaction.selectFrom('Voyage').select(['revision', 'activationSequence']).where('id', '=', voyageId).executeTakeFirst();
        if (!voyage || voyage.revision !== expectedRevision) throw new VoyageConflictError(voyageId, expectedRevision);
        const panel = await transaction.selectFrom('VoyagePanel').select('lastActivatedSequence')
          .where('voyageId', '=', voyageId).where('id', '=', panelId).executeTakeFirst();
        if (!panel) throw new VoyageInvariantError(`Panel ${panelId} does not belong to Voyage ${voyageId}`);
        if (panel.lastActivatedSequence === voyage.activationSequence && voyage.activationSequence > 0) return false;
        const nextSequence = voyage.activationSequence + 1;
        const result = await transaction.updateTable('Voyage')
          .set({ revision: expectedRevision + 1, activationSequence: nextSequence, updatedAt: sql`CURRENT_TIMESTAMP` })
          .where('id', '=', voyageId).where('revision', '=', expectedRevision).executeTakeFirst();
        if (result.numUpdatedRows !== 1n) throw new VoyageConflictError(voyageId, expectedRevision);
        await transaction.updateTable('VoyagePanel').set({ lastActivatedSequence: nextSequence })
          .where('voyageId', '=', voyageId).where('id', '=', panelId).execute();
        return true;
      }),
    );
  }

  async undo(voyageId: string, expectedRevision: number): Promise<boolean> {
    return this.applyHistory(voyageId, expectedRevision, 'undo');
  }

  async redo(voyageId: string, expectedRevision: number): Promise<boolean> {
    return this.applyHistory(voyageId, expectedRevision, 'redo');
  }

  async moveCraft(input: MoveCraftInput): Promise<void> {
    if (input.sourceVoyageId === input.destinationVoyageId) {
      throw new VoyageInvariantError('A Craft move requires two distinct Voyages');
    }
    const sourceLayout = this.snapshotCodec.validateAndCanonicalize(input.sourceSnapshot);
    const destinationLayout = this.snapshotCodec.validateAndCanonicalize(input.destinationSnapshot);
    await coordinatorLocks.run(
      [input.sourceVoyageId, input.destinationVoyageId],
      this.options.onCoordinatorAcquired,
      () => this.db.transaction().execute(async (transaction) => {
        const sourceRevision = await advanceRevision(transaction, input.sourceVoyageId, input.sourceExpectedRevision);
        const destinationRevision = await advanceRevision(transaction, input.destinationVoyageId, input.destinationExpectedRevision);
        const craft = await transaction.selectFrom('VoyageCraft').selectAll()
          .where('voyageId', '=', input.sourceVoyageId)
          .where('craftWorkspaceId', '=', input.craftWorkspaceId).executeTakeFirst();
        if (!craft) throw new VoyageInvariantError(`Craft ${input.craftWorkspaceId} is not in source Voyage`);
        const collision = await transaction.selectFrom('VoyageCraft').select('craftWorkspaceId')
          .where('voyageId', '=', input.destinationVoyageId)
          .where('craftWorkspaceId', '=', input.craftWorkspaceId).executeTakeFirst();
        if (collision) throw new VoyageInvariantError(`Craft ${input.craftWorkspaceId} is already in destination Voyage`);
        await transaction.insertInto('VoyageCraft').values({
          voyageId: input.destinationVoyageId,
          craftWorkspaceId: input.craftWorkspaceId,
          sortKey: input.destinationSortKey,
        }).execute();
        await transaction.updateTable('VoyagePanel').set({
          voyageId: input.destinationVoyageId,
          lastActivatedSequence: null,
        })
          .where('voyageId', '=', input.sourceVoyageId)
          .where('craftWorkspaceId', '=', input.craftWorkspaceId).execute();
        await transaction.deleteFrom('VoyageCraft')
          .where('voyageId', '=', input.sourceVoyageId)
          .where('craftWorkspaceId', '=', input.craftWorkspaceId).execute();
        await writeLayout(transaction, input.sourceVoyageId, sourceRevision, sourceLayout);
        await writeLayout(transaction, input.destinationVoyageId, destinationRevision, destinationLayout);
        await resetHistoryBaseline(transaction, input.sourceVoyageId, sourceRevision, sourceLayout);
        await resetHistoryBaseline(transaction, input.destinationVoyageId, destinationRevision, destinationLayout);
      }),
    );
  }

  private async applyHistory(voyageId: string, expectedRevision: number, direction: 'undo' | 'redo'): Promise<boolean> {
    return coordinatorLocks.run([voyageId], this.options.onCoordinatorAcquired, () =>
      this.db.transaction().execute(async (transaction) => {
        const voyage = await transaction.selectFrom('Voyage').select(['revision', 'historyCursorSequence'])
          .where('id', '=', voyageId).executeTakeFirst();
        if (!voyage || voyage.revision !== expectedRevision) throw new VoyageConflictError(voyageId, expectedRevision);
        if (voyage.historyCursorSequence === null) return false;
        let query = transaction.selectFrom('VoyageHistory').selectAll().where('voyageId', '=', voyageId);
        query = direction === 'undo'
          ? query.where('sequence', '<', voyage.historyCursorSequence).orderBy('sequence', 'desc')
          : query.where('sequence', '>', voyage.historyCursorSequence).orderBy('sequence', 'asc');
        const checkpoint = await query.executeTakeFirst();
        if (!checkpoint) return false;
        const currentPanels = await transaction.selectFrom('VoyagePanel').selectAll().where('voyageId', '=', voyageId).execute();
        const currentRecency = new Map(currentPanels.map((panel) => [panel.id, panel.lastActivatedSequence]));
        const panels = parseStructuralPanels(checkpoint.panelsJson).map((panel) => ({
          ...panel,
          lastActivatedSequence: currentRecency.get(panel.id) ?? null,
        }));
        const crafts = await transaction.selectFrom('VoyageCraft').select(['craftWorkspaceId', 'sortKey']).where('voyageId', '=', voyageId).execute();
        validateAggregate(crafts, panels);
        const revision = await advanceRevision(transaction, voyageId, expectedRevision);
        await syncPanels(transaction, voyageId, panels);
        const layout = this.snapshotCodec.validateAndCanonicalize(parseJsonObject(checkpoint.snapshotJson, 'history snapshot'));
        await writeLayout(transaction, voyageId, revision, layout);
        await transaction.updateTable('Voyage').set({ historyCursorSequence: checkpoint.sequence }).where('id', '=', voyageId).execute();
        return true;
      }),
    );
  }
}

function validateAggregate(crafts: VoyageCraftRecord[], panels: VoyagePanelRecord[]): void {
  const memberships = new Set<string>();
  for (const craft of crafts) {
    if (!craft.craftWorkspaceId || memberships.has(craft.craftWorkspaceId)) {
      throw new VoyageInvariantError(`Duplicate or empty Craft membership ${craft.craftWorkspaceId}`);
    }
    memberships.add(craft.craftWorkspaceId);
  }
  const panelIds = new Set<string>();
  for (const panel of panels) {
    if (!panel.id || panelIds.has(panel.id)) throw new VoyageInvariantError(`Duplicate or empty Panel ID ${panel.id}`);
    panelIds.add(panel.id);
    if (panel.craftWorkspaceId !== null && !memberships.has(panel.craftWorkspaceId)) {
      throw new VoyageInvariantError(`Panel ${panel.id} references a Craft outside its Voyage`);
    }
    if (!Number.isInteger(panel.targetVersion) || panel.targetVersion < 1) {
      throw new VoyageInvariantError(`Panel ${panel.id} has an invalid target version`);
    }
    validateJson(panel.targetPayload, `Panel ${panel.id} target payload`);
  }
}

async function advanceRevision(transaction: VoyageTransaction, voyageId: string, expectedRevision: number): Promise<number> {
  const result = await transaction.updateTable('Voyage').set({
    revision: expectedRevision + 1,
    updatedAt: sql`CURRENT_TIMESTAMP`,
  })
    .where('id', '=', voyageId).where('revision', '=', expectedRevision).executeTakeFirst();
  if (result.numUpdatedRows !== 1n) throw new VoyageConflictError(voyageId, expectedRevision);
  return expectedRevision + 1;
}

async function syncDomainRows(
  transaction: VoyageTransaction,
  voyageId: string,
  crafts: VoyageCraftRecord[],
  panels: VoyagePanelRecord[],
): Promise<void> {
  for (const craft of crafts) {
    await transaction.insertInto('VoyageCraft').values({ voyageId, ...craft })
      .onConflict((conflict) => conflict.columns(['voyageId', 'craftWorkspaceId']).doUpdateSet({
        sortKey: craft.sortKey,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })).execute();
  }
  await syncPanels(transaction, voyageId, panels);
  const craftIds = crafts.map(({ craftWorkspaceId }) => craftWorkspaceId);
  let obsoleteCrafts = transaction.deleteFrom('VoyageCraft').where('voyageId', '=', voyageId);
  if (craftIds.length) obsoleteCrafts = obsoleteCrafts.where('craftWorkspaceId', 'not in', craftIds);
  await obsoleteCrafts.execute();
}

async function syncPanels(transaction: VoyageTransaction, voyageId: string, panels: VoyagePanelRecord[]): Promise<void> {
  const panelIds = panels.map(({ id }) => id);
  if (panelIds.length) {
    const foreignPanel = await transaction.selectFrom('VoyagePanel').select(['id', 'voyageId'])
      .where('id', 'in', panelIds).where('voyageId', '!=', voyageId).executeTakeFirst();
    if (foreignPanel) throw new VoyageInvariantError(`Panel ${foreignPanel.id} belongs to another Voyage`);
  }
  for (const panel of panels) {
    const values = {
      id: panel.id,
      voyageId,
      craftWorkspaceId: panel.craftWorkspaceId,
      targetKind: panel.targetKind,
      targetVersion: panel.targetVersion,
      targetPayloadJson: canonicalStringify(panel.targetPayload),
      titleMode: panel.titleMode,
      customTitle: panel.customTitle,
      closePolicy: panel.closePolicy,
      lastActivatedSequence: panel.lastActivatedSequence,
    };
    await transaction.insertInto('VoyagePanel').values(values)
      .onConflict((conflict) => conflict.column('id').doNothing()).execute();
    const updated = await transaction.updateTable('VoyagePanel').set({
      craftWorkspaceId: values.craftWorkspaceId,
      targetKind: values.targetKind,
      targetVersion: values.targetVersion,
      targetPayloadJson: values.targetPayloadJson,
      titleMode: values.titleMode,
      customTitle: values.customTitle,
      closePolicy: values.closePolicy,
      lastActivatedSequence: values.lastActivatedSequence,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    }).where('id', '=', panel.id).where('voyageId', '=', voyageId).executeTakeFirst();
    if (updated.numUpdatedRows !== 1n) throw new VoyageInvariantError(`Panel ${panel.id} belongs to another Voyage`);
  }
  let obsoletePanels = transaction.deleteFrom('VoyagePanel').where('voyageId', '=', voyageId);
  if (panelIds.length) obsoletePanels = obsoletePanels.where('id', 'not in', panelIds);
  await obsoletePanels.execute();
}

async function writeLayout(
  transaction: VoyageTransaction,
  voyageId: string,
  revision: number,
  layout: CanonicalVoyageSnapshot,
): Promise<void> {
  await transaction.insertInto('VoyageLayout').values({
    voyageId,
    formatVersion: layout.formatVersion,
    dockviewVersion: layout.dockviewVersion,
    aggregateRevision: revision,
    snapshotJson: layout.serialized,
    snapshotHash: layout.hash,
  }).onConflict((conflict) => conflict.column('voyageId').doUpdateSet({
    formatVersion: layout.formatVersion,
    dockviewVersion: layout.dockviewVersion,
    aggregateRevision: revision,
    snapshotJson: layout.serialized,
    snapshotHash: layout.hash,
    updatedAt: sql`CURRENT_TIMESTAMP`,
  })).execute();
}

async function appendHistory(
  transaction: VoyageTransaction,
  voyageId: string,
  revision: number,
  panels: VoyagePanelRecord[],
  layout: CanonicalVoyageSnapshot,
): Promise<number> {
  const voyage = await transaction.selectFrom('Voyage').select('historyCursorSequence').where('id', '=', voyageId).executeTakeFirstOrThrow();
  if (voyage.historyCursorSequence !== null) {
    await transaction.deleteFrom('VoyageHistory').where('voyageId', '=', voyageId)
      .where('sequence', '>', voyage.historyCursorSequence).execute();
  }
  const maximum = await transaction.selectFrom('VoyageHistory')
    .select(sql<number | null>`max(sequence)`.as('value')).where('voyageId', '=', voyageId).executeTakeFirstOrThrow();
  const sequence = (maximum.value ?? 0) + 1;
  await transaction.insertInto('VoyageHistory').values({
    id: randomUUID(),
    voyageId,
    sequence,
    aggregateRevision: revision,
    panelsJson: canonicalStringify(panels.map(structuralPanel)),
    snapshotJson: layout.serialized,
  }).execute();
  const rows = await transaction.selectFrom('VoyageHistory').select('sequence')
    .where('voyageId', '=', voyageId).orderBy('sequence', 'desc').execute();
  const settings = await transaction.selectFrom('VoyageSettings').select('historyLimit')
    .where('singletonKey', '=', 'installation').executeTakeFirst();
  const historyLimit = Math.max(1, settings?.historyLimit ?? 50);
  const discarded = rows.slice(historyLimit).map(({ sequence: oldSequence }) => oldSequence);
  if (discarded.length) {
    await transaction.deleteFrom('VoyageHistory').where('voyageId', '=', voyageId).where('sequence', 'in', discarded).execute();
  }
  return sequence;
}

async function resetHistoryBaseline(
  transaction: VoyageTransaction,
  voyageId: string,
  revision: number,
  layout: CanonicalVoyageSnapshot,
): Promise<void> {
  const panels = await transaction.selectFrom('VoyagePanel').selectAll().where('voyageId', '=', voyageId).orderBy('id').execute();
  await transaction.deleteFrom('VoyageHistory').where('voyageId', '=', voyageId).execute();
  await transaction.insertInto('VoyageHistory').values({
    id: randomUUID(),
    voyageId,
    sequence: 0,
    aggregateRevision: revision,
    panelsJson: canonicalStringify(panels.map((row) => structuralPanel(panelFromRow(row)))),
    snapshotJson: layout.serialized,
  }).execute();
  await transaction.updateTable('Voyage').set({ historyCursorSequence: 0 }).where('id', '=', voyageId).execute();
}

function structuralPanel(panel: VoyagePanelRecord): StructuralPanelHistoryRecord {
  return {
    id: panel.id,
    craftWorkspaceId: panel.craftWorkspaceId,
    targetKind: panel.targetKind,
    targetVersion: panel.targetVersion,
    targetPayload: panel.targetPayload,
    titleMode: panel.titleMode,
    customTitle: panel.customTitle,
    closePolicy: panel.closePolicy,
  };
}

function panelFromRow(row: Selectable<VoyagePanel>): VoyagePanelRecord {
  return {
    id: row.id,
    craftWorkspaceId: row.craftWorkspaceId,
    targetKind: row.targetKind,
    targetVersion: row.targetVersion,
    targetPayload: parseJsonObject(row.targetPayloadJson, `Panel ${row.id} target payload`),
    titleMode: parseTitleMode(row.titleMode, `Panel ${row.id}`),
    customTitle: row.customTitle,
    closePolicy: row.closePolicy,
    lastActivatedSequence: row.lastActivatedSequence,
  };
}

function validateStoredLayout(
  codec: VoyageSnapshotCodec,
  row: { formatVersion: number; dockviewVersion: string; snapshotJson: string; snapshotHash: string },
): CanonicalVoyageSnapshot {
  const layout = codec.validateAndCanonicalize(parseJsonObject(row.snapshotJson, 'layout snapshot'));
  if (layout.serialized !== row.snapshotJson || layout.hash !== row.snapshotHash
    || layout.formatVersion !== row.formatVersion || layout.dockviewVersion !== row.dockviewVersion) {
    throw new VoyageInvariantError('Stored layout is not canonical or does not match its hash/version metadata');
  }
  return layout;
}

function parseStructuralPanels(serialized: string): StructuralPanelHistoryRecord[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new VoyageInvariantError('History Panels are not valid JSON');
  }
  if (!Array.isArray(parsed)) throw new VoyageInvariantError('History Panels must be an array');
  return parsed.map((value, index) => {
    if (!value || Array.isArray(value) || typeof value !== 'object') {
      throw new VoyageInvariantError(`History Panel ${index} must be an object`);
    }
    const panel = value as Record<string, unknown>;
    const requiredStrings = ['id', 'targetKind', 'titleMode', 'closePolicy'] as const;
    for (const field of requiredStrings) {
      if (typeof panel[field] !== 'string') throw new VoyageInvariantError(`History Panel ${index} has invalid ${field}`);
    }
    if (!Number.isInteger(panel.targetVersion)) throw new VoyageInvariantError(`History Panel ${index} has invalid targetVersion`);
    const targetPayload = validateJson(panel.targetPayload, `History Panel ${index} target payload`);
    if (!targetPayload || Array.isArray(targetPayload) || typeof targetPayload !== 'object') {
      throw new VoyageInvariantError(`History Panel ${index} target payload must be an object`);
    }
    return {
      id: panel.id as string,
      craftWorkspaceId: panel.craftWorkspaceId === null ? null : requireString(panel.craftWorkspaceId, 'craftWorkspaceId'),
      targetKind: panel.targetKind as string,
      targetVersion: panel.targetVersion as number,
      targetPayload,
      titleMode: parseTitleMode(panel.titleMode, `History Panel ${index}`),
      customTitle: panel.customTitle === null ? null : requireString(panel.customTitle, 'customTitle'),
      closePolicy: panel.closePolicy as string,
    };
  });
}

function parseJsonObject(serialized: string, label: string): { [key: string]: JsonValue } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new VoyageInvariantError(`${label} is not valid JSON`);
  }
  const value = validateJson(parsed, label);
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new VoyageInvariantError(`${label} must be an object`);
  return value;
}

function validateJson(value: unknown, label: string): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((entry) => validateJson(entry, label));
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, validateJson(entry, label)]));
  }
  throw new VoyageInvariantError(`${label} contains a non-JSON value`);
}

function canonicalStringify(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalStringify(value[key]!)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new VoyageInvariantError(`History Panel has invalid ${field}`);
  return value;
}

function parseTitleMode(value: unknown, label: string): VoyagePanelRecord['titleMode'] {
  if (value === 'automatic' || value === 'custom') return value;
  throw new VoyageInvariantError(`${label} has invalid titleMode`);
}

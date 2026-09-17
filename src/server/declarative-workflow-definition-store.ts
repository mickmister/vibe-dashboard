import { createHash } from 'node:crypto';
import type { Kysely, Selectable } from 'kysely';
import type { DB, DeclarativeWorkflowDefinitionStatus, DeclarativeWorkflowDefinitionRow } from '../store/kysely_types';
import type { DeclarativeWorkflowDefinition } from '../workflows/declarative/definitions';
import { normalizeDeclarativeWorkflowDefinition } from '../workflows/declarative/definitions';

export interface DeclarativeWorkflowDefinitionReadModel {
  definitionId: string;
  version: number;
  status: DeclarativeWorkflowDefinitionStatus;
  name: string;
  description: string | null;
  trigger: string;
  definition: DeclarativeWorkflowDefinition;
  definitionHash: string;
  createdAt: number;
  updatedAt: number;
  activatedAt: number | null;
  disabledAt: number | null;
}

export interface SaveDeclarativeWorkflowDefinitionInput {
  definition: unknown;
  status?: DeclarativeWorkflowDefinitionStatus;
}

export interface ListDeclarativeWorkflowDefinitionFilters {
  status?: DeclarativeWorkflowDefinitionStatus;
  includeDisabled?: boolean;
}

export class DbDeclarativeWorkflowDefinitionStore {
  private readonly getDb: () => Promise<Kysely<DB>>;
  private readonly now: () => number;

  constructor(options: { db?: Kysely<DB>; getDb?: () => Promise<Kysely<DB>>; now?: () => number }) {
    if (!options.db && !options.getDb) throw new Error('DbDeclarativeWorkflowDefinitionStore requires db or getDb');
    this.getDb = options.getDb ?? (async () => options.db!);
    this.now = options.now ?? Date.now;
  }

  async saveDefinition(input: SaveDeclarativeWorkflowDefinitionInput): Promise<DeclarativeWorkflowDefinitionReadModel> {
    const definition = normalizeDeclarativeWorkflowDefinition(input.definition);
    const status = input.status ?? 'active';
    const db = await this.getDb();
    const now = this.now();
    const definitionJson = stableJson(definition);
    const values = {
      definitionId: definition.id,
      version: definition.version,
      status,
      name: definition.name,
      description: definition.description ?? null,
      trigger: definition.trigger,
      definitionJson,
      definitionHash: sha256(definitionJson),
      createdAt: now,
      updatedAt: now,
      activatedAt: status === 'active' ? now : null,
      disabledAt: status === 'disabled' ? now : null,
    };
    await db
      .insertInto('DeclarativeWorkflowDefinition')
      .values(values)
      .onConflict((oc) => oc.columns(['definitionId', 'version']).doUpdateSet({
        status: values.status,
        name: values.name,
        description: values.description,
        trigger: values.trigger,
        definitionJson: values.definitionJson,
        definitionHash: values.definitionHash,
        updatedAt: values.updatedAt,
        activatedAt: values.activatedAt,
        disabledAt: values.disabledAt,
      }))
      .execute();
    return this.getDefinition(definition.id, definition.version, { includeDisabled: true }).then((row) => row!);
  }

  async listDefinitions(filters: ListDeclarativeWorkflowDefinitionFilters = {}): Promise<DeclarativeWorkflowDefinitionReadModel[]> {
    const db = await this.getDb();
    let query = db.selectFrom('DeclarativeWorkflowDefinition').selectAll();
    if (filters.status) query = query.where('status', '=', filters.status);
    else if (!filters.includeDisabled) query = query.where('status', '=', 'active');
    const rows = await query.orderBy('definitionId', 'asc').orderBy('version', 'desc').execute();
    return rows.map(mapDefinitionRow);
  }

  async getDefinition(definitionId: string, version?: number, options: { includeDisabled?: boolean } = {}): Promise<DeclarativeWorkflowDefinitionReadModel | null> {
    const db = await this.getDb();
    let query = db.selectFrom('DeclarativeWorkflowDefinition').selectAll().where('definitionId', '=', definitionId);
    if (version != null) query = query.where('version', '=', version);
    if (!options.includeDisabled) query = query.where('status', '=', 'active');
    const row = await query.orderBy('version', 'desc').executeTakeFirst();
    return row ? mapDefinitionRow(row) : null;
  }

  async disableDefinition(definitionId: string, version?: number): Promise<DeclarativeWorkflowDefinitionReadModel | null> {
    const db = await this.getDb();
    const existing = await this.getDefinition(definitionId, version, { includeDisabled: true });
    if (!existing) return null;
    const now = this.now();
    await db
      .updateTable('DeclarativeWorkflowDefinition')
      .set({ status: 'disabled', updatedAt: now, disabledAt: now })
      .where('definitionId', '=', existing.definitionId)
      .where('version', '=', existing.version)
      .execute();
    return this.getDefinition(existing.definitionId, existing.version, { includeDisabled: true });
  }
}

function mapDefinitionRow(row: Selectable<DeclarativeWorkflowDefinitionRow>): DeclarativeWorkflowDefinitionReadModel {
  return {
    definitionId: row.definitionId,
    version: row.version,
    status: row.status,
    name: row.name,
    description: row.description,
    trigger: row.trigger,
    definition: normalizeDeclarativeWorkflowDefinition(JSON.parse(row.definitionJson) as unknown),
    definitionHash: row.definitionHash,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    activatedAt: row.activatedAt,
    disabledAt: row.disabledAt,
  };
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

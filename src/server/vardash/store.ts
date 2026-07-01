import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { access, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

import { loadOrCreateVardashSqlcipherKey, type VardashKeyOptions } from './key-manager';

export type VardashValueKind = 'secret' | 'plain';

export interface RepoEnvKeyMetadata {
  id: string;
  repoId: string;
  key: string;
  kind: VardashValueKind;
  required: boolean;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RepoEnvSavedValueMetadata {
  id: string;
  repoId: string;
  envKeyId: string;
  name: string;
  kind: VardashValueKind;
  hasValue: boolean;
  value?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ResolvedRepoEnv {
  env: Record<string, string>;
  missingRequired: RepoEnvKeyMetadata[];
  metadata: Array<{
    key: string;
    kind: VardashValueKind;
    savedValueId: string | null;
    savedValueName: string | null;
  }>;
}

export interface UpsertRepoEnvKeyInput {
  repoId: string;
  key: string;
  kind: VardashValueKind;
  required?: boolean;
  description?: string | null;
}

export interface CreateSavedValueInput {
  repoId: string;
  envKeyId: string;
  name: string;
  value: string;
}

export interface SetSelectionInput {
  repoId: string;
  envKeyId: string;
  savedValueId: string | null;
}

export interface SetWorkspaceRepoSelectionInput extends SetSelectionInput {
  workspaceId: string;
}

export interface ResolveRepoEnvForLaunchInput {
  repoId: string;
  workspaceId?: string;
}

export interface VardashStore {
  migrate(): Promise<void>;
  close(): Promise<void>;
  listRepoEnvKeys(repoId: string): Promise<RepoEnvKeyMetadata[]>;
  upsertRepoEnvKey(input: UpsertRepoEnvKeyInput): Promise<RepoEnvKeyMetadata>;
  createSavedValue(input: CreateSavedValueInput): Promise<RepoEnvSavedValueMetadata>;
  replaceSavedValue(input: CreateSavedValueInput & { savedValueId: string }): Promise<RepoEnvSavedValueMetadata>;
  listSavedValues(repoId: string, envKeyId: string): Promise<RepoEnvSavedValueMetadata[]>;
  setRepoDefaultSelection(input: SetSelectionInput): Promise<void>;
  setWorkspaceRepoSelection(input: SetWorkspaceRepoSelectionInput): Promise<void>;
  resolveRepoEnvForLaunch(input: ResolveRepoEnvForLaunchInput): Promise<ResolvedRepoEnv>;
}

type SqlcipherModule = {
  verbose(): SqlcipherModule;
  Database: new (filename: string) => SqlcipherDatabase;
};

type SqlcipherDatabase = {
  exec(sql: string, callback: (error: Error | null) => void): void;
  run(sql: string, params: unknown[], callback: (this: { changes: number }, error: Error | null) => void): void;
  get(sql: string, params: unknown[], callback: (error: Error | null, row: Row | undefined) => void): void;
  all(sql: string, params: unknown[], callback: (error: Error | null, rows: Row[]) => void): void;
  close(callback: (error: Error | null) => void): void;
};

type Row = Record<string, unknown>;

export interface SqlcipherVardashStoreOptions {
  dbPath: string;
  keyOptions?: VardashKeyOptions;
  sqlite?: SqlcipherModule;
}

const require = createRequire(import.meta.url);

export class SqlcipherVardashStore implements VardashStore {
  private db: SqlcipherDatabase | null = null;

  constructor(private readonly options: SqlcipherVardashStoreOptions) {}

  async migrate(): Promise<void> {
    const db = await this.open();
    await exec(db, `
      CREATE TABLE IF NOT EXISTS vardash_schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS repo_env_keys (
        id TEXT PRIMARY KEY,
        repo_id TEXT NOT NULL,
        key TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('secret', 'plain')),
        required INTEGER NOT NULL DEFAULT 0,
        description TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (repo_id, key)
      );

      CREATE TABLE IF NOT EXISTS repo_env_saved_values (
        id TEXT PRIMARY KEY,
        repo_id TEXT NOT NULL,
        env_key_id TEXT NOT NULL,
        name TEXT NOT NULL,
        stored_value TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (env_key_id, name),
        FOREIGN KEY (env_key_id) REFERENCES repo_env_keys(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS repo_env_default_selections (
        repo_id TEXT NOT NULL,
        env_key_id TEXT NOT NULL,
        saved_value_id TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (repo_id, env_key_id),
        FOREIGN KEY (env_key_id) REFERENCES repo_env_keys(id) ON DELETE CASCADE,
        FOREIGN KEY (saved_value_id) REFERENCES repo_env_saved_values(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS workspace_repo_env_selections (
        workspace_id TEXT NOT NULL,
        repo_id TEXT NOT NULL,
        env_key_id TEXT NOT NULL,
        saved_value_id TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (workspace_id, repo_id, env_key_id),
        FOREIGN KEY (env_key_id) REFERENCES repo_env_keys(id) ON DELETE CASCADE,
        FOREIGN KEY (saved_value_id) REFERENCES repo_env_saved_values(id) ON DELETE SET NULL
      );

      INSERT OR IGNORE INTO vardash_schema_migrations (version, applied_at)
      VALUES (1, datetime('now'));
    `);
  }

  async close(): Promise<void> {
    if (this.db == null) return;
    const db = this.db;
    this.db = null;
    await close(db);
  }

  async listRepoEnvKeys(repoId: string): Promise<RepoEnvKeyMetadata[]> {
    const db = await this.open();
    const rows = await all(
      db,
      `SELECT id, repo_id, key, kind, required, description, created_at, updated_at
       FROM repo_env_keys WHERE repo_id = ? ORDER BY key ASC`,
      [repoId],
    );
    return rows.map(rowToEnvKeyMetadata);
  }

  async upsertRepoEnvKey(input: UpsertRepoEnvKeyInput): Promise<RepoEnvKeyMetadata> {
    const db = await this.open();
    validateKind(input.kind);
    const existing = await get(
      db,
      `SELECT id, kind FROM repo_env_keys WHERE repo_id = ? AND key = ?`,
      [input.repoId, input.key],
    );
    const id = typeof existing?.id === 'string' ? existing.id : randomUUID();
    if (typeof existing?.id === 'string' && existing.kind !== input.kind) {
      await this.assertKindChangeAllowed(db, id, requireKind(existing.kind), input.kind);
    }
    await run(
      db,
      `INSERT INTO repo_env_keys (id, repo_id, key, kind, required, description, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
       ON CONFLICT(repo_id, key) DO UPDATE SET
         kind = excluded.kind,
         required = excluded.required,
         description = excluded.description,
         updated_at = datetime('now')`,
      [id, input.repoId, input.key, input.kind, input.required ? 1 : 0, input.description ?? null],
    );
    const row = await getRequired(
      db,
      `SELECT id, repo_id, key, kind, required, description, created_at, updated_at
       FROM repo_env_keys WHERE id = ?`,
      [id],
    );
    return rowToEnvKeyMetadata(row);
  }

  async createSavedValue(input: CreateSavedValueInput): Promise<RepoEnvSavedValueMetadata> {
    const db = await this.open();
    await this.getKeyForSavedValue(db, input.repoId, input.envKeyId);
    const id = randomUUID();
    await run(
      db,
      `INSERT INTO repo_env_saved_values (id, repo_id, env_key_id, name, stored_value, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [id, input.repoId, input.envKeyId, input.name, input.value],
    );
    return this.savedValueMetadata(db, {
      repoId: input.repoId,
      envKeyId: input.envKeyId,
      savedValueId: id,
    });
  }

  async replaceSavedValue(input: CreateSavedValueInput & { savedValueId: string }): Promise<RepoEnvSavedValueMetadata> {
    const db = await this.open();
    await this.getKeyForSavedValue(db, input.repoId, input.envKeyId);
    const changes = await run(
      db,
      `UPDATE repo_env_saved_values
       SET name = ?, stored_value = ?, updated_at = datetime('now')
       WHERE id = ? AND repo_id = ? AND env_key_id = ?`,
      [input.name, input.value, input.savedValueId, input.repoId, input.envKeyId],
    );
    if (changes !== 1) {
      throw new Error('Expected to replace exactly one vardash saved value');
    }
    return this.savedValueMetadata(db, {
      repoId: input.repoId,
      envKeyId: input.envKeyId,
      savedValueId: input.savedValueId,
    });
  }

  async listSavedValues(repoId: string, envKeyId: string): Promise<RepoEnvSavedValueMetadata[]> {
    const db = await this.open();
    const key = await this.getKeyForSavedValue(db, repoId, envKeyId);
    const rows = await all(
      db,
      `SELECT id, repo_id, env_key_id, name, stored_value, created_at, updated_at
       FROM repo_env_saved_values WHERE repo_id = ? AND env_key_id = ? ORDER BY name ASC`,
      [repoId, envKeyId],
    );
    return rows.map((row) => rowToSavedValueMetadata(row, key.kind));
  }

  async setRepoDefaultSelection(input: SetSelectionInput): Promise<void> {
    const db = await this.open();
    await this.assertSavedValueSelection(db, input);
    await run(
      db,
      `INSERT INTO repo_env_default_selections (repo_id, env_key_id, saved_value_id, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(repo_id, env_key_id) DO UPDATE SET
         saved_value_id = excluded.saved_value_id,
         updated_at = datetime('now')`,
      [input.repoId, input.envKeyId, input.savedValueId],
    );
  }

  async setWorkspaceRepoSelection(input: SetWorkspaceRepoSelectionInput): Promise<void> {
    const db = await this.open();
    await this.assertSavedValueSelection(db, input);
    await run(
      db,
      `INSERT INTO workspace_repo_env_selections (workspace_id, repo_id, env_key_id, saved_value_id, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(workspace_id, repo_id, env_key_id) DO UPDATE SET
         saved_value_id = excluded.saved_value_id,
         updated_at = datetime('now')`,
      [input.workspaceId, input.repoId, input.envKeyId, input.savedValueId],
    );
  }

  async resolveRepoEnvForLaunch(input: ResolveRepoEnvForLaunchInput): Promise<ResolvedRepoEnv> {
    const db = await this.open();
    const rows = await all(
      db,
      `SELECT
         k.id AS env_key_id,
         k.key AS env_key,
         k.kind AS kind,
         k.required AS required,
         k.repo_id AS repo_id,
         k.description AS description,
         k.created_at AS key_created_at,
         k.updated_at AS key_updated_at,
         COALESCE(w.saved_value_id, d.saved_value_id) AS selected_saved_value_id,
         v.name AS saved_value_name,
         v.stored_value AS stored_value
       FROM repo_env_keys k
       LEFT JOIN repo_env_default_selections d
         ON d.repo_id = k.repo_id AND d.env_key_id = k.id
       LEFT JOIN workspace_repo_env_selections w
         ON w.repo_id = k.repo_id AND w.env_key_id = k.id AND w.workspace_id = ?
       LEFT JOIN repo_env_saved_values v
         ON v.id = COALESCE(w.saved_value_id, d.saved_value_id)
        AND v.repo_id = k.repo_id
        AND v.env_key_id = k.id
       WHERE k.repo_id = ?
       ORDER BY k.key ASC`,
      [input.workspaceId ?? '', input.repoId],
    );

    const env: Record<string, string> = {};
    const missingRequired: RepoEnvKeyMetadata[] = [];
    const metadata: ResolvedRepoEnv['metadata'] = [];
    for (const row of rows) {
      const key = requireString(row.env_key, 'env_key');
      const value = optionalString(row.stored_value);
      if (value != null) env[key] = value;
      if (value == null && truthyNumber(row.required)) {
        missingRequired.push(rowToEnvKeyMetadata({
          id: row.env_key_id,
          repo_id: row.repo_id,
          key: row.env_key,
          kind: row.kind,
          required: row.required,
          description: row.description,
          created_at: row.key_created_at,
          updated_at: row.key_updated_at,
        }));
      }
      metadata.push({
        key,
        kind: requireKind(row.kind),
        savedValueId: optionalString(row.selected_saved_value_id),
        savedValueName: optionalString(row.saved_value_name),
      });
    }
    return { env, missingRequired, metadata };
  }

  private async open(): Promise<SqlcipherDatabase> {
    if (this.db != null) return this.db;
    const existingDb = await fileExists(this.options.dbPath);
    await mkdir(dirname(this.options.dbPath), { recursive: true, mode: 0o700 });
    const keyMaterial = await loadOrCreateVardashSqlcipherKey({
      ...this.options.keyOptions,
      allowCreate: this.options.keyOptions?.allowCreate ?? !existingDb,
    });
    const sqlite = (this.options.sqlite ?? loadSqlcipher()).verbose();
    const db = new sqlite.Database(this.options.dbPath);
    await exec(db, `PRAGMA key = ${sqlStringLiteral(keyMaterial.key)}; PRAGMA foreign_keys = ON;`);
    this.db = db;
    return db;
  }

  private async getKeyForSavedValue(db: SqlcipherDatabase, repoId: string, envKeyId: string): Promise<RepoEnvKeyMetadata> {
    const row = await getRequired(
      db,
      `SELECT id, repo_id, key, kind, required, description, created_at, updated_at
       FROM repo_env_keys WHERE repo_id = ? AND id = ?`,
      [repoId, envKeyId],
    );
    return rowToEnvKeyMetadata(row);
  }

  private async savedValueMetadata(
    db: SqlcipherDatabase,
    input: { repoId: string; envKeyId: string; savedValueId: string },
  ): Promise<RepoEnvSavedValueMetadata> {
    const row = await getRequired(
      db,
      `SELECT
         v.id AS id,
         v.repo_id AS repo_id,
         v.env_key_id AS env_key_id,
         v.name AS name,
         v.stored_value AS stored_value,
         v.created_at AS created_at,
         v.updated_at AS updated_at,
         k.kind AS kind
       FROM repo_env_saved_values v
       JOIN repo_env_keys k
         ON k.id = v.env_key_id AND k.repo_id = v.repo_id
       WHERE v.id = ? AND v.repo_id = ? AND v.env_key_id = ?`,
      [input.savedValueId, input.repoId, input.envKeyId],
    );
    return rowToSavedValueMetadata(row, requireKind(row.kind));
  }

  private async assertSavedValueSelection(db: SqlcipherDatabase, input: SetSelectionInput): Promise<void> {
    await getRequired(
      db,
      `SELECT id FROM repo_env_keys WHERE id = ? AND repo_id = ?`,
      [input.envKeyId, input.repoId],
    );
    if (input.savedValueId == null) return;
    const row = await get(
      db,
      `SELECT id FROM repo_env_saved_values
       WHERE id = ? AND repo_id = ? AND env_key_id = ?`,
      [input.savedValueId, input.repoId, input.envKeyId],
    );
    if (row == null) throw new Error('Selected vardash saved value does not belong to the repo env key');
  }

  private async assertKindChangeAllowed(
    db: SqlcipherDatabase,
    envKeyId: string,
    existingKind: VardashValueKind,
    nextKind: VardashValueKind,
  ): Promise<void> {
    if (existingKind !== 'secret' || nextKind !== 'plain') return;
    const row = await getRequired(
      db,
      `SELECT COUNT(*) AS value_count FROM repo_env_saved_values WHERE env_key_id = ?`,
      [envKeyId],
    );
    if (requireNumber(row.value_count, 'value_count') > 0) {
      throw new Error('Cannot change vardash env key from secret to plain while saved values exist');
    }
  }
}

function loadSqlcipher(): SqlcipherModule {
  return require('@journeyapps/sqlcipher') as SqlcipherModule;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function exec(db: SqlcipherDatabase, sql: string): Promise<void> {
  return new Promise((resolve, reject) => db.exec(sql, (error) => (error ? reject(error) : resolve())));
}

function run(db: SqlcipherDatabase, sql: string, params: unknown[]): Promise<number> {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function runCallback(error) {
      if (error) reject(error);
      else resolve(this.changes);
    });
  });
}

function get(db: SqlcipherDatabase, sql: string, params: unknown[]): Promise<Row | undefined> {
  return new Promise((resolve, reject) => db.get(sql, params, (error, row) => (error ? reject(error) : resolve(row))));
}

async function getRequired(db: SqlcipherDatabase, sql: string, params: unknown[]): Promise<Row> {
  const row = await get(db, sql, params);
  if (row == null) throw new Error('Expected vardash row was not found');
  return row;
}

function all(db: SqlcipherDatabase, sql: string, params: unknown[]): Promise<Row[]> {
  return new Promise((resolve, reject) => db.all(sql, params, (error, rows) => (error ? reject(error) : resolve(rows))));
}

function close(db: SqlcipherDatabase): Promise<void> {
  return new Promise((resolve, reject) => db.close((error) => (error ? reject(error) : resolve())));
}

function rowToEnvKeyMetadata(row: Row): RepoEnvKeyMetadata {
  return {
    id: requireString(row.id, 'id'),
    repoId: requireString(row.repo_id, 'repo_id'),
    key: requireString(row.key, 'key'),
    kind: requireKind(row.kind),
    required: truthyNumber(row.required),
    description: optionalString(row.description),
    createdAt: requireString(row.created_at, 'created_at'),
    updatedAt: requireString(row.updated_at, 'updated_at'),
  };
}

function rowToSavedValueMetadata(row: Row, kind: VardashValueKind): RepoEnvSavedValueMetadata {
  const metadata: RepoEnvSavedValueMetadata = {
    id: requireString(row.id, 'id'),
    repoId: requireString(row.repo_id, 'repo_id'),
    envKeyId: requireString(row.env_key_id, 'env_key_id'),
    name: requireString(row.name, 'name'),
    kind,
    hasValue: optionalString(row.stored_value) != null,
    createdAt: requireString(row.created_at, 'created_at'),
    updatedAt: requireString(row.updated_at, 'updated_at'),
  };
  if (kind === 'plain') metadata.value = optionalString(row.stored_value) ?? '';
  return metadata;
}

function validateKind(kind: string): asserts kind is VardashValueKind {
  if (kind !== 'secret' && kind !== 'plain') throw new Error(`Invalid vardash env kind: ${kind}`);
}

function requireKind(value: unknown): VardashValueKind {
  if (value === 'secret' || value === 'plain') return value;
  throw new Error('Invalid vardash env kind in store row');
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`Expected string for ${field}`);
  return value;
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== 'number') throw new Error(`Expected number for ${field}`);
  return value;
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function truthyNumber(value: unknown): boolean {
  return value === 1 || value === true;
}

function sqlStringLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

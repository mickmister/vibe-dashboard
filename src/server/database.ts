import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { Kysely, SqliteDialect, sql } from 'kysely';
import type { DB } from '../store/kysely_types';
import { migrations } from '../store/db/imported_migrations/imported_migrations';

export interface VdDbHandle {
  db: Kysely<DB>;
  sqlite: Database.Database;
  path: string;
  appliedMigrations: string[];
}

let cachedHandle: Promise<VdDbHandle> | undefined;

export function getVdDbPath(env: Record<string, string | undefined> = process.env): string {
  return env.VD_DB_PATH || join(process.cwd(), 'data', 'vd.sqlite');
}

export async function initVdDb(options: { path?: string; runMigrations?: boolean } = {}): Promise<VdDbHandle> {
  const databasePath = options.path ?? getVdDbPath();
  if (databasePath !== ':memory:') {
    await mkdir(dirname(databasePath), { recursive: true });
  }

  const sqlite = new Database(databasePath);
  sqlite.pragma('foreign_keys = ON');

  const db = new Kysely<DB>({
    dialect: new SqliteDialect({ database: sqlite }),
  });

  const appliedMigrations = options.runMigrations === false ? [] : await migrateVdDb(db);
  return { db, sqlite, path: databasePath, appliedMigrations };
}

export function getVdDb(): Promise<VdDbHandle> {
  cachedHandle ??= initVdDb();
  return cachedHandle;
}

export async function resetVdDbForTests(): Promise<void> {
  const handle = await cachedHandle;
  cachedHandle = undefined;
  await handle?.db.destroy();
  handle?.sqlite.close();
}

export async function migrateVdDb(db: Kysely<DB>): Promise<string[]> {
  await db.schema
    .createTable('Migration')
    .ifNotExists()
    .addColumn('id', 'integer', (column) => column.primaryKey().autoIncrement())
    .addColumn('name', 'text', (column) => column.notNull().unique())
    .addColumn('createdAt', 'text', (column) => column.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .execute();

  const existing = await db.selectFrom('Migration').select('name').execute();
  const existingNames = new Set(existing.map((migration) => migration.name));
  const applied: string[] = [];

  for (const migration of migrations) {
    if (existingNames.has(migration.name)) continue;
    await executeSqlMigration(db, migration.migration);
    await db.insertInto('Migration').values({ name: migration.name }).execute();
    applied.push(migration.name);
  }

  return applied;
}

export async function executeSqlMigration(db: Kysely<any>, migrationSql: string): Promise<void> {
  const statements = splitSqlStatements(migrationSql);
  for (const statement of statements) {
    await sql`${sql.raw(statement)}`.execute(db);
  }
}

export function splitSqlStatements(migrationSql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let quote: '"' | "'" | '`' | undefined;
  let lineComment = false;

  for (let index = 0; index < migrationSql.length; index += 1) {
    const char = migrationSql[index];
    const next = migrationSql[index + 1];

    if (lineComment) {
      current += char;
      if (char === '\n') lineComment = false;
      continue;
    }

    if (!quote && char === '-' && next === '-') {
      lineComment = true;
      current += char;
      continue;
    }

    if (quote) {
      current += char;
      if (char === quote && migrationSql[index - 1] !== '\\') quote = undefined;
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      current += char;
      continue;
    }

    if (char === ';') {
      const trimmed = current.trim();
      if (trimmed) statements.push(trimmed);
      current = '';
      continue;
    }

    current += char;
  }

  const trimmed = current.trim();
  if (trimmed) statements.push(trimmed);
  return statements;
}

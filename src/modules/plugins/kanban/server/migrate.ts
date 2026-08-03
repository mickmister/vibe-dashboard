import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { DB } from '../../../../store/kysely_types';
import { migrations } from '../../../../store/db/imported_migrations/imported_migrations';

export async function migrateExternalIntegrationsDb(db: Kysely<DB>): Promise<string[]> {
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

import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';

function splitSqlStatements(migrationSql) {
  const statements = [];
  let current = '';
  let quote;
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

async function listMigrationNames() {
  const migrationsRoot = join(process.cwd(), 'db/dialects/sqlite/migrations');
  const entries = await readdir(migrationsRoot);
  const migrationNames = [];
  for (const entry of entries.sort()) {
    if (entry.startsWith('.')) continue;
    const entryPath = join(migrationsRoot, entry);
    if ((await stat(entryPath)).isDirectory()) migrationNames.push(entry);
  }
  return migrationNames;
}

const tempDir = await mkdtemp(join(tmpdir(), 'vd-external-db-'));
const dbPath = join(tempDir, 'smoke.sqlite');
const migrationNames = await listMigrationNames();

try {
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  db.exec('CREATE TABLE IF NOT EXISTS "Migration" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "name" TEXT NOT NULL UNIQUE, "createdAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)');

  for (const migrationName of migrationNames) {
    const migrationPath = join(process.cwd(), 'db/dialects/sqlite/migrations', migrationName, 'migration.sql');
    const migrationSql = await readFile(migrationPath, 'utf8');
    for (const statement of splitSqlStatements(migrationSql)) {
      db.exec(statement);
    }
    db.prepare('INSERT INTO "Migration" ("name") VALUES (?)').run(migrationName);
  }

  const tableNames = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
  const requiredTables = [
    'BetterAuthUser',
    'BetterAuthSession',
    'BetterAuthAccount',
    'BetterAuthVerification',
    'ExternalProviderConnection',
    'ExternalIssue',
    'VKWorkspace',
    'ExternalIssueWorkspaceLink',
    'Migration',
  ];
  const missing = requiredTables.filter((tableName) => !tableNames.has(tableName));
  if (missing.length) {
    throw new Error(`Missing migrated tables: ${missing.join(', ')}`);
  }

  db.close();
  console.log(`External integrations DB smoke passed (${migrationNames.length} migrations applied)`);
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

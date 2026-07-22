import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { getVdDbPath, initVdDb, splitSqlStatements } from './database';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('VD database', () => {
  it('uses VD_DB_PATH or data/vd.sqlite without legacy external tracker fallback', () => {
    expect(getVdDbPath({ VD_DB_PATH: '/tmp/custom.sqlite' })).toBe('/tmp/custom.sqlite');
    expect(getVdDbPath({ VD_EXTERNAL_TRACKERS_DB_PATH: '/tmp/legacy.sqlite' })).toMatch(/data\/vd\.sqlite$/);
  });

  it('initializes workflow run tables and records applied migrations', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vd-db-'));
    tempDirs.push(dir);
    const handle = await initVdDb({ path: join(dir, 'vd.sqlite') });
    try {
      expect(handle.appliedMigrations).toContain('20260722000000_workflow_runs');
      const tables = await sql<{ name: string }>`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name IN ('WorkflowRun', 'WorkflowRunEvent', 'Migration')
      `.execute(handle.db);
      expect(tables.rows.map((table) => table.name).sort()).toEqual(['Migration', 'WorkflowRun', 'WorkflowRunEvent']);
    } finally {
      await handle.db.destroy();
      handle.sqlite.close();
    }
  });

  it('splits SQL statements while preserving quoted semicolons', () => {
    expect(splitSqlStatements("CREATE TABLE t (value TEXT DEFAULT ';'); INSERT INTO t VALUES ('a;b');")).toEqual([
      "CREATE TABLE t (value TEXT DEFAULT ';')",
      "INSERT INTO t VALUES ('a;b')",
    ]);
  });
});

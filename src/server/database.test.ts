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
      expect(handle.appliedMigrations).toEqual([
        '20260722000000_workflow_runs',
        '20260722010000_workflow_run_indexes',
        '20260731000000_workflow_orchestration',
        '20260731010000_workflow_role_session_bindings',
      ]);
      const tables = await sql<{ name: string }>`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name IN ('WorkflowRun', 'WorkflowRunEvent', 'WorkflowInstance', 'WorkflowStepState', 'WorkflowScopedTrigger', 'WorkflowRoleSessionBinding', 'Migration')
      `.execute(handle.db);
      expect(tables.rows.map((table) => table.name).sort()).toEqual(['Migration', 'WorkflowInstance', 'WorkflowRoleSessionBinding', 'WorkflowRun', 'WorkflowRunEvent', 'WorkflowScopedTrigger', 'WorkflowStepState']);
    } finally {
      await handle.db.destroy();
      handle.sqlite.close();
    }
  });

  it('initializes workflow run lookup indexes', async () => {
    const handle = await initVdDb({ path: ':memory:' });
    try {
      const indexes = await sql<{ name: string }>`
        SELECT name FROM sqlite_master
        WHERE type = 'index' AND name IN (
          'idx_workflow_run_workflow_status_started',
          'idx_workflow_run_trigger_started',
          'idx_workflow_run_vk_workspace_started',
          'idx_workflow_run_vk_session_started',
          'idx_workflow_run_vk_queue_item_started',
          'idx_workflow_run_vk_execution_process_started',
          'idx_workflow_run_event_type_run_index',
          'idx_workflow_run_event_run_index',
          'idx_workflow_instance_workflow_status_updated',
          'idx_workflow_instance_team_status_updated',
          'idx_workflow_instance_lane_status_updated',
          'idx_workflow_instance_latest_run',
          'idx_workflow_instance_recovery',
          'idx_workflow_step_instance_key',
          'idx_workflow_step_instance_status',
          'idx_workflow_step_waiting_trigger',
          'idx_workflow_trigger_instance_status',
          'idx_workflow_trigger_active_session',
          'idx_workflow_trigger_expected_queue_item',
          'idx_workflow_trigger_source_execution',
          'idx_workflow_trigger_timeout',
          'idx_workflow_role_binding_workspace_lane_role',
          'idx_workflow_role_binding_team_lane_role',
          'idx_workflow_role_binding_instance',
          'idx_workflow_role_binding_session'
        )
      `.execute(handle.db);
      expect(indexes.rows.map((index) => index.name).sort()).toEqual([
        'idx_workflow_instance_lane_status_updated',
        'idx_workflow_instance_latest_run',
        'idx_workflow_instance_recovery',
        'idx_workflow_instance_team_status_updated',
        'idx_workflow_instance_workflow_status_updated',
        'idx_workflow_role_binding_instance',
        'idx_workflow_role_binding_session',
        'idx_workflow_role_binding_team_lane_role',
        'idx_workflow_role_binding_workspace_lane_role',
        'idx_workflow_run_event_run_index',
        'idx_workflow_run_event_type_run_index',
        'idx_workflow_run_trigger_started',
        'idx_workflow_run_vk_execution_process_started',
        'idx_workflow_run_vk_queue_item_started',
        'idx_workflow_run_vk_session_started',
        'idx_workflow_run_vk_workspace_started',
        'idx_workflow_run_workflow_status_started',
        'idx_workflow_step_instance_key',
        'idx_workflow_step_instance_status',
        'idx_workflow_step_waiting_trigger',
        'idx_workflow_trigger_active_session',
        'idx_workflow_trigger_expected_queue_item',
        'idx_workflow_trigger_instance_status',
        'idx_workflow_trigger_source_execution',
        'idx_workflow_trigger_timeout',
      ]);
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

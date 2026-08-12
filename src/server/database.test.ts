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
        '20260804000000_workflow_external_waits',
        '20260804010000_response_pipes',
        '20260804020000_factory_work_items',
        '20260804030000_declarative_workflow_definitions',
        '20260808000000_workflow_webhook_inbox',
        '20260808010000_workflow_webhook_provisioning',
        '20260811000000_workflow_attention_items',
        '20260811010000_workflow_design_library',
        '20260811020000_workflow_persisted_runs',
        '20260811030000_workflow_batches',
      ]);
      const tables = await sql<{ name: string }>`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name IN (
          'WorkflowRun', 'WorkflowRunEvent', 'WorkflowInstance', 'WorkflowStepState',
          'WorkflowScopedTrigger', 'WorkflowRoleSessionBinding', 'WorkflowExternalWait',
          'ResponseCollection', 'ResponsePipeDelivery', 'WorkflowFactoryWorkItem',
          'DeclarativeWorkflowDefinition', 'WorkflowWebhookInbox',
          'WorkflowWebhookProvisioningState', 'WorkflowAttentionItem',
          'WorkflowDesign', 'WorkflowDesignDraft', 'WorkflowDesignVersion',
          'WorkflowPromptAsset', 'WorkflowSkillAsset', 'WorkflowDesignRunSnapshot',
          'WorkflowPersistedRun', 'WorkflowBatch', 'WorkflowBatchItem', 'Migration'
        )
      `.execute(handle.db);
      expect(tables.rows.map((table) => table.name).sort()).toEqual([
        'DeclarativeWorkflowDefinition',
        'Migration',
        'ResponseCollection',
        'ResponsePipeDelivery',
        'WorkflowAttentionItem',
        'WorkflowBatch',
        'WorkflowBatchItem',
        'WorkflowDesign',
        'WorkflowDesignDraft',
        'WorkflowDesignRunSnapshot',
        'WorkflowDesignVersion',
        'WorkflowExternalWait',
        'WorkflowFactoryWorkItem',
        'WorkflowInstance',
        'WorkflowPersistedRun',
        'WorkflowPromptAsset',
        'WorkflowRoleSessionBinding',
        'WorkflowRun',
        'WorkflowRunEvent',
        'WorkflowScopedTrigger',
        'WorkflowSkillAsset',
        'WorkflowStepState',
        'WorkflowWebhookInbox',
        'WorkflowWebhookProvisioningState',
      ]);
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
          'idx_workflow_role_binding_session',
          'idx_workflow_external_wait_active_session',
          'idx_workflow_external_wait_instance_status',
          'idx_workflow_external_wait_source_execution',
          'idx_response_collection_instance_status',
          'idx_response_collection_trigger',
          'idx_response_collection_workflow_run',
          'idx_response_pipe_delivery_source',
          'idx_response_pipe_delivery_target_status',
          'idx_response_pipe_delivery_instance_status',
          'idx_response_pipe_delivery_trigger_status',
          'idx_response_pipe_delivery_queue_item',
          'idx_factory_work_pending_order',
          'idx_factory_work_workspace_role_lane_status',
          'idx_declarative_workflow_definition_id_status_version',
          'idx_workflow_webhook_inbox_source_received',
          'idx_workflow_webhook_inbox_status_received',
          'idx_workflow_webhook_inbox_execution',
          'idx_workflow_webhook_inbox_session_received',
          'idx_workflow_webhook_provisioning_upsert_key',
          'idx_workflow_webhook_provisioning_status_updated',
          'idx_declarative_workflow_definition_status_updated',
          'idx_factory_work_assignment',
          'idx_factory_work_queue_item',
          'idx_factory_work_instance_status',
          'idx_workflow_batch_workspace_updated',
          'idx_workflow_batch_item_batch_status_index',
          'idx_workflow_batch_item_pending',
          'idx_workflow_batch_item_run'
        )
      `.execute(handle.db);
      expect(indexes.rows.map((index) => index.name).sort()).toEqual([
        'idx_declarative_workflow_definition_id_status_version',
        'idx_declarative_workflow_definition_status_updated',
        'idx_factory_work_assignment',
        'idx_factory_work_instance_status',
        'idx_factory_work_pending_order',
        'idx_factory_work_queue_item',
        'idx_factory_work_workspace_role_lane_status',
        'idx_response_collection_instance_status',
        'idx_response_collection_trigger',
        'idx_response_collection_workflow_run',
        'idx_response_pipe_delivery_instance_status',
        'idx_response_pipe_delivery_queue_item',
        'idx_response_pipe_delivery_source',
        'idx_response_pipe_delivery_target_status',
        'idx_response_pipe_delivery_trigger_status',
        'idx_workflow_batch_item_batch_status_index',
        'idx_workflow_batch_item_pending',
        'idx_workflow_batch_item_run',
        'idx_workflow_batch_workspace_updated',
        'idx_workflow_external_wait_active_session',
        'idx_workflow_external_wait_instance_status',
        'idx_workflow_external_wait_source_execution',
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
        'idx_workflow_webhook_inbox_execution',
        'idx_workflow_webhook_inbox_session_received',
        'idx_workflow_webhook_inbox_source_received',
        'idx_workflow_webhook_inbox_status_received',
        'idx_workflow_webhook_provisioning_status_updated',
        'idx_workflow_webhook_provisioning_upsert_key',
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

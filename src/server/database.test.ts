import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { executeSqlMigration, getVdDbPath, initVdDb, splitSqlStatements } from './database';
import { migration as workAreaMigration } from '../store/db/migrations/20260912000000_workflow_work_areas/migration';
import { migration as workAreaLeaseMigration } from '../store/db/migrations/20260912010000_workflow_work_area_leases/migration';
import { migration as workAreaLockDomainMigration } from '../store/db/migrations/20260912020000_workflow_work_area_lock_domain/migration';
import { migration as workAreaHostIdentityMigration } from '../store/db/migrations/20260912030000_workflow_work_area_host_identity/migration';
import { migration as workAreaRegistryIdentityMigration } from '../store/db/migrations/20260912040000_workflow_work_area_registry_identity/migration';
import { migration as workAreaRegistryAdoptionAuditMigration } from '../store/db/migrations/20260912050000_workflow_work_area_registry_adoption_audit/migration';
import { migration as workAreaAdoptionCapabilityMigration } from '../store/db/migrations/20260912060000_workflow_work_area_adoption_capability/migration';

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
        '20260702000000_external_integrations',
        '20260702010000_external_issue_workspace_mappings',
        '20260702020000_external_repo_project_mappings',
        '20260804220000_external_repo_project_mapping_site_scope',
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
        '20260814000000_workspace_lanes',
        '20260815000000_workflow_meta_runs',
        '20260817000000_workflow_meta_run_child_bindings',
        '20260817001000_workflow_role_templates',
        '20260912000000_workflow_work_areas',
        '20260912010000_workflow_work_area_leases',
        '20260912020000_workflow_work_area_lock_domain',
        '20260912030000_workflow_work_area_host_identity',
        '20260912040000_workflow_work_area_registry_identity',
        '20260912050000_workflow_work_area_registry_adoption_audit',
        '20260912060000_workflow_work_area_adoption_capability',
        '20260912070000_workflow_issued_plans',
        '20260912080000_harden_workflow_plan_launch',
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
          'WorkflowPromptAsset', 'WorkflowRoleTemplate', 'WorkflowSkillAsset', 'WorkflowDesignRunSnapshot',
          'WorkflowPersistedRun', 'WorkflowBatch', 'WorkflowBatchItem',
          'WorkspaceLane', 'WorkspaceLaneBinding', 'WorkspaceLaneCapacityLease',
          'WorkspaceLaneAuditEvent', 'WorkflowMetaRun', 'WorkflowMetaRunItem',
          'WorkflowMetaRunEvent', 'WorkflowWorkArea', 'WorkflowWorkAreaRepository',
          'WorkflowWorkAreaOperation', 'WorkflowWorkAreaOperationLease', 'WorkflowWorkAreaLockDomain', 'WorkflowWorkAreaRegistryIdentity',
          'WorkflowWorkAreaRegistryAdoptionAudit', 'WorkflowWorkAreaAuditEvent',
          'WorkflowIssuedPlan', 'WorkflowPlanLaunchEffect', 'WorkflowPlanAuditEvent', 'Migration'
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
        'WorkflowIssuedPlan',
        'WorkflowMetaRun',
        'WorkflowMetaRunEvent',
        'WorkflowMetaRunItem',
        'WorkflowPersistedRun',
        'WorkflowPlanAuditEvent',
        'WorkflowPlanLaunchEffect',
        'WorkflowPromptAsset',
        'WorkflowRoleSessionBinding',
        'WorkflowRoleTemplate',
        'WorkflowRun',
        'WorkflowRunEvent',
        'WorkflowScopedTrigger',
        'WorkflowSkillAsset',
        'WorkflowStepState',
        'WorkflowWebhookInbox',
        'WorkflowWebhookProvisioningState',
        'WorkflowWorkArea',
        'WorkflowWorkAreaAuditEvent',
        'WorkflowWorkAreaLockDomain',
        'WorkflowWorkAreaOperation',
        'WorkflowWorkAreaOperationLease',
        'WorkflowWorkAreaRegistryAdoptionAudit',
        'WorkflowWorkAreaRegistryIdentity',
        'WorkflowWorkAreaRepository',
        'WorkspaceLane',
        'WorkspaceLaneAuditEvent',
        'WorkspaceLaneBinding',
        'WorkspaceLaneCapacityLease',
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

  it('forwards an intermediate work-area registry without rewriting its applied migration', async () => {
    const handle = await initVdDb({ path: ':memory:', runMigrations: false });
    try {
      await executeSqlMigration(handle.db, workAreaMigration);
      await executeSqlMigration(handle.db, workAreaLeaseMigration);
      await executeSqlMigration(handle.db, workAreaLockDomainMigration);
      await executeSqlMigration(handle.db, workAreaHostIdentityMigration);
      await executeSqlMigration(handle.db, workAreaRegistryIdentityMigration);
      await executeSqlMigration(handle.db, workAreaRegistryAdoptionAuditMigration);
      await executeSqlMigration(handle.db, workAreaAdoptionCapabilityMigration);
      const columns = await sql<{ name: string }>`PRAGMA table_info('WorkflowWorkAreaRepository')`.execute(handle.db);
      expect(columns.rows.map((column) => column.name)).toContain('sourceIdentity');
      const lease = await sql<{ name: string }>`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'WorkflowWorkAreaOperationLease'`.execute(handle.db);
      expect(lease.rows).toEqual([{ name: 'WorkflowWorkAreaOperationLease' }]);
      const domain = await sql<{ name: string }>`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'WorkflowWorkAreaLockDomain'`.execute(handle.db);
      expect(domain.rows).toEqual([{ name: 'WorkflowWorkAreaLockDomain' }]);
      const domainColumns = await sql<{ name: string }>`PRAGMA table_info('WorkflowWorkAreaLockDomain')`.execute(handle.db);
      expect(domainColumns.rows.map((column) => column.name)).toEqual(expect.arrayContaining(['deploymentMode', 'hostIdentityDigest']));
      const registryIdentity = await sql<{ name: string }>`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'WorkflowWorkAreaRegistryIdentity'`.execute(handle.db);
      expect(registryIdentity.rows).toEqual([{ name: 'WorkflowWorkAreaRegistryIdentity' }]);
      const adoptionAudit = await sql<{ name: string }>`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'WorkflowWorkAreaRegistryAdoptionAudit'`.execute(handle.db);
      expect(adoptionAudit.rows).toEqual([{ name: 'WorkflowWorkAreaRegistryAdoptionAudit' }]);
      const adoptionColumns = await sql<{ name: string }>`PRAGMA table_info('WorkflowWorkAreaRegistryAdoptionAudit')`.execute(handle.db);
      expect(adoptionColumns.rows.map((column) => column.name)).toEqual(expect.arrayContaining(['capabilityId', 'capabilityGeneration']));
    } finally {
      await handle.db.destroy(); handle.sqlite.close();
    }
  });

  it('splits SQL statements while preserving quoted semicolons', () => {
    expect(splitSqlStatements("CREATE TABLE t (value TEXT DEFAULT ';'); INSERT INTO t VALUES ('a;b');")).toEqual([
      "CREATE TABLE t (value TEXT DEFAULT ';')",
      "INSERT INTO t VALUES ('a;b')",
    ]);
  });
});

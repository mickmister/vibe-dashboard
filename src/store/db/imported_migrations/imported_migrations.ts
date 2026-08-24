<<<<<<< HEAD
import { migration as workflowRunsMigration } from '../migrations/20260722000000_workflow_runs/migration';
import { migration as workflowRunIndexesMigration } from '../migrations/20260722010000_workflow_run_indexes/migration';
import { migration as workflowOrchestrationMigration } from '../migrations/20260731000000_workflow_orchestration/migration';
import { migration as workflowRoleSessionBindingsMigration } from '../migrations/20260731010000_workflow_role_session_bindings/migration';
import { migration as workflowExternalWaitsMigration } from '../migrations/20260804000000_workflow_external_waits/migration';
import { migration as responsePipesMigration } from '../migrations/20260804010000_response_pipes/migration';
import { migration as factoryWorkItemsMigration } from '../migrations/20260804020000_factory_work_items/migration';
import { migration as declarativeWorkflowDefinitionsMigration } from '../migrations/20260804030000_declarative_workflow_definitions/migration';
import { migration as workflowWebhookInboxMigration } from '../migrations/20260808000000_workflow_webhook_inbox/migration';
import { migration as workflowWebhookProvisioningMigration } from '../migrations/20260808010000_workflow_webhook_provisioning/migration';
import { migration as workflowAttentionItemsMigration } from '../migrations/20260811000000_workflow_attention_items/migration';
import { migration as workflowDesignLibraryMigration } from '../migrations/20260811010000_workflow_design_library/migration';
import { migration as workflowPersistedRunsMigration } from '../migrations/20260811020000_workflow_persisted_runs/migration';
import { migration as workflowBatchesMigration } from '../migrations/20260811030000_workflow_batches/migration';
import { migration as workspaceLanesMigration } from '../migrations/20260814000000_workspace_lanes/migration';
import { migration as workflowMetaRunsMigration } from '../migrations/20260815000000_workflow_meta_runs/migration';
import { migration as workflowMetaRunChildBindingsMigration } from '../migrations/20260817000000_workflow_meta_run_child_bindings/migration';
import { migration as workflowRoleTemplatesMigration } from '../migrations/20260817001000_workflow_role_templates/migration';

export const migrations = [
  {
    name: '20260722000000_workflow_runs',
    migration: workflowRunsMigration,
  },
  {
    name: '20260722010000_workflow_run_indexes',
    migration: workflowRunIndexesMigration,
  },
  {
    name: '20260731000000_workflow_orchestration',
    migration: workflowOrchestrationMigration,
  },
  {
    name: '20260731010000_workflow_role_session_bindings',
    migration: workflowRoleSessionBindingsMigration,
  },
  {
    name: '20260804000000_workflow_external_waits',
    migration: workflowExternalWaitsMigration,
  },
  {
    name: '20260804010000_response_pipes',
    migration: responsePipesMigration,
  },
  {
    name: '20260804020000_factory_work_items',
    migration: factoryWorkItemsMigration,
  },
  {
    name: '20260804030000_declarative_workflow_definitions',
    migration: declarativeWorkflowDefinitionsMigration,
  },
  {
    name: '20260808000000_workflow_webhook_inbox',
    migration: workflowWebhookInboxMigration,
  },
  {
    name: '20260808010000_workflow_webhook_provisioning',
    migration: workflowWebhookProvisioningMigration,
  },
  {
    name: '20260811000000_workflow_attention_items',
    migration: workflowAttentionItemsMigration,
  },
  {
    name: '20260811010000_workflow_design_library',
    migration: workflowDesignLibraryMigration,
  },
  {
    name: '20260811020000_workflow_persisted_runs',
    migration: workflowPersistedRunsMigration,
  },
  {
    name: '20260811030000_workflow_batches',
    migration: workflowBatchesMigration,
  },
  {
    name: '20260814000000_workspace_lanes',
    migration: workspaceLanesMigration,
  },
  {
    name: '20260815000000_workflow_meta_runs',
    migration: workflowMetaRunsMigration,
  },
  {
    name: '20260817000000_workflow_meta_run_child_bindings',
    migration: workflowMetaRunChildBindingsMigration,
  },
  {
    name: '20260817001000_workflow_role_templates',
    migration: workflowRoleTemplatesMigration,
  },
];
=======
import _20260702000000_external_integrations from '../migrations/20260702000000_external_integrations/migration';
import _20260702010000_external_issue_workspace_mappings from '../migrations/20260702010000_external_issue_workspace_mappings/migration';
import _20260702020000_external_repo_project_mappings from '../migrations/20260702020000_external_repo_project_mappings/migration';
import _20260804220000_external_repo_project_mapping_site_scope from '../migrations/20260804220000_external_repo_project_mapping_site_scope/migration';

export const databaseVersion = 4;

export const migrations = [
  { name: '20260702000000_external_integrations', migration: _20260702000000_external_integrations },
  { name: '20260702010000_external_issue_workspace_mappings', migration: _20260702010000_external_issue_workspace_mappings },
  { name: '20260702020000_external_repo_project_mappings', migration: _20260702020000_external_repo_project_mappings },
  { name: '20260804220000_external_repo_project_mapping_site_scope', migration: _20260804220000_external_repo_project_mapping_site_scope },
] as const;
>>>>>>> 2bb8b1ac2d3718c24c2fa760347adbe94aeea19b

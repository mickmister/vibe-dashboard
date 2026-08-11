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
];

import { migration as workflowRunsMigration } from '../migrations/20260722000000_workflow_runs/migration';
import { migration as workflowRunIndexesMigration } from '../migrations/20260722010000_workflow_run_indexes/migration';
import { migration as workflowOrchestrationMigration } from '../migrations/20260731000000_workflow_orchestration/migration';
import { migration as workflowRoleSessionBindingsMigration } from '../migrations/20260731010000_workflow_role_session_bindings/migration';
import { migration as workflowExternalWaitsMigration } from '../migrations/20260804000000_workflow_external_waits/migration';
import { migration as responsePipesMigration } from '../migrations/20260804010000_response_pipes/migration';

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
];

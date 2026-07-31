import { migration as workflowRunsMigration } from '../migrations/20260722000000_workflow_runs/migration';
import { migration as workflowRunIndexesMigration } from '../migrations/20260722010000_workflow_run_indexes/migration';
import { migration as workflowOrchestrationMigration } from '../migrations/20260731000000_workflow_orchestration/migration';

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
];

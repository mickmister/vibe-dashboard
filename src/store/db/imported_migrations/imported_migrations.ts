import { migration as workflowRunsMigration } from '../migrations/20260722000000_workflow_runs/migration';
import { migration as workflowRunIndexesMigration } from '../migrations/20260722010000_workflow_run_indexes/migration';

export const migrations = [
  {
    name: '20260722000000_workflow_runs',
    migration: workflowRunsMigration,
  },
  {
    name: '20260722010000_workflow_run_indexes',
    migration: workflowRunIndexesMigration,
  },
];

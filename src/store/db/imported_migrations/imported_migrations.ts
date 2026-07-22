import { migration as workflowRunsMigration } from '../migrations/20260722000000_workflow_runs/migration';

export const migrations = [
  {
    name: '20260722000000_workflow_runs',
    migration: workflowRunsMigration,
  },
];

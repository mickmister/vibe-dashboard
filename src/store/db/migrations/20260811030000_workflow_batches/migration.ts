export const migration = `
CREATE TABLE IF NOT EXISTS WorkflowBatch (
  batchId TEXT PRIMARY KEY NOT NULL,
  designId TEXT NOT NULL,
  designVersion INTEGER NOT NULL,
  workspaceId TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  FOREIGN KEY(designId, designVersion) REFERENCES WorkflowDesignVersion(designId, version) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS WorkflowBatchItem (
  batchItemId TEXT PRIMARY KEY NOT NULL,
  batchId TEXT NOT NULL,
  itemIndex INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'completed', 'blocked', 'failed', 'cancelled')),
  runId TEXT,
  runSnapshotId TEXT,
  inputJson TEXT NOT NULL,
  additionalInstructions TEXT,
  roleBindingsJson TEXT NOT NULL,
  errorJson TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  startedAt INTEGER,
  completedAt INTEGER,
  UNIQUE(batchId, itemIndex),
  FOREIGN KEY(batchId) REFERENCES WorkflowBatch(batchId) ON DELETE CASCADE,
  FOREIGN KEY(runId) REFERENCES WorkflowPersistedRun(runId) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_workflow_batch_workspace_updated
  ON WorkflowBatch(workspaceId, updatedAt DESC);

CREATE INDEX IF NOT EXISTS idx_workflow_batch_item_batch_status_index
  ON WorkflowBatchItem(batchId, status, itemIndex);

CREATE INDEX IF NOT EXISTS idx_workflow_batch_item_pending
  ON WorkflowBatchItem(status, createdAt, itemIndex);

CREATE INDEX IF NOT EXISTS idx_workflow_batch_item_run
  ON WorkflowBatchItem(runId);
`;

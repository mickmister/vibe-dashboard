export const migration = `
CREATE TABLE IF NOT EXISTS WorkflowPersistedRun (
  runId TEXT PRIMARY KEY NOT NULL,
  runSnapshotId TEXT NOT NULL UNIQUE,
  designId TEXT NOT NULL,
  designVersion INTEGER NOT NULL,
  workspaceId TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'blocked', 'failed', 'cancelled')),
  coreModelJson TEXT NOT NULL,
  coreSnapshotJson TEXT NOT NULL,
  roleBindingsJson TEXT NOT NULL,
  pendingEffectJson TEXT,
  queuedTurnsJson TEXT NOT NULL,
  eventsJson TEXT NOT NULL,
  errorJson TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  FOREIGN KEY(runSnapshotId) REFERENCES WorkflowDesignRunSnapshot(runSnapshotId) ON DELETE RESTRICT,
  FOREIGN KEY(designId, designVersion) REFERENCES WorkflowDesignVersion(designId, version) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_workflow_persisted_run_workspace_status_updated
  ON WorkflowPersistedRun(workspaceId, status, updatedAt DESC);

CREATE INDEX IF NOT EXISTS idx_workflow_persisted_run_design_version
  ON WorkflowPersistedRun(designId, designVersion);
`;

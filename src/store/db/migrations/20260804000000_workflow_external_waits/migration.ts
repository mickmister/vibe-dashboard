export const migration = `
CREATE TABLE IF NOT EXISTS WorkflowExternalWait (
  waitId TEXT PRIMARY KEY NOT NULL,
  instanceId TEXT,
  stepStateId TEXT,
  roleId TEXT,
  laneId TEXT,
  workspaceId TEXT NOT NULL,
  sessionId TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('callback', 'ci')),
  status TEXT NOT NULL CHECK(status IN ('active', 'resolved', 'cancelled')),
  externalRef TEXT,
  sourceExecutionProcessId TEXT,
  metadataJson TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  resolvedAt INTEGER,
  cancelledAt INTEGER,
  FOREIGN KEY(instanceId) REFERENCES WorkflowInstance(instanceId) ON DELETE CASCADE,
  FOREIGN KEY(stepStateId) REFERENCES WorkflowStepState(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_workflow_external_wait_active_session
  ON WorkflowExternalWait(status, workspaceId, sessionId, kind, updatedAt DESC);

CREATE INDEX IF NOT EXISTS idx_workflow_external_wait_instance_status
  ON WorkflowExternalWait(instanceId, status, updatedAt DESC);

CREATE INDEX IF NOT EXISTS idx_workflow_external_wait_source_execution
  ON WorkflowExternalWait(sourceExecutionProcessId);
`;

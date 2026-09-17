export const migration = `
CREATE TABLE IF NOT EXISTS WorkflowFactoryWorkItem (
  itemId TEXT PRIMARY KEY NOT NULL,
  factoryId TEXT,
  workflowInstanceId TEXT,
  workflowRunId TEXT,
  teamId TEXT,
  laneId TEXT,
  roleId TEXT,
  workspaceId TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'reserved', 'queued', 'completed', 'failed', 'cancelled')),
  priority INTEGER NOT NULL DEFAULT 0,
  prompt TEXT NOT NULL,
  promptHash TEXT NOT NULL,
  promptLength INTEGER NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('workflow', 'agent', 'system')),
  reservedSessionId TEXT,
  reservedBindingId TEXT,
  queueItemId TEXT,
  attemptCount INTEGER NOT NULL DEFAULT 0,
  lastErrorJson TEXT,
  metadataJson TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  reservedAt INTEGER,
  queuedAt INTEGER,
  completedAt INTEGER,
  cancelledAt INTEGER
);

CREATE INDEX IF NOT EXISTS idx_factory_work_pending_order
  ON WorkflowFactoryWorkItem(status, priority DESC, createdAt ASC, itemId ASC);

CREATE INDEX IF NOT EXISTS idx_factory_work_workspace_role_lane_status
  ON WorkflowFactoryWorkItem(workspaceId, roleId, laneId, status, priority DESC, createdAt ASC);

CREATE INDEX IF NOT EXISTS idx_factory_work_assignment
  ON WorkflowFactoryWorkItem(reservedSessionId, status, updatedAt DESC);

CREATE INDEX IF NOT EXISTS idx_factory_work_queue_item
  ON WorkflowFactoryWorkItem(queueItemId);

CREATE INDEX IF NOT EXISTS idx_factory_work_instance_status
  ON WorkflowFactoryWorkItem(workflowInstanceId, status, updatedAt DESC);
`;

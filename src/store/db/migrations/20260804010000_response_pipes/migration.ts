export const migration = `
CREATE TABLE IF NOT EXISTS ResponseCollection (
  collectionId TEXT PRIMARY KEY NOT NULL,
  workflowInstanceId TEXT,
  workflowRunId TEXT,
  triggerId TEXT,
  mode TEXT NOT NULL CHECK(mode IN ('manual', 'all_at_once', 'as_completed')),
  status TEXT NOT NULL CHECK(status IN ('collecting', 'ready', 'completed', 'failed', 'cancelled')),
  expectedCount INTEGER,
  receivedCount INTEGER NOT NULL DEFAULT 0,
  metadataJson TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  completedAt INTEGER
);

CREATE INDEX IF NOT EXISTS idx_response_collection_instance_status
  ON ResponseCollection(workflowInstanceId, status, updatedAt DESC);

CREATE INDEX IF NOT EXISTS idx_response_collection_trigger
  ON ResponseCollection(triggerId);

CREATE INDEX IF NOT EXISTS idx_response_collection_workflow_run
  ON ResponseCollection(workflowRunId);

CREATE TABLE IF NOT EXISTS ResponsePipeDelivery (
  deliveryId TEXT PRIMARY KEY NOT NULL,
  collectionId TEXT,
  workflowInstanceId TEXT,
  workflowRunId TEXT,
  triggerId TEXT,
  sourceWorkspaceId TEXT NOT NULL,
  sourceSessionId TEXT NOT NULL,
  sourceExecutionProcessId TEXT NOT NULL,
  sourceCompletedAt INTEGER,
  sourceRoleId TEXT,
  sourceLaneId TEXT,
  targetWorkspaceId TEXT NOT NULL,
  targetSessionId TEXT NOT NULL,
  targetRoleId TEXT,
  targetLaneId TEXT,
  templateId TEXT NOT NULL,
  templateVersion INTEGER,
  templateHash TEXT NOT NULL,
  renderedPromptHash TEXT,
  renderedPromptLength INTEGER,
  dedupeKey TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('planned', 'rendered', 'queued', 'failed', 'cancelled', 'skipped')),
  attemptCount INTEGER NOT NULL DEFAULT 0,
  queueItemId TEXT,
  errorJson TEXT,
  metadataJson TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  queuedAt INTEGER,
  completedAt INTEGER,
  FOREIGN KEY(collectionId) REFERENCES ResponseCollection(collectionId) ON DELETE SET NULL,
  UNIQUE(dedupeKey)
);

CREATE INDEX IF NOT EXISTS idx_response_pipe_delivery_source
  ON ResponsePipeDelivery(sourceExecutionProcessId, templateHash, targetSessionId);

CREATE INDEX IF NOT EXISTS idx_response_pipe_delivery_target_status
  ON ResponsePipeDelivery(targetWorkspaceId, targetSessionId, status, updatedAt DESC);

CREATE INDEX IF NOT EXISTS idx_response_pipe_delivery_instance_status
  ON ResponsePipeDelivery(workflowInstanceId, status, updatedAt DESC);

CREATE INDEX IF NOT EXISTS idx_response_pipe_delivery_trigger_status
  ON ResponsePipeDelivery(triggerId, status, updatedAt DESC);

CREATE INDEX IF NOT EXISTS idx_response_pipe_delivery_queue_item
  ON ResponsePipeDelivery(queueItemId);
`;

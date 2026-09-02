export const migration = `
CREATE TABLE IF NOT EXISTS WorkflowInstance (
  instanceId TEXT PRIMARY KEY NOT NULL,
  workflowId TEXT NOT NULL,
  templateId TEXT,
  templateVersion INTEGER,
  teamId TEXT,
  laneId TEXT,
  status TEXT NOT NULL CHECK(status IN ('created', 'running', 'waiting', 'paused', 'completed', 'failed', 'cancelled')),
  trigger TEXT NOT NULL,
  inputJson TEXT NOT NULL,
  stateJson TEXT NOT NULL,
  currentStepId TEXT,
  latestRunId TEXT,
  pauseRequestedAt INTEGER,
  cancelRequestedAt INTEGER,
  version INTEGER NOT NULL DEFAULT 1,
  leaseOwner TEXT,
  leaseExpiresAt INTEGER,
  errorJson TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workflow_instance_workflow_status_updated
  ON WorkflowInstance(workflowId, status, updatedAt DESC);

CREATE INDEX IF NOT EXISTS idx_workflow_instance_team_status_updated
  ON WorkflowInstance(teamId, status, updatedAt DESC);

CREATE INDEX IF NOT EXISTS idx_workflow_instance_lane_status_updated
  ON WorkflowInstance(laneId, status, updatedAt DESC);

CREATE INDEX IF NOT EXISTS idx_workflow_instance_latest_run
  ON WorkflowInstance(latestRunId);

CREATE INDEX IF NOT EXISTS idx_workflow_instance_recovery
  ON WorkflowInstance(status, leaseExpiresAt, updatedAt);

CREATE TABLE IF NOT EXISTS WorkflowStepState (
  id TEXT PRIMARY KEY NOT NULL,
  instanceId TEXT NOT NULL,
  stepKey TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'waiting', 'blocked', 'completed', 'failed', 'cancelled')),
  attemptCount INTEGER NOT NULL DEFAULT 0,
  lastRunId TEXT,
  blockedReason TEXT,
  waitingTriggerId TEXT,
  inputJson TEXT,
  outputJson TEXT,
  errorJson TEXT,
  startedAt INTEGER,
  completedAt INTEGER,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  FOREIGN KEY(instanceId) REFERENCES WorkflowInstance(instanceId) ON DELETE CASCADE,
  UNIQUE(instanceId, stepKey)
);

CREATE INDEX IF NOT EXISTS idx_workflow_step_instance_key
  ON WorkflowStepState(instanceId, stepKey);

CREATE INDEX IF NOT EXISTS idx_workflow_step_instance_status
  ON WorkflowStepState(instanceId, status, updatedAt DESC);

CREATE INDEX IF NOT EXISTS idx_workflow_step_waiting_trigger
  ON WorkflowStepState(waitingTriggerId);

CREATE TABLE IF NOT EXISTS WorkflowScopedTrigger (
  triggerId TEXT PRIMARY KEY NOT NULL,
  instanceId TEXT NOT NULL,
  stepStateId TEXT,
  stepKey TEXT,
  type TEXT NOT NULL CHECK(type IN ('session_response')),
  status TEXT NOT NULL CHECK(status IN ('active', 'satisfied', 'expired', 'cancelled')),
  roleId TEXT,
  laneId TEXT,
  workspaceId TEXT,
  sessionId TEXT,
  mode TEXT NOT NULL CHECK(mode IN ('exact_execution', 'next_completion_after_cursor')),
  cursorCompletedAt INTEGER,
  cursorExecutionProcessId TEXT,
  sourceExecutionProcessId TEXT,
  expectedQueueItemId TEXT,
  timeoutAt INTEGER,
  satisfiedByExecutionProcessId TEXT,
  satisfiedByJson TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  satisfiedAt INTEGER,
  expiredAt INTEGER,
  cancelledAt INTEGER,
  FOREIGN KEY(instanceId) REFERENCES WorkflowInstance(instanceId) ON DELETE CASCADE,
  FOREIGN KEY(stepStateId) REFERENCES WorkflowStepState(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_workflow_trigger_instance_status
  ON WorkflowScopedTrigger(instanceId, status, updatedAt DESC);

CREATE INDEX IF NOT EXISTS idx_workflow_trigger_active_session
  ON WorkflowScopedTrigger(status, workspaceId, sessionId, cursorCompletedAt, cursorExecutionProcessId);

CREATE INDEX IF NOT EXISTS idx_workflow_trigger_expected_queue_item
  ON WorkflowScopedTrigger(expectedQueueItemId);

CREATE INDEX IF NOT EXISTS idx_workflow_trigger_source_execution
  ON WorkflowScopedTrigger(sourceExecutionProcessId);

CREATE INDEX IF NOT EXISTS idx_workflow_trigger_timeout
  ON WorkflowScopedTrigger(status, timeoutAt);
`;

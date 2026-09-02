export const migration = `
CREATE TABLE IF NOT EXISTS WorkflowRun (
  runId TEXT PRIMARY KEY NOT NULL,
  workflowId TEXT NOT NULL,
  trigger TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'failed')),
  startedAt INTEGER NOT NULL,
  completedAt INTEGER,
  durationMs INTEGER,
  inputJson TEXT NOT NULL,
  outputJson TEXT,
  errorJson TEXT,
  vkWorkspaceId TEXT,
  vkSessionId TEXT,
  vkQueueItemId TEXT,
  vkExecutionProcessId TEXT,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_workflow_run_workflow_started
  ON WorkflowRun(workflowId, startedAt DESC);

CREATE INDEX IF NOT EXISTS idx_workflow_run_status_started
  ON WorkflowRun(status, startedAt DESC);

CREATE TABLE IF NOT EXISTS WorkflowRunEvent (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  runId TEXT NOT NULL,
  eventIndex INTEGER NOT NULL,
  eventType TEXT NOT NULL CHECK(eventType IN ('run_started', 'step_log', 'truncated', 'run_completed')),
  stepId TEXT,
  level TEXT NOT NULL CHECK(level IN ('debug', 'info', 'warn', 'error')),
  message TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  dataJson TEXT,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(runId) REFERENCES WorkflowRun(runId) ON DELETE CASCADE,
  UNIQUE(runId, eventIndex)
);

CREATE INDEX IF NOT EXISTS idx_workflow_run_event_run_index
  ON WorkflowRunEvent(runId, eventIndex);
`;

export const migration = `
CREATE TABLE IF NOT EXISTS WorkflowMetaRun (
  metaRunId TEXT PRIMARY KEY NOT NULL,
  parentWorkspaceId TEXT NOT NULL,
  laneId TEXT,
  status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'paused', 'blocked', 'completed', 'failed', 'cancelled')),
  currentIndex INTEGER NOT NULL,
  childWorkflowDesignId TEXT,
  title TEXT NOT NULL,
  summary TEXT,
  pauseRequested INTEGER NOT NULL DEFAULT 0,
  blockedReasonJson TEXT,
  resultSummaryJson TEXT NOT NULL,
  provenanceJson TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  startedAt INTEGER,
  completedAt INTEGER
);

CREATE INDEX IF NOT EXISTS idx_workflow_meta_run_workspace_status_updated
  ON WorkflowMetaRun(parentWorkspaceId, status, updatedAt DESC);

CREATE TABLE IF NOT EXISTS WorkflowMetaRunItem (
  itemId TEXT PRIMARY KEY NOT NULL,
  metaRunId TEXT NOT NULL,
  beadId TEXT NOT NULL,
  itemIndex INTEGER NOT NULL,
  title TEXT NOT NULL,
  beadStatus TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'paused', 'completed', 'blocked', 'failed', 'skipped')),
  childRunId TEXT,
  resultJson TEXT,
  noteRef TEXT,
  errorJson TEXT,
  provenanceJson TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  startedAt INTEGER,
  completedAt INTEGER,
  UNIQUE(metaRunId, beadId),
  UNIQUE(metaRunId, itemIndex),
  FOREIGN KEY(metaRunId) REFERENCES WorkflowMetaRun(metaRunId) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_workflow_meta_run_item_run_status_index
  ON WorkflowMetaRunItem(metaRunId, status, itemIndex);

CREATE TABLE IF NOT EXISTS WorkflowMetaRunEvent (
  eventId TEXT PRIMARY KEY NOT NULL,
  metaRunId TEXT NOT NULL,
  itemId TEXT,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  dataJson TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  UNIQUE(metaRunId, kind, itemId, dataJson),
  FOREIGN KEY(metaRunId) REFERENCES WorkflowMetaRun(metaRunId) ON DELETE CASCADE,
  FOREIGN KEY(itemId) REFERENCES WorkflowMetaRunItem(itemId) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_workflow_meta_run_event_run_created
  ON WorkflowMetaRunEvent(metaRunId, createdAt DESC);
`;

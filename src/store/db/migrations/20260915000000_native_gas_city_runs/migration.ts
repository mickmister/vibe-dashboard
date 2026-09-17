export const migration = `
CREATE TABLE WorkflowNativeGasCityRun (
  operationKey TEXT PRIMARY KEY NOT NULL,
  runId TEXT NOT NULL UNIQUE,
  workspaceId TEXT NOT NULL,
  sourceBeadId TEXT NOT NULL,
  requestDigest TEXT NOT NULL,
  bundleDigest TEXT NOT NULL,
  requestJson TEXT NOT NULL,
  allowedActionsJson TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('preparing','materializing','ready','turn_pending','running','completed','blocked')),
  bundleRef TEXT,
  workflowId TEXT,
  rootBeadId TEXT,
  sessionId TEXT,
  queueItemRef TEXT UNIQUE,
  resultRef TEXT,
  noteRef TEXT,
  callbackRef TEXT,
  summary TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 1,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
CREATE INDEX WorkflowNativeGasCityRun_status ON WorkflowNativeGasCityRun(status, updatedAt);
CREATE INDEX WorkflowNativeGasCityRun_workspace ON WorkflowNativeGasCityRun(workspaceId, updatedAt);
`;

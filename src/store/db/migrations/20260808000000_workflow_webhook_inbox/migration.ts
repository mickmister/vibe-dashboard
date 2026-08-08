export const migration = `
CREATE TABLE WorkflowWebhookInbox (
  inboxId TEXT PRIMARY KEY NOT NULL,
  source TEXT NOT NULL,
  deliveryId TEXT,
  dedupeKey TEXT NOT NULL,
  eventType TEXT NOT NULL,
  eventStatus TEXT,
  workspaceId TEXT,
  sessionId TEXT,
  executionProcessId TEXT,
  queueItemId TEXT,
  payloadJson TEXT NOT NULL,
  payloadHash TEXT NOT NULL,
  signatureHeader TEXT,
  timestampHeader TEXT,
  receivedAt INTEGER NOT NULL,
  duplicateOfInboxId TEXT,
  processedAt INTEGER,
  status TEXT NOT NULL,
  errorJson TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  UNIQUE(source, dedupeKey),
  FOREIGN KEY (duplicateOfInboxId) REFERENCES WorkflowWebhookInbox(inboxId) ON DELETE SET NULL
);

CREATE INDEX idx_workflow_webhook_inbox_source_received ON WorkflowWebhookInbox(source, receivedAt DESC);
CREATE INDEX idx_workflow_webhook_inbox_status_received ON WorkflowWebhookInbox(status, receivedAt DESC);
CREATE INDEX idx_workflow_webhook_inbox_execution ON WorkflowWebhookInbox(executionProcessId);
CREATE INDEX idx_workflow_webhook_inbox_session_received ON WorkflowWebhookInbox(workspaceId, sessionId, receivedAt DESC);
`;

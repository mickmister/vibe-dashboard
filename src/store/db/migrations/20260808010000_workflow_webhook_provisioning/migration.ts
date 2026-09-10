export const migration = `
CREATE TABLE IF NOT EXISTS WorkflowWebhookProvisioningState (
  stateKey TEXT PRIMARY KEY NOT NULL,
  secret TEXT NOT NULL,
  vkSubscriptionId TEXT,
  upsertKey TEXT NOT NULL,
  targetUrl TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'provisioned', 'retrying', 'failed')),
  attemptCount INTEGER NOT NULL DEFAULT 0,
  lastAttemptAt INTEGER,
  lastSuccessAt INTEGER,
  lastErrorJson TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_webhook_provisioning_upsert_key
  ON WorkflowWebhookProvisioningState(upsertKey);

CREATE INDEX IF NOT EXISTS idx_workflow_webhook_provisioning_status_updated
  ON WorkflowWebhookProvisioningState(status, updatedAt DESC);
`;

export const migration = `
CREATE TABLE IF NOT EXISTS WorkflowAttentionItem (
  attentionItemId TEXT PRIMARY KEY NOT NULL,
  instanceId TEXT NOT NULL,
  stepStateId TEXT,
  workflowId TEXT NOT NULL,
  teamId TEXT,
  laneId TEXT,
  status TEXT NOT NULL CHECK(status IN ('active', 'resolved', 'cancelled')),
  kind TEXT NOT NULL CHECK(kind IN ('human_turn')),
  title TEXT NOT NULL,
  description TEXT,
  stateId TEXT,
  stepId TEXT NOT NULL,
  stateVisitId TEXT NOT NULL,
  idempotencyKey TEXT NOT NULL UNIQUE,
  presentationUrl TEXT,
  formRef TEXT,
  formSchemaJson TEXT,
  resolutionJson TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  resolvedAt INTEGER,
  cancelledAt INTEGER,
  FOREIGN KEY(instanceId) REFERENCES WorkflowInstance(instanceId) ON DELETE CASCADE,
  FOREIGN KEY(stepStateId) REFERENCES WorkflowStepState(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_workflow_attention_status_updated
  ON WorkflowAttentionItem(status, updatedAt DESC);

CREATE INDEX IF NOT EXISTS idx_workflow_attention_instance_status
  ON WorkflowAttentionItem(instanceId, status, updatedAt DESC);

CREATE INDEX IF NOT EXISTS idx_workflow_attention_team_status
  ON WorkflowAttentionItem(teamId, status, updatedAt DESC);

CREATE INDEX IF NOT EXISTS idx_workflow_attention_lane_status
  ON WorkflowAttentionItem(laneId, status, updatedAt DESC);
`;

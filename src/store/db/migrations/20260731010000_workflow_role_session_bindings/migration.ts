export const migration = `
CREATE TABLE IF NOT EXISTS WorkflowRoleSessionBinding (
  bindingId TEXT PRIMARY KEY NOT NULL,
  teamId TEXT,
  workflowId TEXT,
  instanceId TEXT,
  laneId TEXT,
  roleId TEXT NOT NULL,
  roleName TEXT NOT NULL,
  workspaceId TEXT NOT NULL,
  sessionId TEXT NOT NULL,
  executor TEXT,
  source TEXT NOT NULL CHECK(source IN ('user_selected', 'auto_reused', 'auto_created', 'team_config', 'imported')),
  valid INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workflow_role_binding_workspace_lane_role
  ON WorkflowRoleSessionBinding(workspaceId, laneId, roleId, valid, updatedAt DESC);

CREATE INDEX IF NOT EXISTS idx_workflow_role_binding_team_lane_role
  ON WorkflowRoleSessionBinding(teamId, laneId, roleId, valid, updatedAt DESC);

CREATE INDEX IF NOT EXISTS idx_workflow_role_binding_instance
  ON WorkflowRoleSessionBinding(instanceId, roleId);

CREATE INDEX IF NOT EXISTS idx_workflow_role_binding_session
  ON WorkflowRoleSessionBinding(sessionId, valid);
`;

export const migration = `
CREATE TABLE IF NOT EXISTS WorkflowWorkArea (
  workAreaId TEXT PRIMARY KEY NOT NULL,
  workspaceId TEXT NOT NULL,
  lineageKey TEXT NOT NULL,
  ownerRunId TEXT NOT NULL,
  layoutDigest TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('reserved', 'provisioning', 'ready', 'blocked', 'retained', 'released')),
  generation INTEGER NOT NULL,
  reservedBytes INTEGER NOT NULL CHECK(reservedBytes >= 0),
  retainReason TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  UNIQUE(workspaceId, lineageKey)
);

CREATE INDEX IF NOT EXISTS idx_workflow_work_area_workspace_status
  ON WorkflowWorkArea(workspaceId, status, updatedAt DESC);

CREATE TABLE IF NOT EXISTS WorkflowWorkAreaRepository (
  workAreaId TEXT NOT NULL,
  repoKey TEXT NOT NULL,
  sourceRevision TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('reserved', 'creating', 'ready', 'blocked', 'retained')),
  generation INTEGER NOT NULL,
  dirty INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 0,
  uniqueWork INTEGER NOT NULL DEFAULT 0,
  retainReason TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  PRIMARY KEY(workAreaId, repoKey),
  FOREIGN KEY(workAreaId) REFERENCES WorkflowWorkArea(workAreaId) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS WorkflowWorkAreaOperation (
  operationId TEXT PRIMARY KEY NOT NULL,
  operationKey TEXT NOT NULL UNIQUE,
  requestDigest TEXT NOT NULL,
  workAreaId TEXT NOT NULL,
  actorId TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('preflight', 'create_or_reuse', 'reconcile')),
  status TEXT NOT NULL CHECK(status IN ('preparing', 'completed', 'blocked')),
  message TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  FOREIGN KEY(workAreaId) REFERENCES WorkflowWorkArea(workAreaId) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_workflow_work_area_operation_area
  ON WorkflowWorkAreaOperation(workAreaId, updatedAt DESC);

CREATE TABLE IF NOT EXISTS WorkflowWorkAreaAuditEvent (
  auditId TEXT PRIMARY KEY NOT NULL,
  workAreaId TEXT NOT NULL,
  workspaceId TEXT NOT NULL,
  operationId TEXT,
  actorId TEXT NOT NULL,
  eventType TEXT NOT NULL,
  message TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  FOREIGN KEY(workAreaId) REFERENCES WorkflowWorkArea(workAreaId) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_workflow_work_area_audit_area
  ON WorkflowWorkAreaAuditEvent(workAreaId, createdAt DESC);
`;

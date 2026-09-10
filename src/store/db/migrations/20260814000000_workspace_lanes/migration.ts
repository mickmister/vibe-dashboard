export const migration = `
CREATE TABLE IF NOT EXISTS WorkspaceLane (
  laneId TEXT PRIMARY KEY NOT NULL,
  parentWorkspaceId TEXT NOT NULL,
  name TEXT NOT NULL,
  purpose TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('planned', 'ready', 'active', 'paused', 'blocked', 'completed', 'archived')),
  sourceBranch TEXT NOT NULL,
  workingBranch TEXT,
  worktreePath TEXT,
  worktreeStatus TEXT NOT NULL CHECK(worktreeStatus IN ('pending', 'clean', 'dirty', 'unknown')),
  worktreeSummaryJson TEXT,
  createdByJson TEXT NOT NULL,
  cleanupPolicyJson TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  archivedAt INTEGER,
  lastActiveRunId TEXT,
  UNIQUE(parentWorkspaceId, name)
);

CREATE INDEX IF NOT EXISTS idx_workspace_lane_parent_status_updated
  ON WorkspaceLane(parentWorkspaceId, status, updatedAt DESC);

CREATE TABLE IF NOT EXISTS WorkspaceLaneBinding (
  bindingId TEXT PRIMARY KEY NOT NULL,
  laneId TEXT NOT NULL,
  parentWorkspaceId TEXT NOT NULL,
  bindingType TEXT NOT NULL CHECK(bindingType IN ('workflow_run', 'workflow_instance', 'bead', 'milestone')),
  bindingKey TEXT NOT NULL,
  reason TEXT,
  accessMode TEXT NOT NULL CHECK(accessMode IN ('read', 'write')),
  roleBindingsJson TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  UNIQUE(bindingType, bindingKey),
  FOREIGN KEY(laneId) REFERENCES WorkspaceLane(laneId) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_workspace_lane_binding_lane_type
  ON WorkspaceLaneBinding(laneId, bindingType, updatedAt DESC);

CREATE INDEX IF NOT EXISTS idx_workspace_lane_binding_parent
  ON WorkspaceLaneBinding(parentWorkspaceId, updatedAt DESC);

CREATE TABLE IF NOT EXISTS WorkspaceLaneCapacityLease (
  leaseId TEXT PRIMARY KEY NOT NULL,
  laneId TEXT NOT NULL,
  parentWorkspaceId TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('write')),
  ownerId TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active', 'released', 'stale', 'reclaimed')),
  acquiredAt INTEGER NOT NULL,
  expiresAt INTEGER,
  releasedAt INTEGER,
  releaseReason TEXT,
  recoveryReason TEXT,
  metadataJson TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  FOREIGN KEY(laneId) REFERENCES WorkspaceLane(laneId) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_workspace_lane_capacity_active
  ON WorkspaceLaneCapacityLease(laneId, mode, status, expiresAt);

CREATE TABLE IF NOT EXISTS WorkspaceLaneAuditEvent (
  auditId TEXT PRIMARY KEY NOT NULL,
  laneId TEXT NOT NULL,
  parentWorkspaceId TEXT NOT NULL,
  eventType TEXT NOT NULL,
  actorId TEXT,
  message TEXT NOT NULL,
  dataJson TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  FOREIGN KEY(laneId) REFERENCES WorkspaceLane(laneId) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_workspace_lane_audit_lane_created
  ON WorkspaceLaneAuditEvent(laneId, createdAt DESC);
`;

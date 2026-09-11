export const migration = `
ALTER TABLE WorkflowWorkAreaRepository ADD COLUMN sourceIdentity TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS WorkflowWorkAreaOperationLease (
  leaseKey TEXT PRIMARY KEY NOT NULL,
  workAreaId TEXT NOT NULL,
  repoKey TEXT NOT NULL,
  operationId TEXT NOT NULL,
  requestDigest TEXT NOT NULL,
  holderId TEXT NOT NULL,
  fence INTEGER NOT NULL CHECK(fence > 0),
  status TEXT NOT NULL CHECK(status IN ('active', 'released')),
  expiresAt INTEGER NOT NULL,
  heartbeatAt INTEGER NOT NULL,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  FOREIGN KEY(workAreaId) REFERENCES WorkflowWorkArea(workAreaId) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_workflow_work_area_lease_area_status
  ON WorkflowWorkAreaOperationLease(workAreaId, status, expiresAt);
`;

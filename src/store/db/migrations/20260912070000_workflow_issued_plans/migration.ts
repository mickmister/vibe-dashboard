export const migration = `
CREATE TABLE WorkflowIssuedPlan (
  planId TEXT PRIMARY KEY,
  digest TEXT NOT NULL,
  principalId TEXT NOT NULL,
  workspaceId TEXT NOT NULL,
  callerSessionId TEXT,
  requestDigest TEXT NOT NULL,
  requestJson TEXT NOT NULL,
  planJson TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('issued','launched','revoked','expired')),
  expiresAt INTEGER NOT NULL,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  UNIQUE(principalId, workspaceId, digest)
);
CREATE INDEX WorkflowIssuedPlan_lookup ON WorkflowIssuedPlan(digest, principalId, workspaceId);

CREATE TABLE WorkflowPlanLaunchEffect (
  operationKey TEXT PRIMARY KEY,
  planId TEXT NOT NULL,
  requestDigest TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','launched','failed')),
  leaseOwner TEXT,
  leaseExpiresAt INTEGER,
  fence INTEGER NOT NULL DEFAULT 1,
  resultJson TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  FOREIGN KEY(planId) REFERENCES WorkflowIssuedPlan(planId)
);

CREATE TABLE WorkflowPlanAuditEvent (
  auditId TEXT PRIMARY KEY,
  planId TEXT NOT NULL,
  principalId TEXT NOT NULL,
  action TEXT NOT NULL,
  summary TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  FOREIGN KEY(planId) REFERENCES WorkflowIssuedPlan(planId)
);
`;

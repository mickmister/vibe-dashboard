export const migration = `
ALTER TABLE WorkflowNativeGasCityRun ADD COLUMN definitionJson TEXT NOT NULL DEFAULT '{}';
CREATE TABLE WorkflowNativeGasCityEffect (
  runId TEXT NOT NULL,
  kind TEXT NOT NULL,
  requestDigest TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','completed','blocked')),
  leaseOwner TEXT,
  leaseExpiresAt INTEGER,
  fence INTEGER NOT NULL DEFAULT 1,
  resultJson TEXT,
  lastError TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  PRIMARY KEY (runId, kind),
  FOREIGN KEY (runId) REFERENCES WorkflowNativeGasCityRun(runId) ON DELETE CASCADE
);
CREATE INDEX WorkflowNativeGasCityEffect_recovery ON WorkflowNativeGasCityEffect(status, leaseExpiresAt);
`;

CREATE TABLE IF NOT EXISTS "GithubIssueWorkspaceReservation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "issueKey" TEXT NOT NULL,
  "owner" TEXT NOT NULL,
  "repo" TEXT NOT NULL,
  "issueNumber" INTEGER NOT NULL,
  "issueUrl" TEXT NOT NULL,
  "state" TEXT NOT NULL CHECK ("state" IN ('provisioning', 'ready', 'recoverable', 'failed', 'manual_recovery')),
  "requestJson" TEXT NOT NULL,
  "workspaceId" TEXT,
  "branch" TEXT,
  "leaseToken" TEXT,
  "leaseExpiresAt" DATETIME,
  "lastError" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "GithubIssueWorkspaceReservation_issueKey_key"
  ON "GithubIssueWorkspaceReservation"("issueKey");
CREATE INDEX IF NOT EXISTS "GithubIssueWorkspaceReservation_state_idx"
  ON "GithubIssueWorkspaceReservation"("state");

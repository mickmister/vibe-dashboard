CREATE TABLE IF NOT EXISTS "GithubIssueWorkspaceReservation_rebuild" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "issueKey" TEXT NOT NULL,
  "owner" TEXT NOT NULL,
  "repo" TEXT NOT NULL,
  "issueNumber" INTEGER NOT NULL,
  "issueUrl" TEXT NOT NULL,
  "state" TEXT NOT NULL CHECK ("state" IN ('provisioning', 'external_create_started', 'ready', 'recoverable', 'failed', 'manual_recovery')),
  "requestJson" TEXT NOT NULL,
  "workspaceId" TEXT,
  "branch" TEXT,
  "leaseToken" TEXT,
  "leaseExpiresAt" DATETIME,
  "lastError" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO "GithubIssueWorkspaceReservation_rebuild" (
  "id",
  "issueKey",
  "owner",
  "repo",
  "issueNumber",
  "issueUrl",
  "state",
  "requestJson",
  "workspaceId",
  "branch",
  "leaseToken",
  "leaseExpiresAt",
  "lastError",
  "createdAt",
  "updatedAt"
)
SELECT
  "id",
  "issueKey",
  "owner",
  "repo",
  "issueNumber",
  "issueUrl",
  "state",
  "requestJson",
  "workspaceId",
  "branch",
  "leaseToken",
  "leaseExpiresAt",
  "lastError",
  "createdAt",
  "updatedAt"
FROM "GithubIssueWorkspaceReservation";

DROP TABLE "GithubIssueWorkspaceReservation";
ALTER TABLE "GithubIssueWorkspaceReservation_rebuild" RENAME TO "GithubIssueWorkspaceReservation";

CREATE UNIQUE INDEX IF NOT EXISTS "GithubIssueWorkspaceReservation_issueKey_key"
  ON "GithubIssueWorkspaceReservation"("issueKey");
CREATE INDEX IF NOT EXISTS "GithubIssueWorkspaceReservation_state_idx"
  ON "GithubIssueWorkspaceReservation"("state");

UPDATE "ExternalIssueWorkspaceLink"
SET "isPrimary" = 0,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "isPrimary" = 1
  AND EXISTS (
    SELECT 1
    FROM "ExternalIssueWorkspaceLink" AS "winner"
    WHERE "winner"."externalIssueId" = "ExternalIssueWorkspaceLink"."externalIssueId"
      AND "winner"."isPrimary" = 1
      AND (
        COALESCE("winner"."lastOpenedAt", "winner"."updatedAt", "winner"."createdAt", '') > COALESCE("ExternalIssueWorkspaceLink"."lastOpenedAt", "ExternalIssueWorkspaceLink"."updatedAt", "ExternalIssueWorkspaceLink"."createdAt", '')
        OR (
          COALESCE("winner"."lastOpenedAt", "winner"."updatedAt", "winner"."createdAt", '') = COALESCE("ExternalIssueWorkspaceLink"."lastOpenedAt", "ExternalIssueWorkspaceLink"."updatedAt", "ExternalIssueWorkspaceLink"."createdAt", '')
          AND "winner"."id" > "ExternalIssueWorkspaceLink"."id"
        )
      )
  );

CREATE UNIQUE INDEX IF NOT EXISTS "ExternalIssueWorkspaceLink_onePrimaryPerIssue_key"
  ON "ExternalIssueWorkspaceLink"("externalIssueId")
  WHERE "isPrimary" = 1;

CREATE TABLE IF NOT EXISTS "ExternalIssue" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "provider" TEXT NOT NULL CHECK ("provider" IN ('jira', 'github', 'linear')),
  "issueKey" TEXT NOT NULL,
  "issueId" TEXT,
  "issueUrl" TEXT NOT NULL,
  "site" TEXT,
  "metadataJson" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "ExternalIssue_provider_site_issueKey_key" ON "ExternalIssue"("provider", "site", "issueKey");
CREATE INDEX IF NOT EXISTS "ExternalIssue_provider_issueKey_idx" ON "ExternalIssue"("provider", "issueKey");
CREATE INDEX IF NOT EXISTS "ExternalIssue_issueId_idx" ON "ExternalIssue"("issueId");

CREATE TABLE IF NOT EXISTS "VKWorkspace" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "workspaceDir" TEXT,
  "displayName" TEXT,
  "metadataJson" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "VKWorkspace_workspaceId_key" ON "VKWorkspace"("workspaceId");
CREATE INDEX IF NOT EXISTS "VKWorkspace_workspaceDir_idx" ON "VKWorkspace"("workspaceDir");

CREATE TABLE IF NOT EXISTS "ExternalIssueWorkspaceLink" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "externalIssueId" TEXT NOT NULL,
  "vkWorkspaceId" TEXT NOT NULL,
  "isPrimary" INTEGER NOT NULL DEFAULT 0,
  "lastOpenedAt" DATETIME,
  "metadataJson" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExternalIssueWorkspaceLink_externalIssueId_fkey" FOREIGN KEY ("externalIssueId") REFERENCES "ExternalIssue" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ExternalIssueWorkspaceLink_vkWorkspaceId_fkey" FOREIGN KEY ("vkWorkspaceId") REFERENCES "VKWorkspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "ExternalIssueWorkspaceLink_externalIssueId_vkWorkspaceId_key" ON "ExternalIssueWorkspaceLink"("externalIssueId", "vkWorkspaceId");
CREATE INDEX IF NOT EXISTS "ExternalIssueWorkspaceLink_externalIssueId_idx" ON "ExternalIssueWorkspaceLink"("externalIssueId");
CREATE INDEX IF NOT EXISTS "ExternalIssueWorkspaceLink_vkWorkspaceId_idx" ON "ExternalIssueWorkspaceLink"("vkWorkspaceId");
CREATE INDEX IF NOT EXISTS "ExternalIssueWorkspaceLink_isPrimary_idx" ON "ExternalIssueWorkspaceLink"("isPrimary");

CREATE TABLE IF NOT EXISTS "ExternalRepoProjectMapping" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "repoId" TEXT NOT NULL,
  "repoName" TEXT,
  "provider" TEXT NOT NULL CHECK ("provider" IN ('jira', 'github', 'linear')),
  "siteHostname" TEXT NOT NULL,
  "projectKey" TEXT NOT NULL,
  "issueTypeName" TEXT,
  "metadataJson" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "ExternalRepoProjectMapping_repoId_provider_siteHostname_key" ON "ExternalRepoProjectMapping"("repoId", "provider", "siteHostname");
CREATE INDEX IF NOT EXISTS "ExternalRepoProjectMapping_provider_site_project_idx" ON "ExternalRepoProjectMapping"("provider", "siteHostname", "projectKey");

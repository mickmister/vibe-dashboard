CREATE TABLE IF NOT EXISTS "ExternalKanbanProvider" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "displayName" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "capabilitiesJson" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "ExternalKanbanProvider_kind_idx" ON "ExternalKanbanProvider"("kind");

INSERT OR IGNORE INTO "ExternalKanbanProvider" ("id", "displayName", "kind", "capabilitiesJson") VALUES
  ('beads', 'Beads', 'internal', '{"viewModes":["board","list","issue"],"readOnly":true}'),
  ('github', 'GitHub', 'external', '{"viewModes":["board","list","issue"],"readOnly":true}'),
  ('jira', 'Jira', 'external', '{"viewModes":["board","list","issue"],"readOnly":true}'),
  ('linear', 'Linear', 'external', '{"viewModes":["board","list","issue"],"readOnly":true}');

CREATE TABLE IF NOT EXISTS "ExternalKanbanSavedView" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "providerId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "scopeType" TEXT NOT NULL,
  "sourceDirectory" TEXT,
  "repoId" TEXT,
  "repoName" TEXT,
  "viewMode" TEXT NOT NULL,
  "filterRulesJson" TEXT NOT NULL,
  "columnRulesJson" TEXT NOT NULL,
  "swimlaneRulesJson" TEXT,
  "settingsJson" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExternalKanbanSavedView_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ExternalKanbanProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "ExternalKanbanSavedView_providerId_idx" ON "ExternalKanbanSavedView"("providerId");
CREATE INDEX IF NOT EXISTS "ExternalKanbanSavedView_scopeType_repoId_idx" ON "ExternalKanbanSavedView"("scopeType", "repoId");
CREATE INDEX IF NOT EXISTS "ExternalKanbanSavedView_sourceDirectory_idx" ON "ExternalKanbanSavedView"("sourceDirectory");

CREATE TABLE IF NOT EXISTS "BeadWorkspaceLink" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "beadId" TEXT NOT NULL,
  "sourceDirectory" TEXT NOT NULL,
  "repoId" TEXT,
  "workspaceId" TEXT NOT NULL,
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "linkSource" TEXT NOT NULL,
  "metadataJson" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "BeadWorkspaceLink_sourceDirectory_beadId_workspaceId_key" ON "BeadWorkspaceLink"("sourceDirectory", "beadId", "workspaceId");
CREATE INDEX IF NOT EXISTS "BeadWorkspaceLink_sourceDirectory_beadId_idx" ON "BeadWorkspaceLink"("sourceDirectory", "beadId");
CREATE INDEX IF NOT EXISTS "BeadWorkspaceLink_workspaceId_idx" ON "BeadWorkspaceLink"("workspaceId");
CREATE INDEX IF NOT EXISTS "BeadWorkspaceLink_repoId_idx" ON "BeadWorkspaceLink"("repoId");

CREATE TABLE "Voyage" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "schemaVersion" INTEGER NOT NULL DEFAULT 1 CHECK ("schemaVersion" > 0),
  "revision" INTEGER NOT NULL DEFAULT 0 CHECK ("revision" >= 0),
  "activationSequence" INTEGER NOT NULL DEFAULT 0 CHECK ("activationSequence" >= 0),
  "historyCursorSequence" INTEGER CHECK ("historyCursorSequence" IS NULL OR "historyCursorSequence" >= 0),
  "name" TEXT NOT NULL,
  "mission" TEXT,
  "lifecycleState" TEXT NOT NULL DEFAULT 'active' CHECK ("lifecycleState" IN ('active', 'archived')),
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastOpenedAt" DATETIME
);

CREATE TABLE "VoyageCraft" (
  "voyageId" TEXT NOT NULL,
  "craftWorkspaceId" TEXT NOT NULL,
  "sortKey" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("voyageId", "craftWorkspaceId"),
  CONSTRAINT "VoyageCraft_voyageId_fkey" FOREIGN KEY ("voyageId") REFERENCES "Voyage" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "VoyagePanel" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "voyageId" TEXT NOT NULL,
  "craftWorkspaceId" TEXT,
  "targetKind" TEXT NOT NULL,
  "targetVersion" INTEGER NOT NULL CHECK ("targetVersion" > 0),
  "targetPayloadJson" TEXT NOT NULL,
  "titleMode" TEXT NOT NULL,
  "customTitle" TEXT,
  "closePolicy" TEXT NOT NULL,
  "lastActivatedSequence" INTEGER CHECK ("lastActivatedSequence" IS NULL OR "lastActivatedSequence" >= 0),
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VoyagePanel_voyageId_fkey" FOREIGN KEY ("voyageId") REFERENCES "Voyage" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "VoyagePanel_membership_fkey" FOREIGN KEY ("voyageId", "craftWorkspaceId") REFERENCES "VoyageCraft" ("voyageId", "craftWorkspaceId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "VoyagePanel_voyageId_idx" ON "VoyagePanel"("voyageId");
CREATE INDEX "VoyagePanel_voyageId_craftWorkspaceId_idx" ON "VoyagePanel"("voyageId", "craftWorkspaceId");

CREATE TABLE "VoyageLayout" (
  "voyageId" TEXT NOT NULL PRIMARY KEY,
  "formatVersion" INTEGER NOT NULL CHECK ("formatVersion" > 0),
  "dockviewVersion" TEXT NOT NULL,
  "aggregateRevision" INTEGER NOT NULL CHECK ("aggregateRevision" >= 0),
  "snapshotJson" TEXT NOT NULL,
  "snapshotHash" TEXT NOT NULL,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VoyageLayout_voyageId_fkey" FOREIGN KEY ("voyageId") REFERENCES "Voyage" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "VoyageHistory" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "voyageId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL CHECK ("sequence" >= 0),
  "aggregateRevision" INTEGER NOT NULL CHECK ("aggregateRevision" >= 0),
  "panelsJson" TEXT NOT NULL,
  "snapshotJson" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VoyageHistory_voyageId_fkey" FOREIGN KEY ("voyageId") REFERENCES "Voyage" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "VoyageHistory_voyageId_sequence_key" ON "VoyageHistory"("voyageId", "sequence");
CREATE INDEX "VoyageHistory_voyageId_idx" ON "VoyageHistory"("voyageId");

CREATE TABLE "VoyageLayoutQuarantine" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "voyageId" TEXT NOT NULL,
  "sourceRevision" INTEGER NOT NULL CHECK ("sourceRevision" >= 0),
  "reasonCode" TEXT NOT NULL,
  "rejectedSnapshotJson" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" DATETIME,
  CONSTRAINT "VoyageLayoutQuarantine_voyageId_fkey" FOREIGN KEY ("voyageId") REFERENCES "Voyage" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "VoyageLayoutQuarantine_voyageId_idx" ON "VoyageLayoutQuarantine"("voyageId");

CREATE TABLE "VoyageSettings" (
  "singletonKey" TEXT NOT NULL PRIMARY KEY DEFAULT 'installation' CHECK ("singletonKey" = 'installation'),
  "warmVoyageLimit" INTEGER NOT NULL DEFAULT 2 CHECK ("warmVoyageLimit" >= 0),
  "iframeRuntimeLimit" INTEGER NOT NULL DEFAULT 5 CHECK ("iframeRuntimeLimit" >= 0),
  "historyLimit" INTEGER NOT NULL DEFAULT 50 CHECK ("historyLimit" >= 0),
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "VoyageMigrationDiagnostic" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "migrationName" TEXT NOT NULL,
  "voyageId" TEXT,
  "sourceKind" TEXT NOT NULL,
  "sourceId" TEXT,
  "outcome" TEXT NOT NULL CHECK ("outcome" IN ('migrated', 'skipped', 'quarantined')),
  "reasonCode" TEXT NOT NULL,
  "detailsJson" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VoyageMigrationDiagnostic_voyageId_fkey" FOREIGN KEY ("voyageId") REFERENCES "Voyage" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "VoyageMigrationDiagnostic_migrationName_idx" ON "VoyageMigrationDiagnostic"("migrationName");
CREATE INDEX "VoyageMigrationDiagnostic_voyageId_idx" ON "VoyageMigrationDiagnostic"("voyageId");

CREATE TRIGGER "VoyagePanel_activation_insert"
BEFORE INSERT ON "VoyagePanel"
WHEN NEW."lastActivatedSequence" IS NOT NULL
  AND NEW."lastActivatedSequence" > (SELECT "activationSequence" FROM "Voyage" WHERE "id" = NEW."voyageId")
BEGIN
  SELECT RAISE(ABORT, 'panel activation sequence exceeds voyage counter');
END;

CREATE TRIGGER "VoyagePanel_activation_update"
BEFORE UPDATE OF "lastActivatedSequence", "voyageId" ON "VoyagePanel"
WHEN NEW."lastActivatedSequence" IS NOT NULL
  AND NEW."lastActivatedSequence" > (SELECT "activationSequence" FROM "Voyage" WHERE "id" = NEW."voyageId")
BEGIN
  SELECT RAISE(ABORT, 'panel activation sequence exceeds voyage counter');
END;

CREATE TRIGGER "Voyage_activation_counter_update"
BEFORE UPDATE OF "activationSequence" ON "Voyage"
WHEN NEW."activationSequence" < OLD."activationSequence"
  OR EXISTS (SELECT 1 FROM "VoyagePanel" WHERE "voyageId" = OLD."id" AND "lastActivatedSequence" > NEW."activationSequence")
BEGIN
  SELECT RAISE(ABORT, 'voyage activation sequence cannot rewind');
END;

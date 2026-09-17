export const migration = `
CREATE TABLE IF NOT EXISTS WorkflowDesign (
  designId TEXT PRIMARY KEY NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('built_in', 'user', 'plugin')),
  name TEXT NOT NULL,
  description TEXT,
  currentDraftId TEXT,
  latestPublishedVersion INTEGER,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS WorkflowDesignDraft (
  draftId TEXT PRIMARY KEY NOT NULL,
  designId TEXT NOT NULL,
  baseVersion INTEGER,
  definitionJson TEXT NOT NULL,
  validationStatus TEXT NOT NULL CHECK(validationStatus IN ('unknown', 'valid', 'invalid')),
  validationIssuesJson TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  FOREIGN KEY(designId) REFERENCES WorkflowDesign(designId) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_workflow_design_draft_design_updated
  ON WorkflowDesignDraft(designId, updatedAt DESC);

CREATE TABLE IF NOT EXISTS WorkflowDesignVersion (
  designId TEXT NOT NULL,
  version INTEGER NOT NULL,
  sourceDraftId TEXT,
  definitionJson TEXT NOT NULL,
  resolvedDefinitionJson TEXT NOT NULL,
  resolvedPromptSnapshotJson TEXT NOT NULL,
  definitionHash TEXT NOT NULL,
  publishedAt INTEGER NOT NULL,
  createdAt INTEGER NOT NULL,
  PRIMARY KEY(designId, version),
  FOREIGN KEY(designId) REFERENCES WorkflowDesign(designId) ON DELETE CASCADE,
  FOREIGN KEY(sourceDraftId) REFERENCES WorkflowDesignDraft(draftId) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS WorkflowPromptAsset (
  promptAssetId TEXT NOT NULL,
  version INTEGER NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('built_in', 'user', 'plugin')),
  name TEXT NOT NULL,
  description TEXT,
  bodyMarkdown TEXT NOT NULL,
  inputSchemaJson TEXT,
  contentHash TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  PRIMARY KEY(promptAssetId, version)
);

CREATE TABLE IF NOT EXISTS WorkflowSkillAsset (
  skillAssetId TEXT NOT NULL,
  version INTEGER NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('built_in', 'user', 'plugin')),
  name TEXT NOT NULL,
  description TEXT,
  bodyMarkdown TEXT NOT NULL,
  contentHash TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  PRIMARY KEY(skillAssetId, version)
);

CREATE TABLE IF NOT EXISTS WorkflowDesignRunSnapshot (
  runSnapshotId TEXT PRIMARY KEY NOT NULL,
  designId TEXT NOT NULL,
  designVersion INTEGER NOT NULL,
  workspaceId TEXT NOT NULL,
  runInputJson TEXT NOT NULL,
  roleBindingsJson TEXT NOT NULL,
  additionalInstructions TEXT,
  resolvedDefinitionJson TEXT NOT NULL,
  resolvedPromptSnapshotJson TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  FOREIGN KEY(designId, designVersion) REFERENCES WorkflowDesignVersion(designId, version) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_workflow_design_run_snapshot_workspace_created
  ON WorkflowDesignRunSnapshot(workspaceId, createdAt DESC);
`;

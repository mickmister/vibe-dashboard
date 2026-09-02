export const migration = `
CREATE TABLE IF NOT EXISTS DeclarativeWorkflowDefinition (
  definitionId TEXT NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active', 'disabled')),
  name TEXT NOT NULL,
  description TEXT,
  trigger TEXT NOT NULL,
  definitionJson TEXT NOT NULL,
  definitionHash TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  activatedAt INTEGER,
  disabledAt INTEGER,
  PRIMARY KEY(definitionId, version)
);

CREATE INDEX IF NOT EXISTS idx_declarative_workflow_definition_status_updated
  ON DeclarativeWorkflowDefinition(status, updatedAt DESC);

CREATE INDEX IF NOT EXISTS idx_declarative_workflow_definition_id_status_version
  ON DeclarativeWorkflowDefinition(definitionId, status, version DESC);
`;

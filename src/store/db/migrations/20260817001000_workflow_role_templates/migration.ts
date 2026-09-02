export const migration = `
CREATE TABLE IF NOT EXISTS WorkflowRoleTemplate (
  roleTemplateId TEXT NOT NULL,
  version INTEGER NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('built_in', 'user', 'plugin')),
  name TEXT NOT NULL,
  description TEXT,
  promptMarkdown TEXT NOT NULL,
  skillRefsJson TEXT NOT NULL,
  executorPreferenceJson TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  contentHash TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  PRIMARY KEY(roleTemplateId, version)
);
`;

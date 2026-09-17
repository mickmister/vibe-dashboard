export const migration = `
CREATE TABLE WorkflowWorkAreaRegistryIdentity (
  singletonKey TEXT PRIMARY KEY NOT NULL,
  registryId TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK(kind IN ('production', 'development')),
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
`;

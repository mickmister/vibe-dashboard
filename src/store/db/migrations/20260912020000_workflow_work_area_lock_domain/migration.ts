export const migration = `
CREATE TABLE WorkflowWorkAreaLockDomain (
  singletonKey TEXT PRIMARY KEY NOT NULL,
  lockDomainId TEXT NOT NULL,
  domainDigest TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
`;

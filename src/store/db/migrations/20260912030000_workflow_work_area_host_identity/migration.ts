export const migration = `
ALTER TABLE WorkflowWorkAreaLockDomain ADD COLUMN deploymentMode TEXT;
ALTER TABLE WorkflowWorkAreaLockDomain ADD COLUMN hostIdentityDigest TEXT;
`;

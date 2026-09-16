export const migration = `
ALTER TABLE WorkflowNativeGasCityRun ADD COLUMN roleTurnSchemaVersion TEXT;
ALTER TABLE WorkflowNativeGasCityRun ADD COLUMN roleTurnRequestJson TEXT;
ALTER TABLE WorkflowNativeGasCityRun ADD COLUMN roleTurnRequestDigest TEXT;
`;

export const migration = `
ALTER TABLE WorkflowWorkAreaRegistryAdoptionAudit ADD COLUMN capabilityId TEXT;
ALTER TABLE WorkflowWorkAreaRegistryAdoptionAudit ADD COLUMN capabilityGeneration INTEGER;
`;

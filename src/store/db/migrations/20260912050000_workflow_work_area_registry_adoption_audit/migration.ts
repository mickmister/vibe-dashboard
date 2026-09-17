export const migration = `
CREATE TABLE WorkflowWorkAreaRegistryAdoptionAudit (
  adoptionKey TEXT PRIMARY KEY NOT NULL,
  requestDigest TEXT NOT NULL,
  registryId TEXT NOT NULL,
  actorId TEXT NOT NULL,
  eventType TEXT NOT NULL CHECK(eventType = 'legacy_production_registry_adopted'),
  createdAt INTEGER NOT NULL
);
`;

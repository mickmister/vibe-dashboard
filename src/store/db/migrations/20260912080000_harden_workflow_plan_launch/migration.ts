export const migration = `
ALTER TABLE WorkflowPlanLaunchEffect ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE WorkflowPlanLaunchEffect ADD COLUMN lastError TEXT;
CREATE INDEX WorkflowPlanLaunchEffect_recovery ON WorkflowPlanLaunchEffect(status, leaseExpiresAt);
`;

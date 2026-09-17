export const migration = `
ALTER TABLE WorkflowMetaRun ADD COLUMN childRoleBindingsJson TEXT NOT NULL DEFAULT '{}';
ALTER TABLE WorkflowMetaRun ADD COLUMN childWorkflowDesignVersion INTEGER;
`;

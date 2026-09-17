export interface WorkflowFeatureEnv {
  [key: string]: string | undefined;
  VD_WORKFLOWS_ENABLED?: string;
  VITE_VD_WORKFLOWS_ENABLED?: string;
  VD_WORKFLOW_E2E_FIXTURES_ENABLED?: string;
  VITE_VD_WORKFLOW_E2E_FIXTURES_ENABLED?: string;
}

export function areWorkflowFeaturesEnabled(env: WorkflowFeatureEnv = readWorkflowFeatureEnv()): boolean {
  return isTruthy(env.VD_WORKFLOWS_ENABLED) || isTruthy(env.VITE_VD_WORKFLOWS_ENABLED);
}

export function areWorkflowE2eFixturesEnabled(env: WorkflowFeatureEnv = readWorkflowFeatureEnv()): boolean {
  if (!areWorkflowFeaturesEnabled(env)) return false;
  return isTruthy(env.VD_WORKFLOW_E2E_FIXTURES_ENABLED) || isTruthy(env.VITE_VD_WORKFLOW_E2E_FIXTURES_ENABLED);
}

export function isTruthy(value: string | undefined | null): boolean {
  if (!value) return false;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function readWorkflowFeatureEnv(): WorkflowFeatureEnv {
  const processEnv = typeof process !== 'undefined' ? process.env : undefined;
  const importMetaEnv = (import.meta as ImportMeta & { env?: WorkflowFeatureEnv }).env;
  return {
    VD_WORKFLOWS_ENABLED: processEnv?.VD_WORKFLOWS_ENABLED,
    VITE_VD_WORKFLOWS_ENABLED: importMetaEnv?.VITE_VD_WORKFLOWS_ENABLED,
    VD_WORKFLOW_E2E_FIXTURES_ENABLED: processEnv?.VD_WORKFLOW_E2E_FIXTURES_ENABLED,
    VITE_VD_WORKFLOW_E2E_FIXTURES_ENABLED: importMetaEnv?.VITE_VD_WORKFLOW_E2E_FIXTURES_ENABLED,
  };
}

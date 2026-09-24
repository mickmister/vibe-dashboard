import type { DiscoveredInstalledPlugin } from './installer';
import type { EffectivePluginGrants } from './manifest';

export type PluginRuntimeEnvironment = 'staging' | 'production';
export type StagingStatus = 'staged' | 'healthy' | 'failed';
export type ProductionStatus = 'active' | 'disabled';
export type HealthStatus = 'pass' | 'fail';

export interface RuntimeSmokeTestResult {
  id: string;
  passed: boolean;
  log?: string;
}

export interface AdminPromotionApproval {
  approvalId: string;
  approvedBy: string;
  approvedRole: 'admin' | 'agent' | 'system';
  secondFactorVerified: boolean;
}

export interface PluginRuntimeSourceMetadata {
  installPath: string;
  extractedPath: string;
  verifiedPath: string;
  frontendAssetRoot?: string;
  frontendEntryAssetPath?: string;
}

export interface PluginRuntimeRecordDetails {
  environment: 'staging';
  plugin: DiscoveredInstalledPlugin;
  manifest: DiscoveredInstalledPlugin['manifest'];
  source: PluginRuntimeSourceMetadata;
  compatibility: DiscoveredInstalledPlugin['manifest']['compatibility'];
  grants: EffectivePluginGrants;
  health: Record<string, HealthStatus>;
  tests: RuntimeSmokeTestResult[];
  logs: string[];
}

export interface StagedPluginRuntimeRecord extends PluginRuntimeRecordDetails {
  environment: 'staging';
  status: StagingStatus;
  stagedBy: string;
}

export interface ProductionPluginRuntimeRecord {
  environment: 'production';
  plugin: DiscoveredInstalledPlugin;
  manifest: DiscoveredInstalledPlugin['manifest'];
  source: PluginRuntimeSourceMetadata;
  compatibility: DiscoveredInstalledPlugin['manifest']['compatibility'];
  grants: EffectivePluginGrants;
  status: ProductionStatus;
  health: Record<string, HealthStatus>;
  tests: RuntimeSmokeTestResult[];
  logs: string[];
  promotion: AdminPromotionApproval;
}

export interface PluginRuntimeDeploymentState {
  staging: Record<string, StagedPluginRuntimeRecord>;
  production: {
    active: Record<string, ProductionPluginRuntimeRecord>;
    retained: Record<string, ProductionPluginRuntimeRecord[]>;
  };
}

export interface PluginDeploymentAdminView {
  pluginId: string;
  staging: StagedPluginRuntimeRecord | null;
  production: ProductionPluginRuntimeRecord | null;
  rollbackTargets: ProductionPluginRuntimeRecord[];
}

export interface AdminApprovalGate {
  assertCanPromote: (approval: AdminPromotionApproval) => void;
}

export interface StagingRuntimeManagerOptions {
  approvalGate?: AdminApprovalGate;
}

export function createPluginRuntimeDeploymentState(): PluginRuntimeDeploymentState {
  return {
    staging: {},
    production: {
      active: {},
      retained: {},
    },
  };
}

export function createStaticAdminApprovalGate(input?: { requiredSecondFactor?: boolean }): AdminApprovalGate {
  const requiredSecondFactor = input?.requiredSecondFactor ?? true;
  return {
    assertCanPromote: (approval) => {
      if (!approval.approvedBy.trim()) {
        throw new Error(`Promotion approval ${approval.approvalId} requires an authenticated approver`);
      }
      if (approval.approvedRole !== 'admin') {
        throw new Error(`Promotion approval ${approval.approvalId} must be approved by an admin`);
      }
      if (requiredSecondFactor && !approval.secondFactorVerified) {
        throw new Error(`Promotion approval ${approval.approvalId} requires a verified second factor`);
      }
    },
  };
}

export function createStagingRuntimeManager(
  state: PluginRuntimeDeploymentState,
  options: StagingRuntimeManagerOptions = {},
): {
  installToStaging: (input: {
    plugin: DiscoveredInstalledPlugin;
    grants: EffectivePluginGrants;
    actor: string;
  }) => StagedPluginRuntimeRecord;
  runStagingChecks: (input: {
    pluginId: string;
    healthResults: Record<string, boolean>;
    smokeTests: RuntimeSmokeTestResult[];
  }) => StagedPluginRuntimeRecord;
  promoteStaging: (input: {
    pluginId: string;
    approval: AdminPromotionApproval;
    overrideFailedChecks?: boolean;
  }) => ProductionPluginRuntimeRecord;
  rollbackProduction: (input: {
    pluginId: string;
    version: string;
    approval: AdminPromotionApproval;
  }) => ProductionPluginRuntimeRecord;
} {
  const approvalGate = options.approvalGate ?? createStaticAdminApprovalGate();
  return {
    installToStaging: (input) => installToStaging(state, input),
    runStagingChecks: (input) => runStagingChecks(state, input),
    promoteStaging: (input) => promoteStaging(state, approvalGate, input),
    rollbackProduction: (input) => rollbackProduction(state, approvalGate, input),
  };
}

export function getPluginDeploymentAdminView(
  state: PluginRuntimeDeploymentState,
  pluginId: string,
): PluginDeploymentAdminView {
  return {
    pluginId,
    staging: state.staging[pluginId] ?? null,
    production: state.production.active[pluginId] ?? null,
    rollbackTargets: [...(state.production.retained[pluginId] ?? [])],
  };
}

function installToStaging(
  state: PluginRuntimeDeploymentState,
  input: {
    plugin: DiscoveredInstalledPlugin;
    grants: EffectivePluginGrants;
    actor: string;
  },
): StagedPluginRuntimeRecord {
  assertGrantIdentity(input.plugin, input.grants);
  const record: StagedPluginRuntimeRecord = {
    environment: 'staging',
    plugin: input.plugin,
    manifest: input.plugin.manifest,
    source: getPluginSourceMetadata(input.plugin),
    compatibility: input.plugin.manifest.compatibility,
    grants: input.grants,
    status: 'staged',
    health: {},
    tests: [],
    logs: [`${input.actor} staged ${input.plugin.id}@${input.plugin.version}`],
    stagedBy: input.actor,
  };
  state.staging[input.plugin.id] = record;
  return record;
}

function runStagingChecks(
  state: PluginRuntimeDeploymentState,
  input: {
    pluginId: string;
    healthResults: Record<string, boolean>;
    smokeTests: RuntimeSmokeTestResult[];
  },
): StagedPluginRuntimeRecord {
  const record = getStagingRecord(state, input.pluginId);
  if (record.plugin.disabled) throw new Error(`Cannot start disabled staged plugin ${input.pluginId}`);

  record.logs.push(`started staging runtime for ${record.plugin.id}@${record.plugin.version}`);
  record.health = Object.fromEntries(
    Object.entries(input.healthResults).map(([id, passed]) => [id, passed ? 'pass' : 'fail']),
  );
  for (const [id, status] of Object.entries(record.health)) record.logs.push(`health ${id} ${status}`);

  record.tests = input.smokeTests.map((test) => ({ ...test }));
  for (const test of record.tests) record.logs.push(`test ${test.id} ${test.passed ? 'pass' : 'fail'}`);

  record.status = hasBlockingFailure(record) ? 'failed' : 'healthy';
  return record;
}

function promoteStaging(
  state: PluginRuntimeDeploymentState,
  approvalGate: AdminApprovalGate,
  input: {
    pluginId: string;
    approval: AdminPromotionApproval;
    overrideFailedChecks?: boolean;
  },
): ProductionPluginRuntimeRecord {
  approvalGate.assertCanPromote(input.approval);
  const staged = getStagingRecord(state, input.pluginId);
  if (staged.plugin.disabled) throw new Error(`Cannot promote disabled plugin ${input.pluginId}`);
  if (hasBlockingFailure(staged) && !input.overrideFailedChecks) {
    const failure = firstBlockingFailure(staged);
    throw new Error(`Cannot promote ${input.pluginId}: ${failure}`);
  }

  const previous = state.production.active[input.pluginId];
  const productionRecord: ProductionPluginRuntimeRecord = {
    environment: 'production',
    plugin: staged.plugin,
    manifest: staged.manifest,
    source: staged.source,
    compatibility: staged.compatibility,
    grants: staged.grants,
    status: 'active',
    health: { ...staged.health },
    tests: staged.tests.map((test) => ({ ...test })),
    logs: [...staged.logs, `${input.approval.approvedBy} promoted ${staged.plugin.id}@${staged.plugin.version}`],
    promotion: input.approval,
  };

  state.production.active[input.pluginId] = productionRecord;
  delete state.staging[input.pluginId];
  if (previous) retainProductionRecord(state, previous);

  return productionRecord;
}

function rollbackProduction(
  state: PluginRuntimeDeploymentState,
  approvalGate: AdminApprovalGate,
  input: {
    pluginId: string;
    version: string;
    approval: AdminPromotionApproval;
  },
): ProductionPluginRuntimeRecord {
  approvalGate.assertCanPromote(input.approval);
  const retained = state.production.retained[input.pluginId] ?? [];
  const targetIndex = retained.findIndex((record) => record.plugin.version === input.version);
  if (targetIndex === -1) throw new Error(`No retained version ${input.version} for plugin ${input.pluginId}`);

  const target = retained[targetIndex]!;
  const current = state.production.active[input.pluginId];
  const nextRetained = retained.filter((_, index) => index !== targetIndex);
  if (current) nextRetained.unshift(current);
  state.production.retained[input.pluginId] = nextRetained.slice(0, 3);

  const rolledBack: ProductionPluginRuntimeRecord = {
    ...target,
    logs: [...target.logs, `${input.approval.approvedBy} rolled back ${input.pluginId} to ${input.version}`],
    promotion: input.approval,
  };
  state.production.active[input.pluginId] = rolledBack;
  return rolledBack;
}

function getStagingRecord(
  state: PluginRuntimeDeploymentState,
  pluginId: string,
): StagedPluginRuntimeRecord {
  const record = state.staging[pluginId];
  if (!record) throw new Error(`No staged plugin runtime for ${pluginId}`);
  return record;
}

function assertGrantIdentity(plugin: DiscoveredInstalledPlugin, grants: EffectivePluginGrants): void {
  if (grants.pluginId !== plugin.id || grants.pluginVersion !== plugin.version) {
    throw new Error('Effective grants do not match staged plugin artifact');
  }
}

function getPluginSourceMetadata(plugin: DiscoveredInstalledPlugin): PluginRuntimeSourceMetadata {
  return {
    installPath: plugin.installPath,
    extractedPath: plugin.extractedPath,
    verifiedPath: plugin.verifiedPath,
    frontendAssetRoot: plugin.frontendAssetRoot,
    frontendEntryAssetPath: plugin.frontendEntryAssetPath,
  };
}

function hasBlockingFailure(record: StagedPluginRuntimeRecord): boolean {
  return Object.values(record.health).includes('fail') || record.tests.some((test) => !test.passed);
}

function firstBlockingFailure(record: StagedPluginRuntimeRecord): string {
  const failedHealth = Object.entries(record.health).find(([, status]) => status === 'fail');
  if (failedHealth) return `health check ${failedHealth[0]} failed`;
  const failedTest = record.tests.find((test) => !test.passed);
  if (failedTest) return `smoke test ${failedTest.id} failed`;
  return 'unknown staging failure';
}

function retainProductionRecord(
  state: PluginRuntimeDeploymentState,
  record: ProductionPluginRuntimeRecord,
): void {
  const retained = state.production.retained[record.plugin.id] ?? [];
  state.production.retained[record.plugin.id] = [record, ...retained]
    .filter((candidate, index, records) =>
      records.findIndex((other) => other.plugin.version === candidate.plugin.version) === index,
    )
    .slice(0, 3);
}

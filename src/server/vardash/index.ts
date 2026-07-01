export {
  VardashKeyError,
  assertVardashKeyIsNotInRepoOrWorktree,
  defaultVardashPrivateDir,
  generateVardashSqlcipherKey,
  loadOrCreateVardashSqlcipherKey,
  validateVardashSqlcipherKey,
  type VardashKeyMaterial,
  type VardashKeyOptions,
} from './key-manager';

export {
  SqlcipherVardashStore,
  type CreateSavedValueInput,
  type RepoEnvKeyMetadata,
  type RepoEnvSavedValueMetadata,
  type RepoProcessDefinitionMetadata,
  type RepoProcessDefinitionSource,
  type ResolveRepoEnvForLaunchInput,
  type ResolvedRepoEnv,
  type SetSelectionInput,
  type SetWorkspaceRepoSelectionInput,
  type SqlcipherVardashStoreOptions,
  type UpsertRepoEnvKeyInput,
  type UpsertRepoProcessDefinitionInput,
  type VardashStore,
  type VardashValueKind,
  type WorkspaceRepoProcessDefinition,
} from './store';

export {
  importVardashEnv,
  parseDotenv,
  type DotenvParseDiagnostic,
  type ImportVardashEnvInput,
  type ImportVardashEnvResult,
  type ParsedDotenv,
  type ParsedDotenvEntry,
  type VardashEnvImportSource,
} from './import-parser';

export {
  resolveVardashRepoEnv,
  type ResolveVardashRepoEnvInput,
  type VardashResolvedEnv,
} from './resolver';

export {
  preflightImport,
  registerVardashRoutes,
  type RegisterVardashRoutesOptions,
  type VardashImportConflict,
} from './api';

export {
  buildVarlockRunCommand,
  generateVardashVarlockSchema,
  vardashKeyToVarlockSchemaKey,
  type BuildVarlockRunCommandInput,
  type VardashVarlockSchemaKey,
  type VarlockRunCommand,
} from './varlock-spike';

export {
  ensureLegacyDevServerProcessDefinition,
  legacyDevServerProcessInput,
  type EnsureLegacyDevServerProcessInput,
  type LegacyDevServerRepoLike,
} from './process-definitions';

export {
  VardashLaunchError,
  buildIsolatedVardashLaunchEnv,
  buildNormalAgentExecutionEnv,
  prepareVardashRepoProcessLaunch,
  type PrepareVardashRepoProcessLaunchInput,
  type VardashRepoProcessLaunchPlan,
} from './launch';

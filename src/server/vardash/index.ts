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
  type ResolveRepoEnvForLaunchInput,
  type ResolvedRepoEnv,
  type SetSelectionInput,
  type SetWorkspaceRepoSelectionInput,
  type SqlcipherVardashStoreOptions,
  type UpsertRepoEnvKeyInput,
  type VardashStore,
  type VardashValueKind,
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

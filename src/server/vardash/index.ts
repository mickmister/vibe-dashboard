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

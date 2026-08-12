import type { ResolveRepoEnvForLaunchInput, ResolvedRepoEnv, VardashStore } from './store';

export interface ResolveVardashRepoEnvInput extends ResolveRepoEnvForLaunchInput {
  store: VardashStore;
}

export interface VardashResolvedEnv extends ResolvedRepoEnv {
  canLaunch: boolean;
  selectionSemantics: 'workspace-null-inherits-repo-default';
}

export async function resolveVardashRepoEnv(input: ResolveVardashRepoEnvInput): Promise<VardashResolvedEnv> {
  const resolved = await input.store.resolveRepoEnvForLaunch({
    repoId: input.repoId,
    workspaceId: input.workspaceId,
  });

  return {
    ...resolved,
    canLaunch: resolved.missingRequired.length === 0,
    selectionSemantics: 'workspace-null-inherits-repo-default',
  };
}

import type { RepoProcessDefinitionMetadata, UpsertRepoProcessDefinitionInput, VardashStore } from './store';

export interface LegacyDevServerRepoLike {
  id: string;
  name?: string | null;
  display_name?: string | null;
  dev_server_script?: string | null;
}

export interface EnsureLegacyDevServerProcessInput {
  store: VardashStore;
  repo: LegacyDevServerRepoLike;
  name?: string;
}

export function legacyDevServerProcessInput(
  repo: LegacyDevServerRepoLike,
  name = 'Dev server',
): UpsertRepoProcessDefinitionInput | null {
  const command = repo.dev_server_script?.trim();
  if (!command) return null;
  return {
    repoId: repo.id,
    name,
    command,
    source: 'legacy_dev_server_script',
    isDefault: true,
  };
}

export async function ensureLegacyDevServerProcessDefinition(
  input: EnsureLegacyDevServerProcessInput,
): Promise<RepoProcessDefinitionMetadata | null> {
  const processInput = legacyDevServerProcessInput(input.repo, input.name);
  if (!processInput) return null;
  return input.store.upsertRepoProcessDefinition(processInput);
}

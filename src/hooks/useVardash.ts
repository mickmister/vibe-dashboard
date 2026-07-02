import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import {
  vardashClient,
  type GetVardashLaunchReadinessInput,
  type ImportVardashEnvInput,
  type LaunchVardashRepoProcessInput,
  type SetVardashSelectionInput,
  type UpsertVardashEnvKeyInput,
  type UpsertVardashProcessDefinitionInput,
  type UpsertVardashSavedValueInput,
  type VardashApiError,
  type VardashEnvKeyResponse,
  type VardashEnvKeysResponse,
  type VardashImportResponse,
  type VardashLaunchReadinessResponse,
  type VardashLaunchStartedResponse,
  type VardashLaunchStatusResponse,
  type VardashLaunchStopResponse,
  type VardashProcessDefinitionResponse,
  type VardashProcessDefinitionsResponse,
  type VardashSavedValueResponse,
  type VardashSavedValuesResponse,
  type VardashSelectionResponse,
  type VardashWorkspaceProcessDefinitionsResponse,
} from '../lib/vardash-client';

export const vardashQueryKeys = {
  repoEnvKeys: (repoId: string) => ['vardash', 'repos', repoId, 'env-keys'] as const,
  savedValues: (repoId: string, envKeyId: string) => ['vardash', 'repos', repoId, 'env-keys', envKeyId, 'saved-values'] as const,
  repoProcesses: (repoId: string) => ['vardash', 'repos', repoId, 'process-definitions'] as const,
  workspaceRepoProcesses: (workspaceId: string, repoId: string) => [
    'vardash',
    'workspaces',
    workspaceId,
    'repos',
    repoId,
    'process-definitions',
  ] as const,
  launchReadiness: (input: GetVardashLaunchReadinessInput) => [
    'vardash',
    'workspaces',
    input.workspaceId,
    'repos',
    input.repoId,
    'launch-readiness',
    input.processDefinitionId ?? null,
    input.processName ?? null,
    input.useVarlock ?? null,
  ] as const,
  launchStatus: (runId: string) => ['vardash', 'launches', runId, 'status'] as const,
};

export function useVardashRepoEnvKeys(repoId: string | null): UseQueryResult<VardashEnvKeysResponse, VardashApiError> {
  return useQuery({
    queryKey: vardashQueryKeys.repoEnvKeys(repoId ?? ''),
    enabled: Boolean(repoId),
    queryFn: () => vardashClient.listRepoEnvKeys(repoId!),
  });
}

export function useVardashSavedValues(
  repoId: string | null,
  envKeyId: string | null,
): UseQueryResult<VardashSavedValuesResponse, VardashApiError> {
  return useQuery({
    queryKey: vardashQueryKeys.savedValues(repoId ?? '', envKeyId ?? ''),
    enabled: Boolean(repoId && envKeyId),
    queryFn: () => vardashClient.listSavedValues(repoId!, envKeyId!),
  });
}

export function useVardashRepoProcessDefinitions(
  repoId: string | null,
): UseQueryResult<VardashProcessDefinitionsResponse, VardashApiError> {
  return useQuery({
    queryKey: vardashQueryKeys.repoProcesses(repoId ?? ''),
    enabled: Boolean(repoId),
    queryFn: () => vardashClient.listRepoProcessDefinitions(repoId!),
  });
}

export function useVardashWorkspaceRepoProcessDefinitions(
  workspaceId: string | null,
  repoId: string | null,
): UseQueryResult<VardashWorkspaceProcessDefinitionsResponse, VardashApiError> {
  return useQuery({
    queryKey: vardashQueryKeys.workspaceRepoProcesses(workspaceId ?? '', repoId ?? ''),
    enabled: Boolean(workspaceId && repoId),
    queryFn: () => vardashClient.listWorkspaceRepoProcessDefinitions(workspaceId!, repoId!),
  });
}

export function useVardashLaunchReadiness(
  input: GetVardashLaunchReadinessInput | null,
): UseQueryResult<VardashLaunchReadinessResponse, VardashApiError> {
  return useQuery({
    queryKey: vardashQueryKeys.launchReadiness(input ?? { workspaceId: '', repoId: '' }),
    enabled: Boolean(input),
    queryFn: () => vardashClient.getLaunchReadiness(input!),
  });
}

export function useVardashLaunchStatus(runId: string | null): UseQueryResult<VardashLaunchStatusResponse, VardashApiError> {
  return useQuery({
    queryKey: vardashQueryKeys.launchStatus(runId ?? ''),
    enabled: Boolean(runId),
    queryFn: () => vardashClient.getLaunchStatus(runId!),
  });
}

export function useUpsertVardashRepoEnvKey(): UseMutationResult<
  VardashEnvKeyResponse,
  VardashApiError,
  { repoId: string; input: UpsertVardashEnvKeyInput }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ repoId, input }) => vardashClient.upsertRepoEnvKey(repoId, input),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: vardashQueryKeys.repoEnvKeys(variables.repoId) });
    },
  });
}

export function useCreateVardashSavedValue(): UseMutationResult<
  VardashSavedValueResponse,
  VardashApiError,
  { repoId: string; envKeyId: string; input: UpsertVardashSavedValueInput }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ repoId, envKeyId, input }) => vardashClient.createSavedValue(repoId, envKeyId, input),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: vardashQueryKeys.savedValues(variables.repoId, variables.envKeyId) });
    },
  });
}

export function useReplaceVardashSavedValue(): UseMutationResult<
  VardashSavedValueResponse,
  VardashApiError,
  { repoId: string; envKeyId: string; savedValueId: string; input: UpsertVardashSavedValueInput }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ repoId, envKeyId, savedValueId, input }) => vardashClient.replaceSavedValue(repoId, envKeyId, savedValueId, input),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: vardashQueryKeys.savedValues(variables.repoId, variables.envKeyId) });
    },
  });
}

export function useSetVardashRepoDefaultSelection(): UseMutationResult<
  VardashSelectionResponse,
  VardashApiError,
  { repoId: string; input: SetVardashSelectionInput }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ repoId, input }) => vardashClient.setRepoDefaultSelection(repoId, input),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: vardashQueryKeys.repoEnvKeys(variables.repoId) });
    },
  });
}

export function useSetVardashWorkspaceRepoSelection(): UseMutationResult<
  VardashSelectionResponse,
  VardashApiError,
  { workspaceId: string; repoId: string; input: SetVardashSelectionInput }
> {
  return useMutation({
    mutationFn: ({ workspaceId, repoId, input }) => vardashClient.setWorkspaceRepoSelection(workspaceId, repoId, input),
  });
}

export function useImportVardashRepoEnv(): UseMutationResult<
  VardashImportResponse,
  VardashApiError,
  { repoId: string; input: ImportVardashEnvInput }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ repoId, input }) => vardashClient.importRepoEnv(repoId, input),
    onSuccess: (_data, variables) => {
      if (!variables.input.dryRun) {
        void queryClient.invalidateQueries({ queryKey: vardashQueryKeys.repoEnvKeys(variables.repoId) });
      }
    },
  });
}

export function useUpsertVardashRepoProcessDefinition(): UseMutationResult<
  VardashProcessDefinitionResponse,
  VardashApiError,
  { repoId: string; input: UpsertVardashProcessDefinitionInput }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ repoId, input }) => vardashClient.upsertRepoProcessDefinition(repoId, input),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: vardashQueryKeys.repoProcesses(variables.repoId) });
    },
  });
}

export function useImportLegacyDevServerProcessDefinition(): UseMutationResult<
  VardashProcessDefinitionResponse,
  VardashApiError,
  { repoId: string; devServerScript: string | null }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ repoId, devServerScript }) => vardashClient.importLegacyDevServerProcessDefinition(repoId, devServerScript),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: vardashQueryKeys.repoProcesses(variables.repoId) });
    },
  });
}

export function useLaunchVardashRepoProcess(): UseMutationResult<
  VardashLaunchStartedResponse,
  VardashApiError,
  LaunchVardashRepoProcessInput
> {
  return useMutation({
    mutationFn: (input) => vardashClient.launchRepoProcess(input),
  });
}

export function useStopVardashLaunch(): UseMutationResult<
  VardashLaunchStopResponse,
  VardashApiError,
  { runId: string }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ runId }) => vardashClient.stopLaunch(runId),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: vardashQueryKeys.launchStatus(variables.runId) });
    },
  });
}

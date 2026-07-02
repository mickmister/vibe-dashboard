import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type QueryKey,
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
  type VardashRepoEnvOverviewResponse,
  type VardashProcessDefinitionsResponse,
  type VardashSavedValueResponse,
  type VardashSavedValuesResponse,
  type VardashSelectionResponse,
  type VardashWorkspaceProcessDefinitionsResponse,
} from '../lib/vardash-client';

export const vardashQueryKeys = {
  repoEnv: (repoId: string) => ['vardash', 'repos', repoId, 'env-keys'] as const,
  repoEnvOverview: (repoId: string, workspaceId?: string | null) => [
    'vardash',
    'repos',
    repoId,
    'env-overview',
    workspaceId ?? null,
  ] as const,
  repoEnvOverviewScope: (repoId: string) => ['vardash', 'repos', repoId, 'env-overview'] as const,
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

type VardashInvalidateClient = Pick<QueryClient, 'invalidateQueries'>;

export function invalidateVardashRepoEnvQueries(queryClient: VardashInvalidateClient, repoId: string): void {
  void queryClient.invalidateQueries({ queryKey: vardashQueryKeys.repoEnv(repoId) });
  void queryClient.invalidateQueries({ queryKey: vardashQueryKeys.repoEnvOverviewScope(repoId) });
}

export function invalidateVardashWorkspaceRepoSelectionQueries(
  queryClient: VardashInvalidateClient,
  workspaceId: string,
  repoId: string,
): void {
  void queryClient.invalidateQueries({ queryKey: vardashQueryKeys.repoEnvOverview(repoId, workspaceId) });
  void queryClient.invalidateQueries({ queryKey: vardashQueryKeys.launchReadiness({ workspaceId, repoId }) });
}

export function invalidateVardashProcessQueries(queryClient: VardashInvalidateClient, repoId: string): void {
  void queryClient.invalidateQueries({ queryKey: vardashQueryKeys.repoProcesses(repoId) });
  void queryClient.invalidateQueries({
    queryKey: ['vardash', 'workspaces'],
    predicate: (query) => isWorkspaceRepoProcessQuery(query.queryKey, repoId),
  });
  invalidateVardashLaunchReadinessQueries(queryClient, repoId);
}

export function invalidateVardashLaunchReadinessQueries(queryClient: VardashInvalidateClient, repoId?: string): void {
  void queryClient.invalidateQueries({
    queryKey: ['vardash'],
    predicate: (query) => isLaunchReadinessQuery(query.queryKey, repoId),
  });
}

function isWorkspaceRepoProcessQuery(queryKey: QueryKey, repoId: string): boolean {
  return queryKey[0] === 'vardash'
    && queryKey[1] === 'workspaces'
    && queryKey[3] === 'repos'
    && queryKey[4] === repoId
    && queryKey[5] === 'process-definitions';
}

function isLaunchReadinessQuery(queryKey: QueryKey, repoId?: string): boolean {
  return queryKey[0] === 'vardash'
    && queryKey[5] === 'launch-readiness'
    && (repoId == null || queryKey[4] === repoId);
}

export function useVardashRepoEnvOverview(
  repoId: string | null,
  workspaceId?: string | null,
): UseQueryResult<VardashRepoEnvOverviewResponse, VardashApiError> {
  return useQuery({
    queryKey: vardashQueryKeys.repoEnvOverview(repoId ?? '', workspaceId),
    enabled: Boolean(repoId),
    queryFn: () => vardashClient.listRepoEnvOverview(repoId!, workspaceId),
  });
}

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
      invalidateVardashRepoEnvQueries(queryClient, variables.repoId);
      invalidateVardashLaunchReadinessQueries(queryClient, variables.repoId);
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
      invalidateVardashRepoEnvQueries(queryClient, variables.repoId);
      invalidateVardashLaunchReadinessQueries(queryClient, variables.repoId);
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
      invalidateVardashRepoEnvQueries(queryClient, variables.repoId);
      invalidateVardashLaunchReadinessQueries(queryClient, variables.repoId);
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
      invalidateVardashRepoEnvQueries(queryClient, variables.repoId);
      invalidateVardashLaunchReadinessQueries(queryClient, variables.repoId);
    },
  });
}

export function useSetVardashWorkspaceRepoSelection(): UseMutationResult<
  VardashSelectionResponse,
  VardashApiError,
  { workspaceId: string; repoId: string; input: SetVardashSelectionInput }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ workspaceId, repoId, input }) => vardashClient.setWorkspaceRepoSelection(workspaceId, repoId, input),
    onSuccess: (_data, variables) => {
      invalidateVardashWorkspaceRepoSelectionQueries(queryClient, variables.workspaceId, variables.repoId);
    },
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
        invalidateVardashRepoEnvQueries(queryClient, variables.repoId);
        invalidateVardashLaunchReadinessQueries(queryClient, variables.repoId);
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
      invalidateVardashProcessQueries(queryClient, variables.repoId);
    },
  });
}

export function useSetVardashRepoProcessDefinitionDefault(): UseMutationResult<
  VardashProcessDefinitionResponse,
  VardashApiError,
  { repoId: string; processDefinitionId: string }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ repoId, processDefinitionId }) => vardashClient.setRepoProcessDefinitionDefault(repoId, processDefinitionId),
    onSuccess: (_data, variables) => {
      invalidateVardashProcessQueries(queryClient, variables.repoId);
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
      invalidateVardashProcessQueries(queryClient, variables.repoId);
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

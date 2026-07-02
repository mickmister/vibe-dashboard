import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import {
  invalidateVardashLaunchReadinessQueries,
  invalidateVardashProcessQueries,
  invalidateVardashRepoEnvQueries,
  invalidateVardashWorkspaceRepoSelectionQueries,
  vardashQueryKeys,
} from './useVardash';

describe('vardash hook cache invalidation', () => {
  it('invalidates saved-value caches when env keys change kind to avoid stale plaintext display', () => {
    const queryClient = new QueryClient();
    const savedValuesKey = vardashQueryKeys.savedValues('repo-a', 'key-plain');
    const otherRepoSavedValuesKey = vardashQueryKeys.savedValues('repo-b', 'key-plain');

    queryClient.setQueryData(vardashQueryKeys.repoEnvKeys('repo-a'), { keys: [] });
    queryClient.setQueryData(savedValuesKey, {
      values: [{ id: 'saved-1', kind: 'plain', value: 'cached-plaintext' }],
    });
    queryClient.setQueryData(otherRepoSavedValuesKey, {
      values: [{ id: 'saved-2', kind: 'plain', value: 'other-repo-plaintext' }],
    });

    invalidateVardashRepoEnvQueries(queryClient, 'repo-a');

    expect(queryClient.getQueryState(vardashQueryKeys.repoEnvKeys('repo-a'))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(savedValuesKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(otherRepoSavedValuesKey)?.isInvalidated).toBe(false);
  });

  it('invalidates process and launch readiness views when repo process definitions change', () => {
    const queryClient = new QueryClient();
    const repoProcessesKey = vardashQueryKeys.repoProcesses('repo-a');
    const workspaceProcessesKey = vardashQueryKeys.workspaceRepoProcesses('ws-a', 'repo-a');
    const otherWorkspaceProcessesKey = vardashQueryKeys.workspaceRepoProcesses('ws-a', 'repo-b');
    const readinessKey = vardashQueryKeys.launchReadiness({ workspaceId: 'ws-a', repoId: 'repo-a' });
    const otherReadinessKey = vardashQueryKeys.launchReadiness({ workspaceId: 'ws-a', repoId: 'repo-b' });

    queryClient.setQueryData(repoProcessesKey, { processes: [] });
    queryClient.setQueryData(workspaceProcessesKey, { processes: [] });
    queryClient.setQueryData(otherWorkspaceProcessesKey, { processes: [] });
    queryClient.setQueryData(readinessKey, { ready: true });
    queryClient.setQueryData(otherReadinessKey, { ready: true });

    invalidateVardashProcessQueries(queryClient, 'repo-a');

    expect(queryClient.getQueryState(repoProcessesKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(workspaceProcessesKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(readinessKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(otherWorkspaceProcessesKey)?.isInvalidated).toBe(false);
    expect(queryClient.getQueryState(otherReadinessKey)?.isInvalidated).toBe(false);
  });

  it('invalidates readiness for selection/env changes without exposing raw env data', () => {
    const queryClient = new QueryClient();
    const readinessKey = vardashQueryKeys.launchReadiness({ workspaceId: 'ws-a', repoId: 'repo-a' });
    const otherWorkspaceReadinessKey = vardashQueryKeys.launchReadiness({ workspaceId: 'ws-b', repoId: 'repo-a' });

    queryClient.setQueryData(readinessKey, { ready: true });
    queryClient.setQueryData(otherWorkspaceReadinessKey, { ready: true });

    invalidateVardashWorkspaceRepoSelectionQueries(queryClient, 'ws-a', 'repo-a');

    expect(queryClient.getQueryState(readinessKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(otherWorkspaceReadinessKey)?.isInvalidated).toBe(false);

    invalidateVardashLaunchReadinessQueries(queryClient, 'repo-a');

    expect(queryClient.getQueryState(otherWorkspaceReadinessKey)?.isInvalidated).toBe(true);
  });
});

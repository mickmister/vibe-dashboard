import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { vkClient, type RepoWithBranch } from '../../lib/vk-client';
import { VardashImportPanel } from './VardashImportPanel';
import { VardashLaunchPanel } from './VardashLaunchPanel';
import { VardashProcessDefinitionsPanel } from './VardashProcessDefinitionsPanel';
import { VardashRepoEnvManager } from './VardashRepoEnvManager';

export interface VardashSettingsPanelProps {
  workspaceId: string;
  workspaceDir: string;
}

export function VardashSettingsPanel({ workspaceId, workspaceDir }: VardashSettingsPanelProps) {
  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null);
  const reposQuery = useQuery({
    queryKey: ['vk', 'workspaces', workspaceId, 'repos'],
    queryFn: () => vkClient.getWorkspaceRepos(workspaceId),
  });
  const repos = reposQuery.data ?? [];
  const selectedRepo = useMemo(
    () => getSelectedVardashRepo(repos, selectedRepoId),
    [repos, selectedRepoId],
  );

  return (
    <VardashSettingsView
      workspaceId={workspaceId}
      workspaceDir={workspaceDir}
      repos={repos}
      selectedRepoId={selectedRepo?.id ?? selectedRepoId}
      loading={reposQuery.isLoading}
      error={reposQuery.error}
      onSelectRepo={setSelectedRepoId}
    >
      {selectedRepo ? (
        <div className="space-y-8">
          <VardashRepoEnvManager
            repoId={selectedRepo.id}
            workspaceId={workspaceId}
            repoLabel={getVardashRepoLabel(selectedRepo)}
          />
          <VardashImportPanel repoId={selectedRepo.id} workspaceId={workspaceId} />
          <VardashProcessDefinitionsPanel repoId={selectedRepo.id} workspaceId={workspaceId} />
          <VardashLaunchPanel workspaceId={workspaceId} repoId={selectedRepo.id} />
        </div>
      ) : null}
    </VardashSettingsView>
  );
}

export interface VardashSettingsViewProps {
  workspaceId: string;
  workspaceDir: string;
  repos: RepoWithBranch[];
  selectedRepoId: string | null;
  loading: boolean;
  error?: unknown;
  onSelectRepo: (repoId: string | null) => void;
  children?: React.ReactNode;
}

export function VardashSettingsView({
  workspaceId,
  workspaceDir,
  repos,
  selectedRepoId,
  loading,
  error,
  onSelectRepo,
  children,
}: VardashSettingsViewProps) {
  const selectedRepo = getSelectedVardashRepo(repos, selectedRepoId);
  const multiRepoSelectionRequired = repos.length > 1 && !selectedRepo;

  return (
    <section aria-label="Vardash settings" className="min-h-0 space-y-5 text-neutral-100">
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-wide text-violet-300">Vardash</p>
        <h2 className="text-2xl font-semibold">Workspace repo env and launches</h2>
        <p className="text-sm text-neutral-300">
          Vardash settings are scoped to one repo in this workspace. Secrets remain write-only in normal UI/API paths; resolved values are only used by explicit launches.
        </p>
        <dl className="grid gap-1 text-xs text-neutral-400 md:grid-cols-[auto_1fr] md:gap-x-3">
          <dt>Workspace</dt>
          <dd className="break-all">{workspaceId}</dd>
          <dt>Directory</dt>
          <dd className="break-all">{workspaceDir}</dd>
        </dl>
      </header>

      <section className="space-y-3 rounded border border-neutral-800 p-4" aria-label="Vardash repo selection">
        <h3 className="font-semibold">Repository</h3>
        {loading ? <p className="text-sm text-neutral-400">Loading workspace repositories…</p> : null}
        {error ? <p className="text-sm text-red-200">Unable to load workspace repositories.</p> : null}
        {!loading && !error && repos.length === 0 ? (
          <p className="text-sm text-neutral-400">No repositories are attached to this workspace.</p>
        ) : null}
        {repos.length === 1 ? (
          <p className="text-sm text-neutral-300">
            Using repository <span className="font-medium text-neutral-100">{getVardashRepoLabel(repos[0]!)}</span>.
          </p>
        ) : null}
        {repos.length > 1 ? (
          <label className="block text-sm">
            <span className="mb-1 block text-neutral-300">Choose a repository</span>
            <select
              className="w-full rounded border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100"
              value={selectedRepo?.id ?? ''}
              onChange={(event) => onSelectRepo(event.target.value || null)}
            >
              <option value="">Select repo…</option>
              {repos.map((repo) => (
                <option key={repo.id} value={repo.id}>
                  {getVardashRepoLabel(repo)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {multiRepoSelectionRequired ? (
          <p className="text-sm text-amber-100">
            This workspace has multiple repos. Select one before editing Vardash settings.
          </p>
        ) : null}
      </section>

      {selectedRepo ? (
        <div className="space-y-4">
          <p className="text-sm text-neutral-300">
            Editing Vardash settings for <span className="font-medium text-neutral-100">{getVardashRepoLabel(selectedRepo)}</span>.
          </p>
          {children}
        </div>
      ) : null}
    </section>
  );
}

export function getSelectedVardashRepo(
  repos: RepoWithBranch[],
  selectedRepoId: string | null,
): RepoWithBranch | null {
  if (repos.length === 1) return repos[0] ?? null;
  if (!selectedRepoId) return null;
  return repos.find((repo) => repo.id === selectedRepoId) ?? null;
}

export function getVardashRepoLabel(repo: Pick<RepoWithBranch, 'display_name' | 'name'>): string {
  return repo.display_name || repo.name;
}

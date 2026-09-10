import React, { useEffect, useState } from 'react';
import type { ExternalIssueProvider } from '../contracts';
import type { ExternalKanbanCardDto, ExternalKanbanRelatedWorkspaceDto } from '../boardTypes';
import {
  createExternalIssueWorkspace,
  fetchExternalWorkspaceCreateOptions,
  fetchExternalWorkspaceRepoBranches,
  registerExternalWorkspaceRepo,
  type ExternalWorkspaceCandidateRepoDto,
  type ExternalWorkspaceCreateOptionsDto,
  type VkBranchDto,
  type VkExecutorConfigDto,
  type VkRepoDto,
} from '../externalWorkspaceApi';

interface SelectedWorkspaceRepo {
  name: string;
  path: string;
  repoId?: string;
  targetBranch: string;
  branches: VkBranchDto[];
  loading: boolean;
}

export function ExternalWorkspaceCreateDialog({
  provider,
  siteHostname,
  card,
  onClose,
  onCreated,
}: {
  provider: ExternalIssueProvider;
  siteHostname: string;
  card: ExternalKanbanCardDto;
  onClose: () => void;
  onCreated: (workspace: ExternalKanbanRelatedWorkspaceDto) => void;
}) {
  const [options, setOptions] = useState<ExternalWorkspaceCreateOptionsDto | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [prompt, setPrompt] = useState(`Work on ${card.key}: ${card.title}`);
  const [executorConfig, setExecutorConfig] = useState<VkExecutorConfigDto>({ executor: 'CODEX' });
  const [selectedRepos, setSelectedRepos] = useState<SelectedWorkspaceRepo[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    fetchExternalWorkspaceCreateOptions()
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          setError(`${result.error.message} ${result.error.userAction}`);
          return;
        }
        setOptions(result.options);
        setExecutorConfig(result.options.defaultExecutorConfig);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function addRepo(candidate: ExternalWorkspaceCandidateRepoDto) {
    if (selectedRepos.some((repo) => repo.path === candidate.path)) return;
    const optimistic: SelectedWorkspaceRepo = {
      name: candidate.name,
      path: candidate.path,
      repoId: candidate.registeredRepoId,
      targetBranch: candidate.defaultTargetBranch ?? 'origin/main',
      branches: [],
      loading: true,
    };
    setSelectedRepos((repos) => [...repos, optimistic]);
    try {
      const registered = candidate.registeredRepoId
        ? { ok: true as const, repo: { id: candidate.registeredRepoId, path: candidate.path, name: candidate.name, display_name: candidate.name } as VkRepoDto }
        : await registerExternalWorkspaceRepo(candidate.path);
      if (!registered.ok) throw new Error(`${registered.error.message} ${registered.error.userAction}`);
      const branchesResult = await fetchExternalWorkspaceRepoBranches(registered.repo.id);
      if (!branchesResult.ok) throw new Error(`${branchesResult.error.message} ${branchesResult.error.userAction}`);
      setSelectedRepos((repos) => repos.map((repo) => repo.path === candidate.path ? {
        ...repo,
        repoId: registered.repo.id,
        branches: branchesResult.branches,
        targetBranch: chooseInitialBranch(branchesResult.branches, optimistic.targetBranch),
        loading: false,
      } : repo));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setSelectedRepos((repos) => repos.filter((repo) => repo.path !== candidate.path));
    }
  }

  async function createWorkspace() {
    setError(undefined);
    const repos = selectedRepos.filter((repo) => repo.repoId && repo.targetBranch).map((repo) => ({ repo_id: repo.repoId as string, target_branch: repo.targetBranch }));
    if (repos.length === 0) {
      setError('Select at least one repository.');
      return;
    }
    setSubmitting(true);
    try {
      const result = await createExternalIssueWorkspace({
        provider,
        card,
        prompt,
        repos,
        executorConfig,
        siteHostname,
      });
      if (!result.ok) throw new Error(`${result.error.message} ${result.error.userAction}`);
      onCreated({
        workspaceId: result.workspace.id,
        displayName: result.workspace.name ?? card.key,
        workspaceDir: result.workspace.container_ref ?? undefined,
        isPrimary: true,
        metadata: { source: `external-${provider}-single-issue-create-workspace` },
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSubmitting(false);
    }
  }

  const availableRepos = options?.repos.filter((candidate) => !selectedRepos.some((repo) => repo.path === candidate.path)) ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center" role="dialog" aria-modal="true" aria-label={`Create VK workspace for ${card.key}`}>
      <div className="max-h-[90dvh] w-full max-w-3xl overflow-y-auto rounded-xl border border-neutral-800 bg-neutral-950 p-5 text-neutral-100 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300">Create VK workspace</div>
            <h2 className="mt-2 text-xl font-semibold">{card.key}: {card.title}</h2>
            <p className="mt-1 text-sm text-neutral-400">Select one or more repos from ~/repos and start a VK workspace for this issue.</p>
          </div>
          <button type="button" className="rounded border border-neutral-800 px-2 py-1 text-sm hover:bg-neutral-900" onClick={onClose}>Close</button>
        </div>

        {loading ? <p className="mt-4 text-sm text-neutral-400">Loading VK workspace options…</p> : null}
        {error ? <div role="alert" className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-100">{error}</div> : null}

        <label className="mt-4 block text-sm font-medium text-neutral-200">
          Prompt
          <textarea className="mt-2 min-h-24 w-full rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-sm text-neutral-100" value={prompt} onChange={(event) => setPrompt(event.target.value)} />
        </label>

        <label className="mt-4 block text-sm font-medium text-neutral-200">
          Executor
          <select className="mt-2 w-full rounded-lg border border-neutral-800 bg-neutral-900 p-2 text-sm text-neutral-100" value={executorConfig.executor} onChange={(event) => setExecutorConfig({ executor: event.target.value as VkExecutorConfigDto['executor'] })}>
            {(options?.executors.length ? options.executors : [executorConfig.executor]).map((executor) => <option key={executor} value={executor}>{executor}</option>)}
          </select>
        </label>

        <section className="mt-5 grid gap-4 md:grid-cols-2">
          <div>
            <h3 className="text-sm font-semibold text-neutral-200">Available repos under ~/repos</h3>
            <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-neutral-800">
              {availableRepos.length === 0 ? <p className="p-3 text-sm text-neutral-500">No repositories found.</p> : null}
              {availableRepos.map((repo) => (
                <button key={repo.path} type="button" className="block w-full border-b border-neutral-900 px-3 py-2 text-left text-sm hover:bg-neutral-900" onClick={() => addRepo(repo)}>
                  <span className="font-medium text-neutral-100">{repo.name}</span>
                  <span className="block truncate text-xs text-neutral-500">{repo.path}</span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-neutral-200">Selected repositories</h3>
            <div className="mt-2 space-y-2">
              {selectedRepos.length === 0 ? <p className="rounded-lg border border-dashed border-neutral-800 p-3 text-sm text-neutral-500">Select at least one repository.</p> : null}
              {selectedRepos.map((repo) => (
                <div key={repo.path} className="rounded-lg border border-neutral-800 bg-neutral-900/70 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{repo.name}</div>
                      <div className="truncate text-xs text-neutral-500">{repo.path}</div>
                    </div>
                    <button type="button" className="text-xs text-neutral-400 hover:text-neutral-100" onClick={() => setSelectedRepos((repos) => repos.filter((candidate) => candidate.path !== repo.path))}>Remove</button>
                  </div>
                  <label className="mt-2 block text-xs text-neutral-400">
                    Target branch
                    <select className="mt-1 w-full rounded border border-neutral-800 bg-neutral-950 p-2 text-sm text-neutral-100" disabled={repo.loading} value={repo.targetBranch} onChange={(event) => setSelectedRepos((repos) => repos.map((candidate) => candidate.path === repo.path ? { ...candidate, targetBranch: event.target.value } : candidate))}>
                      {repo.loading ? <option value={repo.targetBranch}>Loading branches…</option> : repo.branches.map((branch) => <option key={branch.name} value={branch.name}>{branch.name}</option>)}
                    </select>
                  </label>
                </div>
              ))}
            </div>
          </div>
        </section>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="rounded-lg border border-neutral-800 px-3 py-2 text-sm hover:bg-neutral-900" onClick={onClose}>Cancel</button>
          <button type="button" className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50" disabled={submitting || !prompt.trim() || selectedRepos.some((repo) => repo.loading) || selectedRepos.length === 0} onClick={createWorkspace}>Create workspace</button>
        </div>
      </div>
    </div>
  );
}

function chooseInitialBranch(branches: VkBranchDto[], preferred: string): string {
  if (branches.some((branch) => branch.name === preferred)) return preferred;
  return branches.find((branch) => branch.name === 'origin/main')?.name ?? branches.find((branch) => branch.name === 'main')?.name ?? branches[0]?.name ?? preferred;
}

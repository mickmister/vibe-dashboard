export type RepoCloneApiError = {
  code: string;
  message: string;
  userAction: string;
};

export type RepoCloneApiEnvelope<T> =
  | ({ ok: true } & T)
  | { ok: false; error: RepoCloneApiError };

export async function cloneExternalWorkspaceRepo(
  repoUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RepoCloneApiEnvelope<{ repo: { id: string; path: string; name: string; display_name: string; default_target_branch?: string | null } }>> {
  const response = await fetchImpl('/dashboard/api/external-trackers/vk/repos/clone', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ repoUrl }),
  });
  return response.json() as Promise<RepoCloneApiEnvelope<{ repo: { id: string; path: string; name: string; display_name: string; default_target_branch?: string | null } }>>;
}

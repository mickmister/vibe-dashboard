export interface RepoWithRemoteLinkFields {
  target_branch: string;
}

export function buildRepositoryTreeUrl(repo: RepoWithRemoteLinkFields): string | undefined {
  const remoteUrl = findRepoRemoteUrl(repo as unknown as Record<string, unknown>);
  const repoUrl = normalizeHostedRepoUrl(remoteUrl);
  if (!repoUrl) return undefined;
  const branch = formatHostedRepoTreeBranch(repo.target_branch);
  if (!branch) return undefined;
  return `${repoUrl}/tree/${encodeURIComponent(branch).replace(/%2F/g, '/')}`;
}

function findRepoRemoteUrl(repo: Record<string, unknown>): string | undefined {
  return [
    repo.githubUrl,
    repo.github_url,
    repo.htmlUrl,
    repo.html_url,
    repo.remoteUrl,
    repo.remote_url,
    repo.cloneUrl,
    repo.clone_url,
    repo.gitUrl,
    repo.git_url,
    repo.url,
  ].find((value): value is string => typeof value === 'string' && value.trim().length > 0);
}

function normalizeHostedRepoUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  const sshMatch = trimmed.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/);
  if (sshMatch) return `https://github.com/${sshMatch[1]}/${sshMatch[2]}`;
  try {
    const url = new URL(trimmed);
    if (url.hostname !== 'github.com') return undefined;
    const [owner, repo] = url.pathname.replace(/^\/+/, '').split('/');
    if (!(owner && repo)) return undefined;
    return `https://github.com/${owner}/${repo.replace(/\.git$/, '')}`;
  } catch {
    return undefined;
  }
}

function formatHostedRepoTreeBranch(branch: string): string {
  return branch.startsWith('origin/') ? branch.slice('origin/'.length) : branch;
}

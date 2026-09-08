import { describe, expect, it } from 'vitest';
import { buildRepositoryTreeUrl } from './repoRemoteLinks';

describe('repo remote links', () => {
  it('builds hosted tree links from SSH remotes and target branches', () => {
    expect(buildRepositoryTreeUrl({
      target_branch: 'vk/370d-allow-custom-ico',
      remote_url: 'git@github.com:mickmister/vibe-kanban-vscode-web.git',
    } as any)).toBe('https://github.com/mickmister/vibe-kanban-vscode-web/tree/vk/370d-allow-custom-ico');
  });

  it('returns undefined for unsupported or missing remotes', () => {
    expect(buildRepositoryTreeUrl({ target_branch: 'origin/main', remote_url: 'https://example.com/acme/repo.git' } as any)).toBeUndefined();
    expect(buildRepositoryTreeUrl({ target_branch: 'origin/main' })).toBeUndefined();
  });
});

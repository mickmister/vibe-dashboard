import { describe, expect, it } from 'vitest';

import { buildVardashWorkspaceRepoHref } from './SpacesOverview';

describe('SpacesOverview vardash entry point', () => {
  it('builds a workspace-repo scoped vardash route', () => {
    expect(buildVardashWorkspaceRepoHref('workspace 1', {
      id: 'repo/a',
      name: 'repo-name',
      display_name: 'Repo A',
    })).toBe('/dashboard/vardash?workspaceId=workspace+1&repoId=repo%2Fa&repoName=Repo+A');
  });
});

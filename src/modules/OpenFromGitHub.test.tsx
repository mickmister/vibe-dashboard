// @vitest-environment jsdom
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceState } from '../types';
import { OpenFromGitHub } from './OpenFromGitHub';
import { vkClient } from '../lib/vk-client';

vi.mock('../lib/vk-client', () => ({
  vkClient: {
    getPrInfo: vi.fn(),
    getWorkspaceSummaries: vi.fn(),
    getWorkspace: vi.fn(),
    getRepos: vi.fn(),
    getRepoRemotes: vi.fn(),
    createWorkspaceFromPr: vi.fn(),
  },
}));

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

const emptyWorkspace = {
  spaces: [{ id: 'space-a', name: 'A', icon: 'default', tabGroupIds: [] }],
  tabGroups: [],
  nextId: 1,
} satisfies WorkspaceState;

const workspaceWithOpenTab = {
  spaces: [
    { id: 'space-a', name: 'A', icon: 'default', tabGroupIds: ['tg-existing'] },
  ],
  tabGroups: [
    {
      id: 'tg-existing',
      label: 'Existing workspace',
      tabs: [{ id: 'tab-agent', title: 'Agent', url: '/workspaces/ws-1' }],
      pairs: [],
      order: 0,
      lastVisitedAt: '2026-06-22T00:00:00Z',
    },
  ],
  nextId: 2,
} satisfies WorkspaceState;

function renderOpenFromGithub(workspace: WorkspaceState) {
  const props = {
    workspace,
    addSpace: vi.fn(),
    deleteTabGroup: vi.fn(),
    addVKWorkspace: vi.fn(),
    selectSessionTabGroup: vi.fn(),
    selectSessionTab: vi.fn(),
  };

  const view = render(
    <MemoryRouter
      initialEntries={[
        '/dashboard?voyage=abc&open_from_github=https%3A%2F%2Fgithub.com%2FOwner%2FRepo%2Fpull%2F7',
      ]}
    >
      <OpenFromGitHub {...props} />
    </MemoryRouter>
  );

  return { ...view, props };
}

describe('OpenFromGitHub', () => {
  beforeEach(() => {
    vi.mocked(vkClient.getPrInfo).mockReset();
    vi.mocked(vkClient.getWorkspaceSummaries).mockReset();
    vi.mocked(vkClient.getWorkspace).mockReset();
    vi.mocked(vkClient.getRepos).mockReset();
    vi.mocked(vkClient.getRepoRemotes).mockReset();
    vi.mocked(vkClient.createWorkspaceFromPr).mockReset();
  });

  it('keeps resolving the requested URL when workspace state changes in flight', async () => {
    const prInfo = deferred<Awaited<ReturnType<typeof vkClient.getPrInfo>>>();
    vi.mocked(vkClient.getPrInfo).mockReturnValue(prInfo.promise);
    vi.mocked(vkClient.getWorkspaceSummaries).mockResolvedValue({
      summaries: [
        {
          workspace_id: 'ws-1',
          pr_number: 7,
          pr_url: 'https://github.com/owner/repo/pull/7',
          has_pending_approval: false,
          files_changed: null,
          lines_added: null,
          lines_removed: null,
          latest_process_status: null,
          has_running_dev_server: false,
          has_unseen_turns: false,
          pr_status: 'open',
        },
      ],
    });

    const { rerender, props } = renderOpenFromGithub(emptyWorkspace);

    await waitFor(() => expect(vkClient.getPrInfo).toHaveBeenCalledTimes(1));

    rerender(
      <MemoryRouter>
        <OpenFromGitHub {...props} workspace={workspaceWithOpenTab} />
      </MemoryRouter>
    );

    prInfo.resolve({
      number: 7,
      url: 'https://github.com/owner/repo/pull/7',
      status: 'open',
      title: 'Fix bug',
      base_branch: 'main',
      head_branch: 'fix-bug',
    });

    await waitFor(() => {
      expect(props.selectSessionTabGroup).toHaveBeenCalledWith(
        'space-a',
        'tg-existing',
      );
    });
    expect(vkClient.getWorkspace).not.toHaveBeenCalled();
  });
});

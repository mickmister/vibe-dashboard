// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceState } from "../types";
import { OpenFromGitHub } from "./OpenFromGitHub";
import { vkClient } from "../lib/vk-client";

vi.mock("../lib/vk-client", () => ({
  vkClient: {
    getPrInfo: vi.fn(),
    getWorkspaceSummaries: vi.fn(),
    getWorkspace: vi.fn(),
    getRepos: vi.fn(),
    getRepoRemotes: vi.fn(),
    getRepoBranches: vi.fn(),
    ensureGithubRepo: vi.fn(),
    createWorkspaceFromPr: vi.fn(),
    createWorkspaceFromIssue: vi.fn(),
    getGithubIssueWorkspaceMapping: vi.fn(),
    putGithubIssueWorkspaceMapping: vi.fn(),
    updateWorkspace: vi.fn(),
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
  spaces: [{ id: "space-a", name: "A", icon: "default", tabGroupIds: [] }],
  tabGroups: [],
  nextId: 1,
} satisfies WorkspaceState;

const workspaceWithOpenTab = {
  spaces: [
    { id: "space-a", name: "A", icon: "default", tabGroupIds: ["tg-existing"] },
  ],
  tabGroups: [
    {
      id: "tg-existing",
      label: "Existing workspace",
      tabs: [{ id: "tab-agent", title: "Agent", url: "/workspaces/ws-1" }],
      pairs: [],
      order: 0,
      lastVisitedAt: "2026-06-22T00:00:00Z",
    },
  ],
  nextId: 2,
} satisfies WorkspaceState;

function renderOpenFromGithub(
  workspace: WorkspaceState,
  githubUrl = "https://github.com/Owner/Repo/pull/7",
) {
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
        `/dashboard?voyage=abc&open_from_github=${encodeURIComponent(githubUrl)}`,
      ]}
    >
      <OpenFromGitHub {...props} />
    </MemoryRouter>,
  );

  return { ...view, props };
}

describe("OpenFromGitHub", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.mocked(vkClient.getPrInfo).mockReset();
    vi.mocked(vkClient.getWorkspaceSummaries).mockReset();
    vi.mocked(vkClient.getWorkspace).mockReset();
    vi.mocked(vkClient.getRepos).mockReset();
    vi.mocked(vkClient.getRepoRemotes).mockReset();
    vi.mocked(vkClient.getRepoBranches).mockReset();
    vi.mocked(vkClient.ensureGithubRepo).mockReset();
    vi.mocked(vkClient.createWorkspaceFromPr).mockReset();
    vi.mocked(vkClient.createWorkspaceFromIssue).mockReset();
    vi.mocked(vkClient.getGithubIssueWorkspaceMapping).mockReset();
    vi.mocked(vkClient.putGithubIssueWorkspaceMapping).mockReset();
    vi.mocked(vkClient.updateWorkspace).mockReset();
  });

  it("keeps resolving the requested URL when workspace state changes in flight", async () => {
    const prInfo = deferred<Awaited<ReturnType<typeof vkClient.getPrInfo>>>();
    vi.mocked(vkClient.getPrInfo).mockReturnValue(prInfo.promise);
    vi.mocked(vkClient.getWorkspaceSummaries).mockResolvedValue({
      summaries: [
        {
          workspace_id: "ws-1",
          pr_number: 7,
          pr_url: "https://github.com/owner/repo/pull/7",
          has_pending_approval: false,
          files_changed: null,
          lines_added: null,
          lines_removed: null,
          latest_process_status: null,
          has_running_dev_server: false,
          has_unseen_turns: false,
          pr_status: "open",
        },
      ],
    });

    const { rerender, props } = renderOpenFromGithub(emptyWorkspace);

    await waitFor(() => expect(vkClient.getPrInfo).toHaveBeenCalledTimes(1));

    rerender(
      <MemoryRouter>
        <OpenFromGitHub {...props} workspace={workspaceWithOpenTab} />
      </MemoryRouter>,
    );

    prInfo.resolve({
      number: 7,
      url: "https://github.com/owner/repo/pull/7",
      status: "open",
      title: "Fix bug",
      base_branch: "main",
      head_branch: "fix-bug",
    });

    await waitFor(() => {
      expect(props.selectSessionTabGroup).toHaveBeenCalledWith(
        "space-a",
        "tg-existing",
      );
    });
    expect(vkClient.getWorkspace).not.toHaveBeenCalled();
  });

  it("ensures an unregistered GitHub repo before asking where to open the PR", async () => {
    vi.mocked(vkClient.getPrInfo).mockResolvedValue({
      number: 7,
      url: "https://github.com/owner/repo/pull/7",
      status: "open",
      title: "Fix bug",
      base_branch: "main",
      head_branch: "fix-bug",
    });
    vi.mocked(vkClient.getWorkspaceSummaries).mockResolvedValue({
      summaries: [],
    });
    vi.mocked(vkClient.getRepos).mockResolvedValue([]);
    vi.mocked(vkClient.ensureGithubRepo).mockResolvedValue({
      repo: {
        id: "repo-1",
        name: "repo",
        display_name: "owner/repo",
        path: "/home/vkuser/repos/repo",
      },
      path: "/home/vkuser/repos/repo",
      cloned: true,
      refreshed: false,
      registered: true,
    });
    vi.mocked(vkClient.getRepoRemotes).mockResolvedValue([
      { name: "origin", url: "https://github.com/owner/repo.git" },
    ]);

    const { findByText } = renderOpenFromGithub(emptyWorkspace);

    await findByText("Open GitHub PR in space");
    expect(vkClient.ensureGithubRepo).toHaveBeenCalledWith(
      "https://github.com/owner/repo",
    );
    expect(vkClient.getRepoRemotes).toHaveBeenCalledWith("repo-1");
  });
  it("reuses an active persisted GitHub issue workspace mapping", async () => {
    vi.mocked(vkClient.getGithubIssueWorkspaceMapping).mockResolvedValue({
      mapping: {
        owner: "owner",
        repo: "repo",
        number: 7,
        normalizedIssueUrl: "https://github.com/owner/repo/issues/7",
        workspaceId: "ws-1",
        branch: "vk/issue-7",
        createdAt: "2026-06-22T00:00:00Z",
        updatedAt: "2026-06-22T00:00:00Z",
      },
    });
    vi.mocked(vkClient.getWorkspace).mockResolvedValue({
      id: "ws-1",
      task_id: "task-1",
      container_ref: "/tmp/ws-1",
      branch: "vk/issue-7",
      agent_working_dir: null,
      created_at: "2026-06-22T00:00:00Z",
      updated_at: "2026-06-22T00:00:00Z",
      archived: false,
      pinned: false,
      name: "Issue #7",
    });

    const { props } = renderOpenFromGithub(
      workspaceWithOpenTab,
      "https://github.com/OWNER/Repo/issues/7/",
    );

    await waitFor(() => {
      expect(props.selectSessionTabGroup).toHaveBeenCalledWith(
        "space-a",
        "tg-existing",
      );
    });
    expect(vkClient.createWorkspaceFromIssue).not.toHaveBeenCalled();
  });

  it("creates and persists a first GitHub issue workspace mapping", async () => {
    vi.mocked(vkClient.getGithubIssueWorkspaceMapping).mockResolvedValue({
      mapping: null,
    });
    vi.mocked(vkClient.getRepos).mockResolvedValue([
      {
        id: "repo-1",
        name: "repo",
        display_name: "Repo",
        default_target_branch: "origin/develop",
      },
    ]);
    vi.mocked(vkClient.getRepoRemotes).mockResolvedValue([
      { name: "origin", url: "https://github.com/owner/repo.git" },
    ]);
    vi.mocked(vkClient.getRepoBranches).mockResolvedValue([
      {
        name: "origin/main",
        is_current: false,
        is_remote: true,
        last_commit_date: "2026-06-22T00:00:00Z",
      },
    ]);
    vi.mocked(vkClient.createWorkspaceFromIssue).mockResolvedValue({
      workspace: {
        id: "ws-issue",
        task_id: "task-issue",
        container_ref: "/tmp/ws-issue",
        branch: "vk/issue-7",
        agent_working_dir: null,
        created_at: "2026-06-22T00:00:00Z",
        updated_at: "2026-06-22T00:00:00Z",
        archived: false,
        pinned: false,
        name: "Issue #7",
      },
    });
    vi.mocked(vkClient.putGithubIssueWorkspaceMapping).mockResolvedValue({
      mapping: null,
    });

    const { findByText, props } = renderOpenFromGithub(
      emptyWorkspace,
      "https://github.com/owner/repo/issues/7",
    );

    fireEvent.click(await findByText("A"));

    await waitFor(() => {
      expect(vkClient.createWorkspaceFromIssue).toHaveBeenCalledWith(
        expect.objectContaining({
          repo_id: "repo-1",
          target_branch: "origin/main",
          issue_url: "https://github.com/owner/repo/issues/7",
          issue_number: 7,
        }),
      );
    });
    expect(vkClient.putGithubIssueWorkspaceMapping).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "owner",
        repo: "repo",
        number: 7,
        workspaceId: "ws-issue",
        branch: "vk/issue-7",
      }),
    );
    expect(props.addVKWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ taskAttemptId: "ws-issue" }),
    );
  });

  it("falls back to the repo default target branch when origin/main is unavailable", async () => {
    vi.mocked(vkClient.getGithubIssueWorkspaceMapping).mockResolvedValue({
      mapping: null,
    });
    vi.mocked(vkClient.getRepos).mockResolvedValue([
      {
        id: "repo-1",
        name: "repo",
        display_name: "Repo",
        default_target_branch: "origin/develop",
      },
    ]);
    vi.mocked(vkClient.getRepoRemotes).mockResolvedValue([
      { name: "origin", url: "https://github.com/owner/repo.git" },
    ]);
    vi.mocked(vkClient.getRepoBranches).mockResolvedValue([
      {
        name: "origin/develop",
        is_current: false,
        is_remote: true,
        last_commit_date: "2026-06-22T00:00:00Z",
      },
    ]);
    vi.mocked(vkClient.createWorkspaceFromIssue).mockResolvedValue({
      workspace: {
        id: "ws-issue",
        task_id: "task-issue",
        container_ref: "/tmp/ws-issue",
        branch: "vk/issue-7",
        agent_working_dir: null,
        created_at: "2026-06-22T00:00:00Z",
        updated_at: "2026-06-22T00:00:00Z",
        archived: false,
        pinned: false,
        name: "Issue #7",
      },
    });
    vi.mocked(vkClient.putGithubIssueWorkspaceMapping).mockResolvedValue({
      mapping: null,
    });

    const { findByText } = renderOpenFromGithub(
      emptyWorkspace,
      "https://github.com/owner/repo/issues/7",
    );

    fireEvent.click(await findByText("A"));

    await waitFor(() => {
      expect(vkClient.createWorkspaceFromIssue).toHaveBeenCalledWith(
        expect.objectContaining({
          target_branch: "origin/develop",
        }),
      );
    });
  });

  it("lets issue URLs choose among multiple matching repos before creating", async () => {
    vi.mocked(vkClient.getGithubIssueWorkspaceMapping).mockResolvedValue({
      mapping: null,
    });
    vi.mocked(vkClient.getRepos).mockResolvedValue([
      { id: "repo-1", name: "repo-a", display_name: "Repo A" },
      { id: "repo-2", name: "repo-b", display_name: "Repo B" },
    ]);
    vi.mocked(vkClient.getRepoRemotes).mockImplementation(async (repoId) => [
      {
        name: "origin",
        url:
          repoId === "repo-1"
            ? "https://github.com/owner/repo.git"
            : "git@github.com:owner/repo.git",
      },
    ]);
    vi.mocked(vkClient.getRepoBranches).mockResolvedValue([
      {
        name: "origin/main",
        is_current: false,
        is_remote: true,
        last_commit_date: "2026-06-22T00:00:00Z",
      },
    ]);
    vi.mocked(vkClient.createWorkspaceFromIssue).mockResolvedValue({
      workspace: {
        id: "ws-issue",
        task_id: "task-issue",
        container_ref: "/tmp/ws-issue",
        branch: "vk/issue-7",
        agent_working_dir: null,
        created_at: "2026-06-22T00:00:00Z",
        updated_at: "2026-06-22T00:00:00Z",
        archived: false,
        pinned: false,
        name: "Issue #7",
      },
    });
    vi.mocked(vkClient.putGithubIssueWorkspaceMapping).mockResolvedValue({
      mapping: null,
    });

    const { findByText } = renderOpenFromGithub(
      emptyWorkspace,
      "https://github.com/owner/repo/issues/7",
    );

    await findByText("Choose repository");
    fireEvent.click(await findByText("Repo B"));
    fireEvent.click(await findByText("A"));

    await waitFor(() => {
      expect(vkClient.createWorkspaceFromIssue).toHaveBeenCalledWith(
        expect.objectContaining({ repo_id: "repo-2" }),
      );
    });
    expect(vkClient.putGithubIssueWorkspaceMapping).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "ws-issue" }),
    );
  });

  it("does not let an unmounted in-flight issue lookup update or open workspaces", async () => {
    const mapping =
      deferred<
        Awaited<ReturnType<typeof vkClient.getGithubIssueWorkspaceMapping>>
      >();
    vi.mocked(vkClient.getGithubIssueWorkspaceMapping).mockReturnValue(
      mapping.promise,
    );

    const { props, unmount } = renderOpenFromGithub(
      workspaceWithOpenTab,
      "https://github.com/owner/repo/issues/7",
    );

    await waitFor(() => {
      expect(vkClient.getGithubIssueWorkspaceMapping).toHaveBeenCalledTimes(1);
    });
    unmount();
    mapping.resolve({
      mapping: {
        owner: "owner",
        repo: "repo",
        number: 7,
        normalizedIssueUrl: "https://github.com/owner/repo/issues/7",
        workspaceId: "ws-1",
        branch: "vk/issue-7",
        createdAt: "2026-06-22T00:00:00Z",
        updatedAt: "2026-06-22T00:00:00Z",
      },
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(vkClient.getWorkspace).not.toHaveBeenCalled();
    expect(props.selectSessionTabGroup).not.toHaveBeenCalled();
    expect(props.addVKWorkspace).not.toHaveBeenCalled();
  });

  it("does not persist or open an issue workspace if unmounted during creation", async () => {
    vi.mocked(vkClient.getGithubIssueWorkspaceMapping).mockResolvedValue({
      mapping: null,
    });
    vi.mocked(vkClient.getRepos).mockResolvedValue([
      { id: "repo-1", name: "repo", display_name: "Repo" },
    ]);
    vi.mocked(vkClient.getRepoRemotes).mockResolvedValue([
      { name: "origin", url: "https://github.com/owner/repo.git" },
    ]);
    vi.mocked(vkClient.getRepoBranches).mockResolvedValue([
      {
        name: "origin/main",
        is_current: false,
        is_remote: true,
        last_commit_date: "2026-06-22T00:00:00Z",
      },
    ]);
    const created =
      deferred<Awaited<ReturnType<typeof vkClient.createWorkspaceFromIssue>>>();
    vi.mocked(vkClient.createWorkspaceFromIssue).mockReturnValue(
      created.promise,
    );

    const { findByText, props, unmount } = renderOpenFromGithub(
      emptyWorkspace,
      "https://github.com/owner/repo/issues/7",
    );

    fireEvent.click(await findByText("A"));
    await waitFor(() => {
      expect(vkClient.createWorkspaceFromIssue).toHaveBeenCalledTimes(1);
    });
    unmount();
    created.resolve({
      workspace: {
        id: "ws-issue",
        task_id: "task-issue",
        container_ref: "/tmp/ws-issue",
        branch: "vk/issue-7",
        agent_working_dir: null,
        created_at: "2026-06-22T00:00:00Z",
        updated_at: "2026-06-22T00:00:00Z",
        archived: false,
        pinned: false,
        name: "Issue #7",
      },
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(vkClient.putGithubIssueWorkspaceMapping).not.toHaveBeenCalled();
    expect(props.addVKWorkspace).not.toHaveBeenCalled();
    expect(props.selectSessionTab).not.toHaveBeenCalled();
  });

  it("confirms before reopening and unarchiving a persisted archived issue workspace", async () => {
    vi.mocked(vkClient.getGithubIssueWorkspaceMapping).mockResolvedValue({
      mapping: {
        owner: "owner",
        repo: "repo",
        number: 7,
        normalizedIssueUrl: "https://github.com/owner/repo/issues/7",
        workspaceId: "ws-archived",
        branch: "vk/issue-7",
        createdAt: "2026-06-22T00:00:00Z",
        updatedAt: "2026-06-22T00:00:00Z",
      },
    });
    const archivedWorkspace = {
      id: "ws-archived",
      task_id: "task-archived",
      container_ref: "/tmp/ws-archived",
      branch: "vk/issue-7",
      agent_working_dir: null,
      created_at: "2026-06-22T00:00:00Z",
      updated_at: "2026-06-22T00:00:00Z",
      archived: true,
      pinned: false,
      name: "Issue #7",
    };
    vi.mocked(vkClient.getWorkspace).mockResolvedValue(archivedWorkspace);
    vi.mocked(vkClient.updateWorkspace).mockResolvedValue({
      ...archivedWorkspace,
      archived: false,
    });

    const { findByText } = renderOpenFromGithub(
      emptyWorkspace,
      "https://github.com/owner/repo/issues/7",
    );

    fireEvent.click(await findByText("Reopen workspace"));
    fireEvent.click(await findByText("A"));

    await waitFor(() => {
      expect(vkClient.updateWorkspace).toHaveBeenCalledWith("ws-archived", {
        archived: false,
      });
    });
    expect(vkClient.createWorkspaceFromIssue).not.toHaveBeenCalled();
  });

  it("shows an explicit error when a persisted issue workspace was deleted", async () => {
    vi.mocked(vkClient.getGithubIssueWorkspaceMapping).mockResolvedValue({
      mapping: {
        owner: "owner",
        repo: "repo",
        number: 7,
        normalizedIssueUrl: "https://github.com/owner/repo/issues/7",
        workspaceId: "ws-deleted",
        branch: "vk/issue-7",
        createdAt: "2026-06-22T00:00:00Z",
        updatedAt: "2026-06-22T00:00:00Z",
      },
    });
    vi.mocked(vkClient.getWorkspace).mockRejectedValue(new Error("not found"));

    const { findByText } = renderOpenFromGithub(
      emptyWorkspace,
      "https://github.com/owner/repo/issues/7",
    );

    await findByText("Issue workspace no longer exists");
    expect(vkClient.createWorkspaceFromIssue).not.toHaveBeenCalled();
  });
});

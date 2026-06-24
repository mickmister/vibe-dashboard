// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SavedWorkspaceSession, WorkspaceState } from "../types";
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
    createWorkspaceFromTreeBlob: vi.fn(),
    getGitBranchesContainingCommit: vi.fn(),
    getGithubIssueWorkspaceMapping: vi.fn(),
    putGithubIssueWorkspaceMapping: vi.fn(),
    deleteGithubIssueWorkspaceMapping: vi.fn(),
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

function createOpenFromGithubProps(
  workspace: WorkspaceState,
  savedVoyages: SavedWorkspaceSession[] = [],
) {
  return {
    workspace,
    savedVoyages,
    addSpace: vi.fn(),
    deleteTabGroup: vi.fn(),
    addVKWorkspace: vi.fn(),
    selectSessionTabGroup: vi.fn(),
    selectSessionTab: vi.fn(),
  };
}

function renderOpenFromGithub(
  workspace: WorkspaceState,
  githubUrl = "https://github.com/Owner/Repo/pull/7",
  savedVoyages: SavedWorkspaceSession[] = [],
) {
  return renderOpenFromGithubAt(
    workspace,
    `/dashboard?voyage=abc&open_from_github=${encodeURIComponent(githubUrl)}`,
    savedVoyages,
  );
}

function renderOpenFromGithubAt(
  workspace: WorkspaceState,
  initialEntry: string,
  savedVoyages: SavedWorkspaceSession[] = [],
) {
  const props = createOpenFromGithubProps(workspace, savedVoyages);

  const view = render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <OpenFromGitHub {...props} />
    </MemoryRouter>,
  );

  return { ...view, props };
}

function renderOpenFromGithubWithLocation(
  workspace: WorkspaceState,
  initialEntry: string,
  savedVoyages: SavedWorkspaceSession[] = [],
) {
  const locations: string[] = [];

  function LocationProbe() {
    const location = useLocation();
    locations.push(`${location.pathname}${location.search}${location.hash}`);
    return null;
  }

  const props = createOpenFromGithubProps(workspace, savedVoyages);

  const view = render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <LocationProbe />
      <OpenFromGitHub {...props} />
    </MemoryRouter>,
  );

  const latestLocation = () => locations.at(-1) || "";

  return { ...view, props, latestLocation };
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
    vi.mocked(vkClient.createWorkspaceFromTreeBlob).mockReset();
    vi.mocked(vkClient.getGitBranchesContainingCommit).mockReset();
    vi.mocked(vkClient.getGithubIssueWorkspaceMapping).mockReset();
    vi.mocked(vkClient.putGithubIssueWorkspaceMapping).mockReset();
    vi.mocked(vkClient.deleteGithubIssueWorkspaceMapping).mockReset();
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

  it("asks before opening an existing PR craft in its saved voyage", async () => {
    vi.mocked(vkClient.getPrInfo).mockResolvedValue({
      number: 7,
      url: "https://github.com/owner/repo/pull/7",
      status: "open",
      title: "Fix bug",
      base_branch: "main",
      head_branch: "fix-bug",
    });
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

    const savedVoyages: SavedWorkspaceSession[] = [
      {
        id: "voyage-1",
        slug: "existing-voyage",
        name: "Existing Voyage",
        createdAt: "2026-06-22T00:00:00Z",
        updatedAt: "2026-06-22T00:00:00Z",
        activeVoyageEntryId: "ve-existing",
        voyageEntries: [
          {
            id: "ve-existing",
            tabGroupId: "tg-existing",
            viewIds: ["tab-agent"],
          },
        ],
        activeSpaceId: "space-a",
        activeTabGroupId: "tg-existing",
        activeItemsByVoyageEntryId: { "ve-existing": "tab-agent" },
        visitedTabGroupIds: ["tg-existing"],
      },
    ];

    const githubUrl = encodeURIComponent(
      "https://github.com/Owner/Repo/pull/7",
    );
    const { findByText, latestLocation, props } =
      renderOpenFromGithubWithLocation(
        workspaceWithOpenTab,
        `/dashboard?open_from_github=${githubUrl}&voyage=arbitrary`,
        savedVoyages,
      );

    await findByText("Open existing PR workspace?");
    expect(props.selectSessionTabGroup).not.toHaveBeenCalled();

    fireEvent.click(await findByText("Open existing Voyage"));

    await waitFor(() => {
      const location = latestLocation();
      expect(location).toContain("voyage=existing-voyage");
      expect(location).toContain("craft=existing-workspace");
      expect(location).not.toContain("open_from_github");
    });
    expect(props.selectSessionTabGroup).not.toHaveBeenCalled();
  });

  it("cleans only open_from_github after selecting an already-open workspace", async () => {
    vi.mocked(vkClient.getPrInfo).mockResolvedValue({
      number: 7,
      url: "https://github.com/owner/repo/pull/7",
      status: "open",
      title: "Fix bug",
      base_branch: "main",
      head_branch: "fix-bug",
    });
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

    const githubUrl = encodeURIComponent(
      "https://github.com/Owner/Repo/pull/7",
    );
    const { latestLocation, props } = renderOpenFromGithubWithLocation(
      workspaceWithOpenTab,
      `/dashboard?utm=keep&open_from_github=${githubUrl}&voyage=abc`,
    );

    await waitFor(() => {
      expect(props.selectSessionTabGroup).toHaveBeenCalledWith(
        "space-a",
        "tg-existing",
      );
    });
    await waitFor(() => {
      const search = new URL(latestLocation(), "https://vd.test").searchParams;
      expect(search.get("open_from_github")).toBeNull();
      expect(search.get("utm")).toBe("keep");
      expect(search.get("voyage")).toBe("abc");
    });
    expect(vkClient.getPrInfo).toHaveBeenCalledTimes(1);
  });

  it("does not start URL-driven orchestration when the cleaned URL is refreshed", async () => {
    renderOpenFromGithubAt(
      workspaceWithOpenTab,
      "/dashboard?utm=keep&voyage=abc",
    );

    await Promise.resolve();

    expect(vkClient.getPrInfo).not.toHaveBeenCalled();
    expect(vkClient.ensureGithubRepo).not.toHaveBeenCalled();
  });

  it("cleans only open_from_github after an unsupported URL error", async () => {
    const { findByText, latestLocation } = renderOpenFromGithubWithLocation(
      emptyWorkspace,
      `/dashboard?utm=keep&open_from_github=${encodeURIComponent(
        "https://example.com/nope",
      )}&voyage=abc`,
    );

    await findByText("Unsupported GitHub URL");
    await waitFor(() => {
      const search = new URL(latestLocation(), "https://vd.test").searchParams;
      expect(search.get("open_from_github")).toBeNull();
      expect(search.get("utm")).toBe("keep");
      expect(search.get("voyage")).toBe("abc");
    });
  });

  it("cancels in-flight URL orchestration and preserves unrelated query params", async () => {
    const prInfo = deferred<Awaited<ReturnType<typeof vkClient.getPrInfo>>>();
    vi.mocked(vkClient.getPrInfo).mockReturnValue(prInfo.promise);

    const githubUrl = encodeURIComponent(
      "https://github.com/Owner/Repo/pull/7",
    );
    const { findByText, latestLocation, props } =
      renderOpenFromGithubWithLocation(
        emptyWorkspace,
        `/dashboard?utm=keep&open_from_github=${githubUrl}&voyage=abc`,
      );

    fireEvent.click(await findByText("Cancel"));

    await waitFor(() => {
      const search = new URL(latestLocation(), "https://vd.test").searchParams;
      expect(search.get("open_from_github")).toBeNull();
      expect(search.get("utm")).toBe("keep");
      expect(search.get("voyage")).toBe("abc");
    });

    prInfo.resolve({
      number: 7,
      url: "https://github.com/owner/repo/pull/7",
      status: "open",
      title: "Fix bug",
      base_branch: "main",
      head_branch: "fix-bug",
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(vkClient.getWorkspaceSummaries).not.toHaveBeenCalled();
    expect(props.addVKWorkspace).not.toHaveBeenCalled();
    expect(props.selectSessionTabGroup).not.toHaveBeenCalled();
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

  it("shows an unsupported error instead of throwing for malformed tree/blob encodings", async () => {
    const { findByText } = renderOpenFromGithub(
      emptyWorkspace,
      "https://github.com/owner/repo/tree/%E0%A4%A",
    );

    await findByText("Unsupported GitHub URL");
    expect(vkClient.getRepos).not.toHaveBeenCalled();
    expect(vkClient.createWorkspaceFromTreeBlob).not.toHaveBeenCalled();
  });

  it("creates a workspace branch from a tree URL remote branch and shows V1 limitation copy", async () => {
    vi.mocked(vkClient.getRepos).mockResolvedValue([
      { id: "repo-1", name: "repo", display_name: "Repo" },
    ]);
    vi.mocked(vkClient.getRepoRemotes).mockResolvedValue([
      { name: "origin", url: "https://github.com/owner/repo.git" },
    ]);
    vi.mocked(vkClient.getRepoBranches).mockResolvedValue([
      {
        name: "origin/feature/demo",
        is_current: false,
        is_remote: true,
        last_commit_date: "2026-06-22T00:00:00Z",
      },
    ]);
    vi.mocked(vkClient.createWorkspaceFromTreeBlob).mockResolvedValue({
      workspace: {
        id: "ws-tree",
        task_id: "task-tree",
        container_ref: "/tmp/ws-tree",
        branch: "vk/tree",
        agent_working_dir: null,
        created_at: "2026-06-22T00:00:00Z",
        updated_at: "2026-06-22T00:00:00Z",
        archived: false,
        pinned: false,
        name: "Tree",
      },
    });

    const { findByText } = renderOpenFromGithub(
      emptyWorkspace,
      "https://github.com/owner/repo/tree/feature/demo/src",
    );

    await findByText(/V1 creates a new VK workspace branch from origin\/feature\/demo/);
    fireEvent.click(await findByText("A"));

    await waitFor(() => {
      expect(vkClient.createWorkspaceFromTreeBlob).toHaveBeenCalledWith(
        expect.objectContaining({
          repo_id: "repo-1",
          target_branch: "origin/feature/demo",
          kind: "tree",
          path: "src",
        }),
      );
    });
  });

  it("lets tree/blob URLs choose among multiple matching repos before creating", async () => {
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
    vi.mocked(vkClient.getRepoBranches).mockImplementation(async (repoId) =>
      repoId === "repo-2"
        ? [
            {
              name: "origin/feature/demo",
              is_current: false,
              is_remote: true,
              last_commit_date: "2026-06-22T00:00:00Z",
            },
          ]
        : [],
    );
    vi.mocked(vkClient.createWorkspaceFromTreeBlob).mockResolvedValue({
      workspace: {
        id: "ws-tree",
        task_id: "task-tree",
        container_ref: "/tmp/ws-tree",
        branch: "vk/tree",
        agent_working_dir: null,
        created_at: "2026-06-22T00:00:00Z",
        updated_at: "2026-06-22T00:00:00Z",
        archived: false,
        pinned: false,
        name: "Tree",
      },
    });

    const { findByText } = renderOpenFromGithub(
      emptyWorkspace,
      "https://github.com/owner/repo/tree/feature/demo/src",
    );

    await findByText("Choose repository");
    fireEvent.click(await findByText("Repo B"));
    await findByText(/V1 creates a new VK workspace branch from origin\/feature\/demo/);
    fireEvent.click(await findByText("A"));

    await waitFor(() => {
      expect(vkClient.getRepoBranches).toHaveBeenCalledWith("repo-2");
      expect(vkClient.createWorkspaceFromTreeBlob).toHaveBeenCalledWith(
        expect.objectContaining({
          repo_id: "repo-2",
          target_branch: "origin/feature/demo",
          path: "src",
        }),
      );
    });
  });

  it("shows an actionable error when a tree/blob ref is neither branch nor commit", async () => {
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

    const { findAllByText, findByText } = renderOpenFromGithub(
      emptyWorkspace,
      "https://github.com/owner/repo/tree/v1.0.0",
    );

    await findByText("Unsupported GitHub ref");
    expect(
      await findAllByText(/Tags and missing refs are unsupported/),
    ).not.toHaveLength(0);
    expect(vkClient.getGitBranchesContainingCommit).not.toHaveBeenCalled();
    expect(vkClient.createWorkspaceFromTreeBlob).not.toHaveBeenCalled();
  });

  it("ensures an unregistered repo for blob URLs and includes blob path context", async () => {
    vi.mocked(vkClient.getRepos).mockResolvedValue([]);
    vi.mocked(vkClient.ensureGithubRepo).mockResolvedValue({
      repo: { id: "repo-1", name: "repo", display_name: "owner/repo" },
      path: "/home/vkuser/repos/repo",
      cloned: true,
      refreshed: false,
      registered: true,
    });
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
    vi.mocked(vkClient.createWorkspaceFromTreeBlob).mockResolvedValue({
      workspace: {
        id: "ws-blob",
        task_id: "task-blob",
        container_ref: "/tmp/ws-blob",
        branch: "vk/blob",
        agent_working_dir: null,
        created_at: "2026-06-22T00:00:00Z",
        updated_at: "2026-06-22T00:00:00Z",
        archived: false,
        pinned: false,
        name: "Blob",
      },
    });

    const { findByText } = renderOpenFromGithub(
      emptyWorkspace,
      "https://github.com/owner/repo/blob/main/src/file.ts",
    );

    await findByText(/Initial prompt includes path/);
    fireEvent.click(await findByText("A"));

    await waitFor(() => {
      expect(vkClient.ensureGithubRepo).toHaveBeenCalledWith(
        "https://github.com/owner/repo",
      );
      expect(vkClient.createWorkspaceFromTreeBlob).toHaveBeenCalledWith(
        expect.objectContaining({ path: "src/file.ts" }),
      );
    });
  });

  it("uses origin/main as a safe best guess for commit permalink branches", async () => {
    vi.mocked(vkClient.getRepos).mockResolvedValue([
      {
        id: "repo-1",
        name: "repo",
        display_name: "Repo",
        default_target_branch: "origin/main",
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
    vi.mocked(vkClient.getGitBranchesContainingCommit).mockResolvedValue({
      branches: ["origin/main", "origin/release"],
    });
    vi.mocked(vkClient.createWorkspaceFromTreeBlob).mockResolvedValue({
      workspace: {
        id: "ws-sha",
        task_id: "task-sha",
        container_ref: "/tmp/ws-sha",
        branch: "vk/sha",
        agent_working_dir: null,
        created_at: "2026-06-22T00:00:00Z",
        updated_at: "2026-06-22T00:00:00Z",
        archived: false,
        pinned: false,
        name: "Sha",
      },
    });

    const sha = "0123456789abcdef0123456789abcdef01234567";
    const { findByText } = renderOpenFromGithub(
      emptyWorkspace,
      `https://github.com/owner/repo/blob/${sha}/src/file.ts`,
    );

    fireEvent.click(await findByText("A"));

    await waitFor(() => {
      expect(vkClient.createWorkspaceFromTreeBlob).toHaveBeenCalledWith(
        expect.objectContaining({
          target_branch: "origin/main",
          permalink_commit: sha,
        }),
      );
    });
  });

  it("prompts for a branch base when a commit permalink is ambiguous", async () => {
    vi.mocked(vkClient.getRepos).mockResolvedValue([
      { id: "repo-1", name: "repo", display_name: "Repo" },
    ]);
    vi.mocked(vkClient.getRepoRemotes).mockResolvedValue([
      { name: "origin", url: "https://github.com/owner/repo.git" },
    ]);
    vi.mocked(vkClient.getRepoBranches).mockResolvedValue([]);
    vi.mocked(vkClient.getGitBranchesContainingCommit).mockResolvedValue({
      branches: ["origin/a", "origin/b"],
    });
    vi.mocked(vkClient.createWorkspaceFromTreeBlob).mockResolvedValue({
      workspace: {
        id: "ws-ambiguous",
        task_id: "task-ambiguous",
        container_ref: "/tmp/ws-ambiguous",
        branch: "vk/ambiguous",
        agent_working_dir: null,
        created_at: "2026-06-22T00:00:00Z",
        updated_at: "2026-06-22T00:00:00Z",
        archived: false,
        pinned: false,
        name: "Ambiguous",
      },
    });

    const { findByText } = renderOpenFromGithub(
      emptyWorkspace,
      "https://github.com/owner/repo/tree/0123456789abcdef0123456789abcdef01234567",
    );

    await findByText("Choose branch base");
    fireEvent.click(await findByText("origin/b"));
    fireEvent.click(await findByText("A"));

    await waitFor(() => {
      expect(vkClient.createWorkspaceFromTreeBlob).toHaveBeenCalledWith(
        expect.objectContaining({ target_branch: "origin/b" }),
      );
    });
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

  it("repairs a deleted persisted issue workspace mapping before creating a replacement", async () => {
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
    vi.mocked(vkClient.deleteGithubIssueWorkspaceMapping).mockResolvedValue({
      deleted: true,
    });
    vi.mocked(vkClient.getRepos).mockResolvedValue([
      { id: "repo-1", name: "repo-a", display_name: "Repo A" },
    ]);
    vi.mocked(vkClient.getRepoRemotes).mockResolvedValue([
      { name: "origin", url: "https://github.com/owner/repo.git" },
    ]);

    const { findByText } = renderOpenFromGithub(
      emptyWorkspace,
      "https://github.com/owner/repo/issues/7",
    );

    await findByText("Issue workspace no longer exists");
    expect(vkClient.createWorkspaceFromIssue).not.toHaveBeenCalled();

    fireEvent.click(await findByText("Forget mapping and create replacement"));

    await findByText("Open GitHub issue in space");
    expect(vkClient.deleteGithubIssueWorkspaceMapping).toHaveBeenCalledWith({
      owner: "owner",
      repo: "repo",
      number: 7,
    });
    expect(vkClient.getRepos).toHaveBeenCalled();
  });
});

import { describe, expect, it } from "vitest";
import {
  findMatchingRepoRemotes,
  findOpenWorkspaceLocation,
  findWorkspaceIdForPr,
  getOpenFromGithubUrl,
  normalizeGithubIssueUrl,
  normalizeGithubRepoIdentity,
  parseGithubIssueUrl,
  parseGithubOpenUrl,
  parseGithubPrUrl,
  removeOpenFromGithubParam,
} from "./openFromGithub";
import type { WorkspaceState } from "../types";

describe("openFromGithub", () => {
  it("reads and removes only the open_from_github query param", () => {
    const encoded = encodeURIComponent(
      "https://github.com/Owner/Repo/pull/123",
    );
    expect(
      getOpenFromGithubUrl(`?voyage=abc&open_from_github=${encoded}`),
    ).toBe("https://github.com/Owner/Repo/pull/123");
    expect(
      removeOpenFromGithubParam(`?voyage=abc&open_from_github=${encoded}`),
    ).toBe("?voyage=abc");
  });

  it("parses GitHub pull request URLs and rejects other URL shapes", () => {
    expect(parseGithubPrUrl("https://github.com/Owner/Repo/pull/123")).toEqual({
      owner: "Owner",
      repo: "Repo",
      number: 123,
      normalizedRepo: "owner/repo",
      normalizedPrUrl: "https://github.com/owner/repo/pull/123",
    });
    expect(
      parseGithubPrUrl("https://github.com/owner/repo/issues/123"),
    ).toBeNull();
    expect(
      parseGithubPrUrl("https://gitlab.com/owner/repo/pull/123"),
    ).toBeNull();
    expect(parseGithubPrUrl("not a url")).toBeNull();
  });

  it("parses and normalizes GitHub issue URLs case-insensitively across URL variants", () => {
    expect(
      parseGithubIssueUrl("https://github.com/Owner/Repo/issues/123/"),
    ).toEqual({
      owner: "Owner",
      repo: "Repo",
      number: 123,
      normalizedRepo: "owner/repo",
      normalizedIssueUrl: "https://github.com/owner/repo/issues/123",
    });
    expect(
      normalizeGithubIssueUrl("https://github.com/OWNER/Repo/issues/123/?x=1"),
    ).toBe("https://github.com/owner/repo/issues/123");
    expect(
      parseGithubOpenUrl("https://github.com/Owner/Repo/issues/123")?.type,
    ).toBe("issue");
    expect(
      parseGithubIssueUrl("https://github.com/owner/repo/pull/123"),
    ).toBeNull();
  });

  it("normalizes common GitHub remote URL formats", () => {
    expect(
      normalizeGithubRepoIdentity("https://github.com/Owner/Repo.git"),
    ).toBe("owner/repo");
    expect(normalizeGithubRepoIdentity("git@github.com:Owner/Repo.git")).toBe(
      "owner/repo",
    );
    expect(
      normalizeGithubRepoIdentity("ssh://git@github.com/Owner/Repo.git"),
    ).toBe("owner/repo");
  });

  it("matches registered VK repos by GitHub remote identity", () => {
    const repos = [
      { id: "repo-1", name: "repo", display_name: "Repo" },
      { id: "repo-2", name: "other", display_name: "Other" },
    ];
    const remotesByRepoId = new Map([
      ["repo-1", [{ name: "origin", url: "git@github.com:Owner/Repo.git" }]],
      [
        "repo-2",
        [{ name: "origin", url: "https://github.com/Owner/Other.git" }],
      ],
    ]);
    const parsed = parseGithubPrUrl("https://github.com/owner/repo/pull/5");

    expect(parsed).not.toBeNull();
    expect(findMatchingRepoRemotes(repos, remotesByRepoId, parsed!)).toEqual([
      {
        repo: repos[0],
        remote: { name: "origin", url: "git@github.com:Owner/Repo.git" },
      },
    ]);
  });

  it("dedupes workspaces by PR URL first and repo/number second", () => {
    const parsed = parseGithubPrUrl("https://github.com/owner/repo/pull/7");
    expect(parsed).not.toBeNull();

    expect(
      findWorkspaceIdForPr(
        [
          {
            workspace_id: "workspace-1",
            pr_number: 7,
            pr_url: "https://github.com/OWNER/REPO/pull/7",
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
        parsed!,
      ),
    ).toBe("workspace-1");
  });

  it("finds the most recently visited open VD craft for a workspace id", () => {
    const workspace = {
      spaces: [
        { id: "space-a", name: "A", icon: "default", tabGroupIds: ["tg-old"] },
        { id: "space-b", name: "B", icon: "default", tabGroupIds: ["tg-new"] },
      ],
      tabGroups: [
        {
          id: "tg-old",
          label: "Old",
          tabs: [{ id: "tab-old", title: "Agent", url: "/workspaces/ws-1" }],
          pairs: [],
          order: 0,
          lastVisitedAt: "2026-01-01T00:00:00Z",
        },
        {
          id: "tg-new",
          label: "New",
          tabs: [{ id: "tab-new", title: "Agent", url: "/workspaces/ws-1" }],
          pairs: [],
          order: 0,
          lastVisitedAt: "2026-01-02T00:00:00Z",
        },
      ],
      nextId: 3,
    } satisfies WorkspaceState;

    expect(findOpenWorkspaceLocation(workspace, "ws-1")).toEqual({
      spaceId: "space-b",
      tabGroupId: "tg-new",
      lastVisitedAt: "2026-01-02T00:00:00Z",
    });
  });
});

describe("openFromGithub tree/blob", () => {
  it("parses tree and blob URLs", () => {
    expect(
      parseGithubOpenUrl("https://github.com/Owner/Repo/tree/feature/demo/src"),
    ).toMatchObject({
      type: "tree-blob",
      target: {
        kind: "tree",
        normalizedRepo: "owner/repo",
        segments: ["feature", "demo", "src"],
      },
    });
    expect(
      parseGithubOpenUrl("https://github.com/Owner/Repo/blob/main/src/a.ts"),
    ).toMatchObject({ type: "tree-blob" });
  });

  it("rejects tree/blob URLs with malformed percent-encoded segments", () => {
    expect(
      parseGithubOpenUrl("https://github.com/owner/repo/tree/%E0%A4%A"),
    ).toBeNull();
  });

  it("resolves branch names with slashes by longest branch match and prefers origin", async () => {
    const mod = await import("./openFromGithub");
    const target = mod.parseGithubTreeBlobUrl(
      "https://github.com/owner/repo/blob/feature/long/name/src/file.ts",
    );
    expect(target).not.toBeNull();
    const result = mod.resolveGithubTreeBlobBranch(
      target!,
      [
        {
          name: "origin/feature",
          is_current: false,
          is_remote: true,
          last_commit_date: "2026-06-22T00:00:00Z",
        },
        {
          name: "origin/feature/long/name",
          is_current: false,
          is_remote: true,
          last_commit_date: "2026-06-22T00:00:00Z",
        },
      ],
      "origin",
    );
    expect(result).toMatchObject({
      targetBranch: "origin/feature/long/name",
      resolved: { ref: "feature/long/name", path: "src/file.ts" },
    });
  });

  it("does not resolve tree/blob branches from non-selected remotes", async () => {
    const mod = await import("./openFromGithub");
    const target = mod.parseGithubTreeBlobUrl(
      "https://github.com/owner/repo/blob/feature/demo/src/file.ts",
    );
    expect(target).not.toBeNull();

    expect(
      mod.resolveGithubTreeBlobBranch(
        target!,
        [
          {
            name: "origin/feature/demo",
            is_current: false,
            is_remote: true,
            last_commit_date: "2026-06-22T00:00:00Z",
          },
        ],
        "upstream",
      ),
    ).toBeNull();
  });

  it("chooses safe branch guesses for commit permalinks", async () => {
    const mod = await import("./openFromGithub");
    expect(
      mod.chooseBestContainingBranch(
        ["origin/main", "origin/release"],
        "origin/main",
      ),
    ).toBe("origin/main");
    expect(mod.chooseBestContainingBranch(["origin/release"], "origin/main")).toBe(
      "origin/release",
    );
    expect(
      mod.chooseBestContainingBranch(["origin/a", "origin/b"], "origin/main"),
    ).toBeNull();
  });

  it("chooses commit permalink branches from the selected remote only", async () => {
    const mod = await import("./openFromGithub");

    expect(
      mod.chooseBestContainingBranch(
        ["origin/main", "upstream/main", "upstream/release"],
        "origin/main",
        "upstream",
      ),
    ).toBe("upstream/main");
    expect(
      mod.chooseBestContainingBranch(["origin/main"], "origin/main", "upstream"),
    ).toBeNull();
  });

  it("selects preferred issue branches from the matched remote", async () => {
    const mod = await import("./openFromGithub");

    expect(
      mod.selectPreferredRemoteBranch(
        ["origin/main", "upstream/main"],
        "origin/develop",
        "upstream",
      ),
    ).toBe("upstream/main");
    expect(
      mod.selectPreferredRemoteBranch(
        ["origin/main", "upstream/develop"],
        "origin/develop",
        "upstream",
      ),
    ).toBe("upstream/develop");
  });
});

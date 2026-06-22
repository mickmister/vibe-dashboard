import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { GithubIssueWorkspaceMapStore } from "./github-issue-workspace-map";

const tempDirs: string[] = [];

async function makeStore() {
  const dir = await mkdtemp(join(tmpdir(), "issue-map-"));
  tempDirs.push(dir);
  const filePath = join(dir, "map.json");
  return { store: new GithubIssueWorkspaceMapStore({ filePath }), filePath };
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("GithubIssueWorkspaceMapStore", () => {
  it("persists and reloads issue workspace mappings", async () => {
    const { store, filePath } = await makeStore();
    const identity = {
      owner: "owner",
      repo: "repo",
      number: 42,
      normalizedIssueUrl: "https://github.com/owner/repo/issues/42",
    };

    await store.upsert({
      identity,
      workspaceId: "ws-1",
      branch: "vk/issue-42",
    });

    const reloaded = new GithubIssueWorkspaceMapStore({ filePath });
    await expect(reloaded.get(identity)).resolves.toMatchObject({
      ...identity,
      workspaceId: "ws-1",
      branch: "vk/issue-42",
    });
    await expect(readFile(filePath, "utf8")).resolves.toContain(
      "https://github.com/owner/repo/issues/42",
    );
  });

  it("updates an existing normalized issue mapping instead of duplicating it", async () => {
    const { store } = await makeStore();
    const identity = {
      owner: "owner",
      repo: "repo",
      number: 42,
      normalizedIssueUrl: "https://github.com/owner/repo/issues/42",
    };

    await store.upsert({ identity, workspaceId: "ws-1", branch: "old" });
    await store.upsert({ identity, workspaceId: "ws-2", branch: "new" });

    await expect(store.get(identity)).resolves.toMatchObject({
      workspaceId: "ws-2",
      branch: "new",
    });
  });
});

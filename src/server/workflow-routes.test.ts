import { createHmac } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createWorkflowRegistry,
  type WorkflowDefinition,
} from "@vibe-dashboard/workflow-core";
import { GithubIssueWorkspaceMapStore } from "./github-issue-workspace-map";
import { GithubIssueWorkspaceDbStore } from "./github-issue-workspace-db";
import { initExternalIntegrationsDb } from "../modules/plugins/kanban/server/database";
import { registerWorkflowRoutes } from "./workflow-routes";

const tempDirs: string[] = [];

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

describe("registerWorkflowRoutes", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      tempDirs
        .splice(0)
        .map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  it("returns health and registered workflows", async () => {
    const registry = createWorkflowRegistry();
    registry.register({
      id: "example",
      trigger: "manual",
      run: async () => ({ ok: true }),
    });
    const app = new Hono();
    registerWorkflowRoutes(app, { registry });

    await expectJson(app, "/dashboard/api/workflows/health", 200, { ok: true });
    await expectJson(app, "/dashboard/api/workflows", 200, {
      workflows: [{ id: "example", trigger: "manual" }],
    });
  });

  it("runs workflows by id and returns the workflow run record", async () => {
    const registry = createWorkflowRegistry();
    const workflow = {
      id: "echo",
      trigger: "manual",
      run: async (ctx, input) => {
        ctx.log("echo", "echoing input");
        return input;
      },
    } satisfies WorkflowDefinition<{ value: string }, { value: string }>;
    registry.register(workflow);
    const app = new Hono();
    registerWorkflowRoutes(app, {
      registry,
      githubWebhookSecret: "secret",
      runOptions: {
        createRunId: () => "run_route",
        now: (() => {
          let value = 10;
          return () => value++;
        })(),
      },
    });

    const response = await app.request("/dashboard/api/workflows/echo/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "hello" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      run: {
        runId: "run_route",
        workflowId: "echo",
        status: "completed",
        input: { value: "hello" },
        output: { value: "hello" },
      },
    });
  });

  it("stores and retrieves GitHub issue workspace mappings by normalized identity", async () => {
    const registry = createWorkflowRegistry();
    const dir = await mkdtemp(join(tmpdir(), "workflow-issue-map-"));
    tempDirs.push(dir);
    const app = new Hono();
    registerWorkflowRoutes(app, {
      registry,
      githubIssueWorkspaceMap: new GithubIssueWorkspaceMapStore({
        filePath: join(dir, "issue-map.json"),
      }),
    });

    const put = await app.request(
      "/dashboard/api/github/issue-workspaces/Owner/Repo/42",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: "ws-1", branch: "vk/issue-42" }),
      },
    );
    expect(put.status).toBe(200);

    const get = await app.request(
      "/dashboard/api/github/issue-workspaces/owner/repo/42",
    );
    expect(get.status).toBe(200);
    await expect(get.json()).resolves.toMatchObject({
      mapping: {
        owner: "owner",
        repo: "repo",
        number: 42,
        normalizedIssueUrl: "https://github.com/owner/repo/issues/42",
        workspaceId: "ws-1",
        branch: "vk/issue-42",
      },
    });

    const deleted = await app.request(
      "/dashboard/api/github/issue-workspaces/OWNER/REPO/42",
      { method: "DELETE" },
    );
    expect(deleted.status).toBe(200);
    await expect(deleted.json()).resolves.toEqual({ deleted: true });

    const getAfterDelete = await app.request(
      "/dashboard/api/github/issue-workspaces/owner/repo/42",
    );
    await expect(getAfterDelete.json()).resolves.toEqual({ mapping: null });
  });

  it("reserves issue creation on the server and reconciles concurrent callers", async () => {
    const handle = await initExternalIntegrationsDb({ path: ":memory:" });
    const store = new GithubIssueWorkspaceDbStore({ getDb: async () => handle.db });
    const creation = deferred<{
      workspace: {
        id: string;
        task_id: null;
        container_ref: null;
        branch: string;
        agent_working_dir: null;
        created_at: string;
        updated_at: string;
        archived: boolean;
        pinned: boolean;
        name: string;
      };
      execution_process: never;
    }>();
    const workspace = {
      id: "ws-reserved",
      task_id: null,
      container_ref: null,
      branch: "vk/issue-42",
      agent_working_dir: null,
      created_at: "2026-09-22T00:00:00Z",
      updated_at: "2026-09-22T00:00:00Z",
      archived: false,
      pinned: false,
      name: "Issue #42",
    };
    const createAndStartWorkspace = vi.fn(() => creation.promise);
    const app = new Hono();
    registerWorkflowRoutes(app, {
      registry: createWorkflowRegistry(),
      githubIssueWorkspaceMap: store,
      githubIssueWorkspaceReservations: store,
      githubIssueWorkspaceVkClient: {
        createAndStartWorkspace,
        getWorkspace: vi.fn(async () => workspace),
        updateWorkspace: vi.fn(),
      },
    });
    const request = () => app.request(
      "/dashboard/api/github/issue-workspaces/Owner/Repo/42/resolve-or-create",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repoId: "repo-id",
          targetBranch: "origin/main",
          createBranch: true,
          checkoutBranch: null,
          name: "Issue #42",
        }),
      },
    );

    const owner = request();
    await vi.waitFor(() => expect(createAndStartWorkspace).toHaveBeenCalledTimes(1));
    const concurrent = await request();
    expect(concurrent.status).toBe(202);
    creation.resolve({ workspace, execution_process: undefined as never });
    expect((await owner).status).toBe(200);

    const retry = await request();
    expect(retry.status).toBe(200);
    await expect(retry.json()).resolves.toMatchObject({
      status: "ready",
      workspace: { id: "ws-reserved" },
      created: false,
    });
    expect(createAndStartWorkspace).toHaveBeenCalledTimes(1);
    await handle.db.destroy();
    handle.sqlite.close();
  });

  it("requires manual recovery when workspace creation succeeds but reservation recording and cleanup fail", async () => {
    const handle = await initExternalIntegrationsDb({ path: ":memory:" });
    class RecordFailingStore extends GithubIssueWorkspaceDbStore {
      override async recordWorkspace(): Promise<void> {
        throw new Error("reservation write failed");
      }
    }
    const store = new RecordFailingStore({ getDb: async () => handle.db });
    const workspace = {
      id: "ws-untracked",
      task_id: null,
      container_ref: null,
      branch: "vk/issue-42",
      agent_working_dir: null,
      created_at: "2026-09-22T00:00:00Z",
      updated_at: "2026-09-22T00:00:00Z",
      archived: false,
      pinned: false,
      name: "Issue #42",
    };
    const createAndStartWorkspace = vi.fn(async () => ({
      workspace,
      execution_process: undefined as never,
    }));
    const updateWorkspace = vi.fn(async () => {
      throw new Error("archive failed");
    });
    const app = new Hono();
    registerWorkflowRoutes(app, {
      registry: createWorkflowRegistry(),
      githubIssueWorkspaceMap: store,
      githubIssueWorkspaceReservations: store,
      githubIssueWorkspaceVkClient: {
        createAndStartWorkspace,
        getWorkspace: vi.fn(async () => workspace),
        updateWorkspace,
      },
    });
    const request = () => app.request(
      "/dashboard/api/github/issue-workspaces/Owner/Repo/42/resolve-or-create",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repoId: "repo-id",
          targetBranch: "origin/main",
          createBranch: true,
          checkoutBranch: null,
          name: "Issue #42",
        }),
      },
    );

    const first = await request();
    expect(first.status).toBe(500);
    expect(createAndStartWorkspace).toHaveBeenCalledTimes(1);
    expect(updateWorkspace).toHaveBeenCalledWith("ws-untracked", { archived: true });

    const retry = await request();
    expect(retry.status).toBe(409);
    await expect(retry.json()).resolves.toMatchObject({
      status: "manual_recovery",
      error: expect.stringContaining("operator recovery"),
      lastError: expect.stringContaining("Manual recovery required"),
    });
    expect(createAndStartWorkspace).toHaveBeenCalledTimes(1);

    await handle.db.destroy();
    handle.sqlite.close();
  });


  it("ensures a GitHub repo via the provisioning route", async () => {
    const reposRoot = await mkdtemp(join(tmpdir(), "vd-route-repos-"));
    try {
      const registry = createWorkflowRegistry();
      const app = new Hono();
      const repo = {
        id: "repo-1",
        name: "repo",
        display_name: "owner/repo",
        path: join(reposRoot, "repo"),
      };
      const execFile = vi.fn(async (_file: string, args: readonly string[]) => {
        if (args[0] === "clone") return { stdout: "", stderr: "" };
        throw new Error(`unexpected git ${args.join(" ")}`);
      });
      registerWorkflowRoutes(app, {
        registry,
        githubRepoProvisioning: {
          reposRoot,
          execFile,
          vkClient: {
            getRepos: vi.fn(async () => []),
            registerRepo: vi.fn(async () => repo),
          },
        },
      });

      const response = await app.request("/dashboard/api/github/ensure-repo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repoUrl: "https://github.com/owner/repo/pull/7",
        }),
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        repo,
        path: join(reposRoot, "repo"),
        cloned: true,
        registered: true,
      });
    } finally {
      await rm(reposRoot, { recursive: true, force: true });
    }
  });

  it("exposes associated PR and branch protection GitHub metadata", async () => {
    const app = new Hono();
    const execFile = vi.fn(async (_file: string, args: readonly string[]) => {
      if (args.includes("closedByPullRequestsReferences")) {
        return { stdout: '{"number":7,"url":"https://github.com/owner/repo/pull/7","title":"Fix","state":"OPEN"}\n', stderr: "" };
      }
      if (args.some((arg) => arg.endsWith("/timeline"))) return { stdout: "", stderr: "" };
      return { stdout: "true\n", stderr: "" };
    });
    registerWorkflowRoutes(app, {
      registry: createWorkflowRegistry(),
      githubRepoProvisioning: { execFile },
    });

    const prs = await app.request("/dashboard/api/github/issue-pull-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ issueUrl: "https://github.com/owner/repo/issues/2" }),
    });
    expect(prs.status).toBe(200);
    await expect(prs.json()).resolves.toMatchObject({ pullRequests: [{ number: 7 }] });

    const protection = await app.request("/dashboard/api/github/branch-protection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repoUrl: "https://github.com/owner/repo", branch: "main" }),
    });
    expect(protection.status).toBe(200);
    await expect(protection.json()).resolves.toEqual({ protected: true });
  });



  it("returns branches containing a commit via the Git branch lookup route", async () => {
    const registry = createWorkflowRegistry();
    const app = new Hono();
    const execFile = vi.fn(async () => ({
      stdout: "refs/heads/topic\nrefs/remotes/origin/main\nrefs/remotes/origin/HEAD\n",
      stderr: "",
    }));
    registerWorkflowRoutes(app, {
      registry,
      githubBranchLookup: {
        execFile,
        vkClient: {
          getRepos: vi.fn(async () => [
            {
              id: "repo-1",
              name: "repo",
              display_name: "Repo",
              path: "/home/vkuser/repos/repo",
            },
          ]),
        },
      },
    });

    const response = await app.request(
      "/dashboard/api/github/repos/repo-1/branches-containing/0123456789abcdef0123456789abcdef01234567",
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      branches: ["topic", "origin/main"],
    });
    expect(execFile).toHaveBeenCalledWith(
      "git",
      expect.arrayContaining(["/home/vkuser/repos/repo"]),
    );
  });

  it("runs the GitHub CI failure workflow from the GitHub webhook route", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const registry = createWorkflowRegistry();
    registry.register({
      id: "github-ci-failure",
      trigger: "github.workflow_run",
      run: async (_ctx, input) => ({ outcome: "message_sent", input }),
    });
    const app = new Hono();
    registerWorkflowRoutes(app, {
      registry,
      githubWebhookSecret: "secret",
      repoAliasCache: {
        get: () => [{ name: "local-repo", aliases: ["owner/repo"] }],
        set: () => {},
      },
      runOptions: {
        createRunId: () => "run_webhook",
        now: () => 50,
      },
    });

    const body = JSON.stringify({ workflow_run: { conclusion: "failure" } });
    const response = await app.request("/dashboard/api/webhooks/github", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitHub-Event": "workflow_run",
        "X-GitHub-Delivery": "delivery-123",
        "X-Hub-Signature-256": signBody(body, "secret"),
      },
      body,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      outcome: "message_sent",
      run: {
        runId: "run_webhook",
        workflowId: "github-ci-failure",
        status: "completed",
        output: {
          outcome: "message_sent",
          input: {
            event: "workflow_run",
            payload: { workflow_run: { conclusion: "failure" } },
            repoAliases: [{ name: "local-repo", aliases: ["owner/repo"] }],
          },
        },
      },
    });
    expect(infoSpy).toHaveBeenCalledWith("GitHub webhook received", {
      delivery: "delivery-123",
      event: "workflow_run",
      action: undefined,
      workflowRunStatus: undefined,
      workflowRunConclusion: "failure",
      workflowRunHtmlUrl: undefined,
    });
    expect(infoSpy).toHaveBeenCalledWith("GitHub webhook workflow completed", {
      delivery: "delivery-123",
      event: "workflow_run",
      outcome: "message_sent",
      status: "completed",
      runId: "run_webhook",
    });
  });


  it('refreshes repo aliases and retries once when no workspace matches', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const registry = createWorkflowRegistry();
    registry.register({
      id: 'github-ci-failure',
      trigger: 'github.workflow_run',
      run: async (_ctx, input) => {
        const repoAliases = (input as { repoAliases?: Array<{ aliases: string[] }> }).repoAliases ?? [];
        const matched = repoAliases.some((repo) => repo.aliases.includes('owner/repo'));
        return matched
          ? { outcome: 'message_sent', input }
          : { outcome: 'no_matching_workspace', input };
      },
    });
    const app = new Hono();
    const refresh = vi.fn(async () => [{ name: 'local-repo', aliases: ['owner/repo'] }]);
    registerWorkflowRoutes(app, {
      registry,
      githubWebhookSecret: 'secret',
      repoAliasCache: {
        get: () => [{ name: 'local-repo', aliases: [] }],
        set: () => {},
        refresh,
      },
      runOptions: {
        createRunId: (() => {
          let index = 0;
          return () => ['run_initial', 'run_retry'][index++] ?? 'run_extra';
        })(),
        now: (() => {
          let value = 50;
          return () => value++;
        })(),
      },
    });

    const body = JSON.stringify({ workflow_run: { conclusion: 'failure' } });
    const response = await app.request('/dashboard/api/webhooks/github', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Event': 'workflow_run',
        'X-GitHub-Delivery': 'delivery-123',
        'X-Hub-Signature-256': signBody(body, 'secret'),
      },
      body,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      outcome: 'message_sent',
      run: {
        runId: 'run_retry',
        output: {
          outcome: 'message_sent',
          input: {
            repoAliases: [{ name: 'local-repo', aliases: ['owner/repo'] }],
          },
        },
      },
    });
    expect(refresh).toHaveBeenCalledOnce();
    expect(infoSpy).toHaveBeenCalledWith(
      'Retrying GitHub webhook workflow after refreshing repo aliases',
      {
        delivery: 'delivery-123',
        event: 'workflow_run',
      },
    );
  });



  it('enforces GitHub webhook signatures before running workflows', async () => {

    const registry = createWorkflowRegistry();
    registry.register({
      id: "github-ci-failure",
      trigger: "github.workflow_run",
      run: async () => ({ outcome: "should_not_run" }),
    });
    const app = new Hono();
    registerWorkflowRoutes(app, { registry, githubWebhookSecret: "secret" });

    const missing = await app.request("/dashboard/api/webhooks/github", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitHub-Event": "workflow_run",
      },
      body: "{}",
    });
    expect(missing.status).toBe(401);
    await expect(missing.json()).resolves.toEqual({
      error: "github_signature_missing",
    });

    const invalid = await app.request("/dashboard/api/webhooks/github", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitHub-Event": "workflow_run",
        "X-Hub-Signature-256": "sha256=deadbeef",
      },
      body: "{}",
    });
    expect(invalid.status).toBe(401);
    await expect(invalid.json()).resolves.toEqual({
      error: "github_signature_invalid",
    });
  });

  it("fails closed when GitHub webhook secret is not configured", async () => {
    const registry = createWorkflowRegistry();
    registry.register({
      id: "github-ci-failure",
      trigger: "github.workflow_run",
      run: async () => ({ outcome: "should_not_run" }),
    });
    const app = new Hono();
    registerWorkflowRoutes(app, { registry, githubWebhookSecret: "" });
    const body = "{}";

    const response = await app.request("/dashboard/api/webhooks/github", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitHub-Event": "workflow_run",
        "X-Hub-Signature-256": signBody(body, "secret"),
      },
      body,
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "github_webhook_secret_not_configured",
    });
  });

  it("returns 404 for unknown workflows and 500 for failed workflows", async () => {
    const registry = createWorkflowRegistry();
    registry.register({
      id: "fail",
      trigger: "manual",
      run: async () => {
        throw new Error("workflow exploded");
      },
    });
    const app = new Hono();
    registerWorkflowRoutes(app, { registry });

    const missing = await app.request("/dashboard/api/workflows/missing/run", {
      method: "POST",
    });
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toMatchObject({
      error: "Workflow not found: missing",
    });

    const failed = await app.request("/dashboard/api/workflows/fail/run", {
      method: "POST",
    });
    expect(failed.status).toBe(500);
    await expect(failed.json()).resolves.toMatchObject({
      run: {
        workflowId: "fail",
        status: "failed",
        error: { message: "workflow exploded" },
      },
    });
  });
});

async function expectJson(
  app: Hono,
  path: string,
  status: number,
  expected: unknown,
): Promise<void> {
  const response = await app.request(path);
  expect(response.status).toBe(status);
  await expect(response.json()).resolves.toEqual(expected);
}

function signBody(body: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

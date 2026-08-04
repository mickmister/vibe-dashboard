import * as fs from "node:fs";
import * as path from "node:path";

import { serve } from "@hono/node-server";
import { Hono } from "hono";

import { loadMattermostBridgeRuntimeConfig } from "./lib/mm-integration/config";
import { createMattermostCoordinator } from "./lib/mm-integration/coordinator";
import { createMattermostBridgeStore } from "./lib/mm-integration/db";
import { createMattermostBridgeClient } from "./lib/mm-integration/mm-client";
import {
  createMattermostPostPoller,
  parseMattermostSlashCommandRequest,
} from "./lib/mm-integration/mm-watchers";
import type {
  MattermostIntegrationConfig,
  VkBridgeClient,
  VkExecutionProcess,
  VkFollowUpRequest,
  VkRemoteIssue,
  VkSession,
  VkWorkspace,
  VkWorkspaceRepo,
  VkWorkspaceSummary,
} from "./lib/mm-integration/types";
import { createVkBridgeClient } from "./lib/mm-integration/vk-client";
import {
  parseVkWebhookEvent,
  verifyVkWebhookSignature,
} from "./lib/mm-integration/vk-webhook";
import { createWorkspaceSummaryPoller } from "./lib/mm-integration/vk-watchers";

type EnvMap = Record<string, string>;

type RepoApi = {
  id: string;
  name: string;
  display_name?: string;
  default_target_branch?: string | null;
};

const DEFAULT_PROXY_PORT = 3010;
const DEFAULT_VK_BASE_URL = "http://localhost:3007";
const DEFAULT_SLASH_PATH = "/api/mattermost/slash";
const STANDALONE_FAKE_ISSUE_ID = "standalone-local-issue";
const STANDALONE_FAKE_PROJECT_ID = "00000000-0000-0000-0000-000000000000";
const STANDALONE_FAKE_STATUS_ID = "00000000-0000-0000-0000-000000000000";

function log(message: string, ...args: unknown[]) {
  console.log(`[mm-standalone] ${message}`, ...args);
}

function readEnvFile(filePath: string): EnvMap {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const env: EnvMap = {};
  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }

  return env;
}

function getProxyPort(env: NodeJS.ProcessEnv): number {
  const rawPort =
    env.MATTERMOST_STANDALONE_PORT ?? env.PORT ?? String(DEFAULT_PROXY_PORT);
  const parsed = Number.parseInt(rawPort, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid proxy port: ${rawPort}`);
  }
  return parsed;
}

function applyDefaultBridgeEnv(
  env: NodeJS.ProcessEnv,
  dockerEnv: EnvMap,
  port: number,
) {
  const publicBaseUrl =
    env.MATTERMOST_BRIDGE_PUBLIC_BASE_URL ??
    dockerEnv.MATTERMOST_BOOTSTRAP_PUBLIC_BASE_URL ??
    `http://localhost:${port}`;
  const slashCommandPath =
    env.MATTERMOST_BRIDGE_SLASH_COMMAND_PATH ??
    dockerEnv.MATTERMOST_BOOTSTRAP_SLASH_COMMAND_PATH ??
    DEFAULT_SLASH_PATH;

  env.MATTERMOST_BRIDGE_ENABLED ??= "true";
  env.MATTERMOST_BRIDGE_PUBLIC_BASE_URL = publicBaseUrl;
  env.MATTERMOST_BRIDGE_SLASH_COMMAND_PATH = slashCommandPath;
  env.MATTERMOST_BRIDGE_MM_BASE_URL ??=
    dockerEnv.MATTERMOST_URL ?? "http://localhost:8065";
  env.MATTERMOST_BRIDGE_MM_BOT_TOKEN ??=
    dockerEnv.MATTERMOST_BOOTSTRAP_BOT_TOKEN ?? "";
  env.MATTERMOST_BRIDGE_MM_TEAM_ID ??=
    dockerEnv.MATTERMOST_BOOTSTRAP_TEAM_ID ?? "";
  env.MATTERMOST_BRIDGE_MM_BOT_USER_ID ??=
    dockerEnv.MATTERMOST_BOOTSTRAP_BOT_USER_ID ?? "";
  env.MATTERMOST_BRIDGE_MM_SLASH_COMMAND_TOKEN ??=
    dockerEnv.MATTERMOST_BOOTSTRAP_SLASH_COMMAND_TOKEN ?? "";
  env.MATTERMOST_BRIDGE_VK_BASE_URL ??= DEFAULT_VK_BASE_URL;
  env.MATTERMOST_BRIDGE_VK_DEFAULT_EXECUTOR ??= "CODEX";
  env.MATTERMOST_BRIDGE_VK_DEFAULT_PROJECT_ID ??= STANDALONE_FAKE_PROJECT_ID;
  env.MATTERMOST_BRIDGE_VK_DEFAULT_ISSUE_STATUS_ID ??=
    STANDALONE_FAKE_STATUS_ID;
}

function normalizeRepoBranch(branch: string | null | undefined): string {
  if (!branch || branch.includes("/")) {
    return "main";
  }

  return branch;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `${init?.method ?? "GET"} ${url} failed: ${response.status} ${text}`,
    );
  }
  return JSON.parse(text) as T;
}

async function resolveDefaultRepo(
  config: MattermostIntegrationConfig,
): Promise<{ repoId: string; targetBranch: string }> {
  if (config.vk.defaultRepoId && config.vk.defaultRepoBranch) {
    return {
      repoId: config.vk.defaultRepoId,
      targetBranch: config.vk.defaultRepoBranch,
    };
  }

  const payload = await requestJson<{ success: boolean; data: RepoApi[] }>(
    `${config.vk.baseUrl}/api/repos`,
  );
  const repos = payload.data ?? [];
  if (repos.length === 0) {
    throw new Error(
      "VK returned no repositories for standalone Mattermost proxy",
    );
  }

  const repo =
    repos.find((entry) => entry.name === "Vktest") ??
    repos.find((entry) => entry.display_name === "Vktest") ??
    repos[0];

  if (!repo) {
    throw new Error("Unable to select a default VK repository");
  }

  const defaultTargetBranch = normalizeRepoBranch(repo.default_target_branch);

  config.vk.defaultRepoId = repo.id;
  config.vk.defaultRepoBranch = defaultTargetBranch;

  return {
    repoId: repo.id,
    targetBranch: defaultTargetBranch,
  };
}

async function ensureStandaloneRepoEnv(env: NodeJS.ProcessEnv): Promise<void> {
  if (
    env.MATTERMOST_BRIDGE_VK_DEFAULT_REPO_ID &&
    env.MATTERMOST_BRIDGE_VK_DEFAULT_REPO_BRANCH
  ) {
    return;
  }

  const vkBaseUrl = env.MATTERMOST_BRIDGE_VK_BASE_URL ?? DEFAULT_VK_BASE_URL;
  const payload = await requestJson<{ success: boolean; data: RepoApi[] }>(
    `${vkBaseUrl}/api/repos`,
  );
  const repos = payload.data ?? [];
  if (repos.length === 0) {
    throw new Error(
      "VK returned no repositories for standalone Mattermost proxy",
    );
  }

  const repo =
    repos.find((entry) => entry.name === "Vktest") ??
    repos.find((entry) => entry.display_name === "Vktest") ??
    repos[0];

  if (!repo) {
    throw new Error("Unable to select a default VK repository");
  }

  env.MATTERMOST_BRIDGE_VK_DEFAULT_REPO_ID ??= repo.id;
  env.MATTERMOST_BRIDGE_VK_DEFAULT_REPO_BRANCH ??= normalizeRepoBranch(
    repo.default_target_branch,
  );
}

function shouldUseRemoteIssues(env: NodeJS.ProcessEnv): boolean {
  const raw = env.MATTERMOST_STANDALONE_USE_REMOTE_ISSUES;
  if (!raw) {
    return false;
  }

  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

function applyStandaloneMattermostTransportEnv(env: NodeJS.ProcessEnv) {
  env.MATTERMOST_BRIDGE_POST_RECONCILIATION_POLL_MS ??=
    env.MATTERMOST_STANDALONE_RECONCILIATION_POLL_MS ??
    env.MATTERMOST_STANDALONE_POST_POLL_MS;
  env.MATTERMOST_BRIDGE_POST_RECONNECT_BACKFILL_DELAY_MS ??=
    env.MATTERMOST_STANDALONE_RECONNECT_BACKFILL_DELAY_MS;
  env.MATTERMOST_BRIDGE_MM_WEBSOCKET_ENABLED ??=
    env.MATTERMOST_STANDALONE_WEBSOCKET_ENABLED;
  env.MATTERMOST_BRIDGE_MM_WS_RECONNECT_MIN_MS ??=
    env.MATTERMOST_STANDALONE_WS_RECONNECT_MIN_MS;
  env.MATTERMOST_BRIDGE_MM_WS_RECONNECT_MAX_MS ??=
    env.MATTERMOST_STANDALONE_WS_RECONNECT_MAX_MS;
}

class StandaloneVkClient implements VkBridgeClient {
  private readonly inner: VkBridgeClient;

  private readonly useRemoteIssues: boolean;

  constructor(inner: VkBridgeClient, useRemoteIssues: boolean) {
    this.inner = inner;
    this.useRemoteIssues = useRemoteIssues;
  }

  async createRemoteIssue(input: {
    title: string;
    description: string;
    projectId: string;
    statusId: string;
  }): Promise<VkRemoteIssue> {
    if (!this.useRemoteIssues) {
      log("Skipping remote issue creation for standalone smoke test");
      return {
        id: STANDALONE_FAKE_ISSUE_ID,
        projectId: STANDALONE_FAKE_PROJECT_ID,
        title: input.title,
        description: input.description,
      };
    }

    try {
      return await this.inner.createRemoteIssue(input);
    } catch (error) {
      log(
        `Remote issue creation failed, falling back to unlinked workspace: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return {
        id: STANDALONE_FAKE_ISSUE_ID,
        projectId: STANDALONE_FAKE_PROJECT_ID,
        title: input.title,
        description: input.description,
      };
    }
  }

  async startWorkspace(input: {
    name: string | null;
    prompt: string;
    repos: { repoId: string; targetBranch: string }[];
    linkedIssue: { issueId: string; remoteProjectId: string } | null;
    executorConfig: MattermostIntegrationConfig["vk"] & {
      executor: string;
      variant?: string | null;
    };
  }): Promise<{
    workspace: VkWorkspace;
    executionProcess: VkExecutionProcess;
  }> {
    const linkedIssue =
      input.linkedIssue?.issueId === STANDALONE_FAKE_ISSUE_ID
        ? null
        : input.linkedIssue;

    return this.inner.startWorkspace({
      ...input,
      linkedIssue,
    });
  }

  listWorkspaces(): Promise<VkWorkspace[]> {
    return this.inner.listWorkspaces();
  }

  listWorkspaceRepos(workspaceId: string): Promise<VkWorkspaceRepo[]> {
    return this.inner.listWorkspaceRepos(workspaceId);
  }

  listWorkspaceSummaries(archived: boolean): Promise<VkWorkspaceSummary[]> {
    return this.inner.listWorkspaceSummaries(archived);
  }

  listSessions(workspaceId: string): Promise<VkSession[]> {
    return this.inner.listSessions(workspaceId);
  }

  followUp(
    sessionId: string,
    input: VkFollowUpRequest,
  ): Promise<VkExecutionProcess> {
    return this.inner.followUp(sessionId, input);
  }

  queueFollowUp(
    sessionId: string,
    input: VkFollowUpRequest,
  ): Promise<{ status: "empty" | "queued" }> {
    return this.inner.queueFollowUp(sessionId, input);
  }

  markWorkspaceSeen(workspaceId: string): Promise<void> {
    return this.inner.markWorkspaceSeen(workspaceId);
  }
}

async function main() {
  const proxyPort = getProxyPort(process.env);
  const mattermostEnvPath = path.resolve(
    process.cwd(),
    "integrations",
    "mattermost",
    ".docker.env",
  );
  const dockerEnv = readEnvFile(mattermostEnvPath);
  applyDefaultBridgeEnv(process.env, dockerEnv, proxyPort);
  applyStandaloneMattermostTransportEnv(process.env);
  await ensureStandaloneRepoEnv(process.env);

  const runtime = loadMattermostBridgeRuntimeConfig();
  const { config } = runtime;
  const resolvedRepo = await resolveDefaultRepo(config);
  const vkClient = new StandaloneVkClient(
    createVkBridgeClient(config.vk),
    shouldUseRemoteIssues(process.env),
  );
  const mattermostClient = createMattermostBridgeClient({
    baseUrl: config.mattermost.baseUrl,
    botToken: config.mattermost.botToken,
    botUserId: config.mattermost.botUserId,
    logger: console,
  });
  const store = createMattermostBridgeStore({
    dbPath: runtime.dbPath,
  });
  const coordinator = createMattermostCoordinator({
    config,
    store,
    vkClient,
    mattermostClient,
    logger: console,
  });
  await coordinator.ensureStarted();

  const summaryPoller = createWorkspaceSummaryPoller({
    vkClient,
    archived: false,
    pollMs: config.workspaceSummaryPollMs,
    onUpdate: (snapshot) => {
      coordinator.observeWorkspaceSummaries(snapshot.summaries);
    },
    onError: (error) => {
      log(
        `Summary poll failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    },
  });
  summaryPoller.start();
  await summaryPoller.refresh().catch((error) => {
    log(
      `Initial summary poll failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  });
  const postPoller = createMattermostPostPoller({
    store,
    mattermostClient,
    reconciliationPollMs: config.mattermost.postReconciliationPollMs,
    websocket: {
      enabled: config.mattermost.websocketEnabled,
      baseUrl: config.mattermost.baseUrl,
      token: config.mattermost.botToken,
      botUserId: config.mattermost.botUserId,
      reconnectMinMs: config.mattermost.websocketReconnectMinMs,
      reconnectMaxMs: config.mattermost.websocketReconnectMaxMs,
      backfillDelayMs: config.mattermost.postReconnectBackfillDelayMs,
    },
    onPost: async (event) => {
      await coordinator.handlePost(event);
    },
    onError: (error) => {
      log(
        `Post poll failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    },
  });
  postPoller.start();
  await postPoller.refresh().catch((error) => {
    log(
      `Initial post poll failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  });

  const app = new Hono();

  app.get("/api/mattermost/health", async (c) => {
    return c.json({
      ...(await coordinator.getHealth()),
      port: proxyPort,
      vkBaseUrl: config.vk.baseUrl,
      mattermostBaseUrl: config.mattermost.baseUrl,
      slashCommandPath: config.slashCommandPath,
      vkWebhookPath: config.vk.webhookPath,
      postPollMs: config.mattermost.postReconciliationPollMs,
      postReconciliationPollMs: config.mattermost.postReconciliationPollMs,
      postReconnectBackfillDelayMs:
        config.mattermost.postReconnectBackfillDelayMs,
      websocketEnabled: config.mattermost.websocketEnabled,
      postTransport: postPoller.getHealth(),
      repoId: resolvedRepo.repoId,
      repoBranch: resolvedRepo.targetBranch,
      useRemoteIssues: shouldUseRemoteIssues(process.env),
      dbPath: runtime.dbPath,
    });
  });

  const handleSlash = async (request: Request) => {
    const payload = await parseMattermostSlashCommandRequest(request);
    const expectedToken = config.mattermost.slashCommandToken?.trim();
    if (expectedToken && payload.token !== expectedToken) {
      const error = new Error("Invalid Mattermost slash command token");
      (error as Error & { status?: number }).status = 401;
      throw error;
    }
    return coordinator.handleSlashCommand(payload);
  };

  app.post(config.slashCommandPath, async (c) => {
    return c.json(await handleSlash(c.req.raw));
  });

  if (config.slashCommandPath !== DEFAULT_SLASH_PATH) {
    app.post(DEFAULT_SLASH_PATH, async (c) => {
      return c.json(await handleSlash(c.req.raw));
    });
  }

  if (config.slashCommandPath !== "/api/mattermost/slash-command") {
    app.post("/api/mattermost/slash-command", async (c) => {
      return c.json(await handleSlash(c.req.raw));
    });
  }

  const handleVkWebhook = async (request: Request) => {
    const body = await request.text();
    if (
      !verifyVkWebhookSignature({
        secret: config.vk.webhookSecret,
        timestamp: request.headers.get("x-vk-webhook-timestamp"),
        signature: request.headers.get("x-vk-webhook-signature"),
        body,
      })
    ) {
      const error = new Error("Invalid VK webhook signature");
      (error as Error & { status?: number }).status = 401;
      throw error;
    }

    return coordinator.handleVkWebhook(parseVkWebhookEvent(body));
  };

  app.post(config.vk.webhookPath, async (c) => {
    try {
      return c.json({
        success: true,
        data: await handleVkWebhook(c.req.raw),
      });
    } catch (error) {
      const status: 400 | 401 | 500 =
        error instanceof Error && "status" in error && error.status === 401
          ? 401
          : error instanceof SyntaxError
            ? 400
            : 500;
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        },
        status,
      );
    }
  });

  const server = serve(
    {
      fetch: app.fetch,
      port: proxyPort,
    },
    (info) => {
      log(
        `Listening on http://localhost:${info.port} with slash route ${config.slashCommandPath}`,
      );
    },
  );

  const shutdown = () => {
    postPoller.stop();
    summaryPoller.stop();
    server.close();
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error("[mm-standalone] fatal", error);
  process.exit(1);
});

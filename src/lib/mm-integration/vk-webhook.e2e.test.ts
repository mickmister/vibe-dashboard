import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createChatIntegrationStore } from "../chat-integration/db";
import { createMattermostCoordinator } from "./coordinator";
import type {
  MattermostBridgeClient,
  MattermostCoordinatorDeps,
  VkBridgeClient,
} from "./types";
import {
  parseVkWebhookEvent,
  signVkWebhookPayload,
  verifyVkWebhookSignature,
} from "./vk-webhook";

const tmpDirs: string[] = [];

function makeTmpDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vd-mm-e2e-"));
  tmpDirs.push(dir);
  return path.join(dir, "bridge.sqlite");
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { force: true, recursive: true });
  }
});

function makeVkClient(): VkBridgeClient {
  return {
    createRemoteIssue: vi.fn(),
    startWorkspace: vi.fn(),
    listWorkspaces: vi.fn(),
    listWorkspaceRepos: vi.fn(async () => []),
    listWorkspaceSummaries: vi.fn(),
    listSessions: vi.fn(),
    followUp: vi.fn(),
    queueFollowUp: vi.fn(async () => ({ status: "queued" as const })),
    markWorkspaceSeen: vi.fn(),
  };
}

function makeMattermostClient(): MattermostBridgeClient {
  return {
    createTeam: vi.fn(),
    createChannel: vi.fn(),
    listTeams: vi.fn(),
    listChannelPostsSince: vi.fn(),
    createPost: vi.fn(async ({ channelId, rootId }) => ({
      channelId,
      postId: "mm-post-1",
      rootId: rootId ?? null,
    })),
    createEphemeralPost: vi.fn(),
    createTypingSession: vi.fn(),
  };
}

describe("Mattermost VK webhook e2e", () => {
  it("accepts a signed VK webhook over HTTP, posts to the mapped thread, and rejects duplicates", async () => {
    const secret = "super-secret";
    const store = createChatIntegrationStore({ dbPath: makeTmpDbPath() });
    await store.ensureSchema();
    await store.upsertSessionThreadBinding({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      provider: "mattermost",
      channelId: "channel-1",
      threadId: "thread-1",
    });

    const mattermostClient = makeMattermostClient();
    const deps: MattermostCoordinatorDeps = {
      config: {
        enabled: true,
        publicBaseUrl: "http://localhost:3010",
        slashCommandPath: "/api/mattermost/slash-command",
        workspaceSummaryPollMs: 15_000,
        vk: {
          baseUrl: "http://localhost:3007",
          defaultProjectId: "project-1",
          defaultIssueStatusId: "status-1",
          defaultRepoId: "repo-1",
          defaultRepoBranch: "main",
          defaultExecutor: "CODEX",
          webhookSecret: secret,
          webhookPath: "/api/mattermost/vk-webhook",
        },
        mattermost: {
          baseUrl: "http://localhost:8065",
          userBaseUrl: "http://localhost:8065",
          botToken: "token",
          teamId: "team-1",
          channelPrefix: "vk",
          websocketEnabled: false,
          postReconciliationPollMs: 60_000,
          postReconnectBackfillDelayMs: 2_000,
          websocketReconnectMinMs: 1_000,
          websocketReconnectMaxMs: 30_000,
        },
      },
      store,
      vkClient: makeVkClient(),
      mattermostClient,
    };
    const coordinator = createMattermostCoordinator(deps);

    const app = new Hono();
    app.post("/api/mattermost/vk-webhook", async (c) => {
      const body = await c.req.text();
      if (
        !verifyVkWebhookSignature({
          secret,
          timestamp: c.req.header("x-vk-webhook-timestamp") ?? null,
          signature: c.req.header("x-vk-webhook-signature") ?? null,
          body,
          nowMs: 1_767_225_600_000,
        })
      ) {
        return c.json({ success: false }, 401);
      }

      return c.json({
        success: true,
        data: await coordinator.handleVkWebhook(parseVkWebhookEvent(body)),
      });
    });

    const body = JSON.stringify({
      event_type: "execution.completed",
      delivery_id: "delivery-1",
      timestamp: "2026-01-01T00:00:00.000Z",
      title: "Task Execution Completed",
      message: "Successfully completed: Fix bridge",
      workspace_id: "workspace-1",
      session_id: "session-1",
      execution_id: "execution-1",
      exit_code: 0,
    });
    const timestamp = "1767225600";
    const headers = {
      "content-type": "application/json",
      "x-vk-webhook-timestamp": timestamp,
      "x-vk-webhook-signature": signVkWebhookPayload(secret, timestamp, body),
    };

    const first = await app.request("/api/mattermost/vk-webhook", {
      method: "POST",
      headers,
      body,
    });
    await expect(first.json()).resolves.toEqual({
      success: true,
      data: { duplicate: false, posted: true },
    });
    expect(mattermostClient.createPost).toHaveBeenCalledTimes(1);
    expect(mattermostClient.createPost).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: "channel-1",
        rootId: "thread-1",
      }),
    );

    const duplicate = await app.request("/api/mattermost/vk-webhook", {
      method: "POST",
      headers,
      body,
    });
    await expect(duplicate.json()).resolves.toEqual({
      success: true,
      data: { duplicate: true, posted: false },
    });
    expect(mattermostClient.createPost).toHaveBeenCalledTimes(1);

    const rejected = await app.request("/api/mattermost/vk-webhook", {
      method: "POST",
      headers: {
        ...headers,
        "x-vk-webhook-signature": "sha256=bad",
      },
      body,
    });
    expect(rejected.status).toBe(401);
  });
});

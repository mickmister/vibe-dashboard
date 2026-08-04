import { describe, expect, it, vi } from "vitest";

import { createMattermostCoordinator } from "./coordinator";
import type {
  MattermostBridgeClient,
  MattermostBridgeStore,
  MattermostCoordinatorDeps,
  VkBridgeClient,
} from "./types";

function makeStore(): MattermostBridgeStore {
  const workspaceChannels = new Map<string, any>();
  const sessionThreads = new Map<string, any>();
  const sessionThreadsByThreadId = new Map<string, any>();
  const executionPosts = new Map<string, any>();
  const repoRoutes = new Map<string, any>();
  const connectorState = new Map<string, unknown>();

  return {
    ensureSchema: vi.fn(async () => {}),
    getWorkspaceBinding: vi.fn(async (workspaceId: string) => {
      return workspaceChannels.get(workspaceId) ?? null;
    }),
    getWorkspaceBindingByChannelId: vi.fn(
      async (_provider: string, channelId: string) => {
        for (const mapping of workspaceChannels.values()) {
          if (mapping.channelId === channelId) {
            return mapping;
          }
        }

        return null;
      },
    ),
    listWorkspaceBindings: vi.fn(async () => {
      return Array.from(workspaceChannels.values());
    }),
    upsertWorkspaceBinding: vi.fn(async (mapping) => {
      const next = {
        ...mapping,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      };
      workspaceChannels.set(mapping.workspaceId, next);
      return next;
    }),
    getSessionThreadBinding: vi.fn(async (sessionId: string) => {
      return sessionThreads.get(sessionId) ?? null;
    }),
    getSessionThreadBindingByThreadId: vi.fn(
      async (_provider: string, threadId: string) => {
        return sessionThreadsByThreadId.get(threadId) ?? null;
      },
    ),
    listSessionThreadBindings: vi.fn(async () => {
      return Array.from(sessionThreads.values());
    }),
    upsertSessionThreadBinding: vi.fn(async (mapping) => {
      const next = {
        ...mapping,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      };
      sessionThreads.set(mapping.sessionId, next);
      sessionThreadsByThreadId.set(mapping.threadId, next);
      return next;
    }),
    getExecutionPostBinding: vi.fn(async (executionId: string) => {
      return executionPosts.get(executionId) ?? null;
    }),
    upsertExecutionPostBinding: vi.fn(async (mapping) => {
      const next = {
        ...mapping,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      };
      executionPosts.set(mapping.executionId, next);
      return next;
    }),
    listRepoChatRoutes: vi.fn(async () => Array.from(repoRoutes.values())),
    upsertRepoChatRoute: vi.fn(async (input) => {
      const next = {
        id: input.id ?? repoRoutes.size + 1,
        ...input,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      };
      repoRoutes.set(input.repoId, next);
      return next;
    }),
    deleteRepoChatRoute: vi.fn(async () => false),
    getConnectorState: async <T>(key: string): Promise<T | null> => {
      return (connectorState.get(key) as T | undefined) ?? null;
    },
    tryReserveConnectorState: async <T>(
      key: string,
      value: T,
    ): Promise<boolean> => {
      if (connectorState.has(key)) {
        return false;
      }
      connectorState.set(key, value);
      return true;
    },
    deleteConnectorState: async (key: string): Promise<boolean> => {
      return connectorState.delete(key);
    },
    setConnectorState: async <T>(key: string, value: T): Promise<void> => {
      connectorState.set(key, value);
    },
  };
}

function makeVkClient(): VkBridgeClient {
  return {
    createRemoteIssue: vi.fn(async ({ title, description, projectId }) => ({
      id: "issue-1",
      projectId,
      title,
      description,
    })),
    startWorkspace: vi.fn(async (input) => ({
      workspace: {
        id: "workspace-1",
        taskId: "task-1",
        containerRef: null,
        name: input.name,
        archived: false,
        pinned: false,
      },
      executionProcess: {
        id: "execution-1",
        sessionId: "session-1",
        status: "running" as const,
      },
    })),
    listWorkspaces: vi.fn(async () => [
      {
        id: "workspace-1",
        taskId: "task-1",
        containerRef: null,
        name: "Fix bridge",
        archived: false,
        pinned: false,
      },
    ]),
    listWorkspaceRepos: vi.fn(async () => [
      {
        id: "repo-1",
        name: "repo-one",
        displayName: "Repo One",
        targetBranch: "main",
      },
    ]),
    listWorkspaceSummaries: vi.fn(async () => []),
    listSessions: vi.fn(async () => []),
    followUp: vi.fn(async () => ({
      id: "execution-2",
      sessionId: "session-1",
      status: "running" as const,
    })),
    queueFollowUp: vi.fn(async () => ({ status: "queued" as const })),
    markWorkspaceSeen: vi.fn(async () => {}),
  };
}

function makeMattermostClient(): MattermostBridgeClient {
  return {
    createTeam: vi.fn(async ({ name, displayName }) => ({
      id: `team-${name}`,
      name,
      displayName,
    })),
    createChannel: vi.fn(async ({ name }) => ({
      id: "channel-1",
      name,
    })),
    listTeams: vi.fn(async () => []),
    listChannelPostsSince: vi.fn(async () => []),
    createPost: vi.fn(async ({ channelId, rootId }) => ({
      channelId,
      postId: "post-1",
      rootId: rootId ?? null,
    })),
    createEphemeralPost: vi.fn(async () => {}),
    createTypingSession: vi.fn(async () => ({
      stop: () => {},
    })),
  };
}

function makeDeps(): {
  deps: MattermostCoordinatorDeps;
  store: MattermostBridgeStore;
  vkClient: VkBridgeClient;
  mattermostClient: MattermostBridgeClient;
} {
  const store = makeStore();
  const vkClient = makeVkClient();
  const mattermostClient = makeMattermostClient();

  return {
    deps: {
      config: {
        enabled: true,
        publicBaseUrl: "http://localhost:59275",
        slashCommandPath: "/api/mattermost/commands/vibe",
        workspaceSummaryPollMs: 10000,
        vk: {
          baseUrl: "http://localhost:3000",
          defaultProjectId: "project-1",
          defaultIssueStatusId: "status-1",
          defaultRepoId: "repo-1",
          defaultRepoBranch: "main",
          defaultExecutor: "CODEX",
          webhookSecret: "secret",
          webhookPath: "/api/mattermost/vk-webhook",
        },
        mattermost: {
          baseUrl: "http://localhost:8065",
          userBaseUrl: "http://localhost:8065",
          botToken: "token",
          teamId: "team-1",
          channelPrefix: "vk",
          websocketEnabled: true,
          postReconciliationPollMs: 60000,
          postReconnectBackfillDelayMs: 2000,
          websocketReconnectMinMs: 1000,
          websocketReconnectMaxMs: 30000,
        },
      },
      store,
      vkClient,
      mattermostClient,
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    },
    store,
    vkClient,
    mattermostClient,
  };
}

describe("mattermost coordinator", () => {
  it("returns usage text for an empty slash command", async () => {
    const { deps } = makeDeps();
    const coordinator = createMattermostCoordinator(deps);

    const response = await coordinator.handleSlashCommand({
      channelId: "channel-1",
      channelName: "vk-test",
      teamId: "team-1",
      teamDomain: "team",
      userId: "user-1",
      userName: "alice",
      text: "   ",
      command: "/vibe",
    });

    expect(response).toEqual({
      responseType: "ephemeral",
      text: "Usage: /vibe <task description>",
    });
  });

  it("creates issue, workspace, channel, and root thread for slash commands", async () => {
    const { deps, store, vkClient, mattermostClient } = makeDeps();
    const coordinator = createMattermostCoordinator(deps);

    const response = await coordinator.handleSlashCommand({
      channelId: "channel-1",
      channelName: "vk-test",
      teamId: "team-1",
      teamDomain: "team",
      userId: "user-1",
      userName: "alice",
      text: "Fix the Mattermost bridge",
      command: "/vibe",
    });

    expect(vkClient.createRemoteIssue).toHaveBeenCalledTimes(1);
    expect(vkClient.startWorkspace).toHaveBeenCalledTimes(1);
    expect(mattermostClient.createChannel).toHaveBeenCalledTimes(1);
    expect(mattermostClient.createPost).toHaveBeenCalledTimes(1);
    await expect(
      store.getSessionThreadBinding("session-1"),
    ).resolves.toMatchObject({
      threadId: "post-1",
    });
    await expect(
      store.getWorkspaceBinding("workspace-1"),
    ).resolves.toMatchObject({
      provider: "mattermost",
      spaceId: "team-1",
      spaceLabel: "team",
    });
    expect(response).toEqual({
      responseType: "ephemeral",
      text: "Started Fix the Mattermost bridge from /vibe.",
    });
  });

  it("routes thread replies to follow-up when the session is idle", async () => {
    const { deps, store, vkClient } = makeDeps();
    const coordinator = createMattermostCoordinator(deps);

    await store.upsertSessionThreadBinding({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      provider: "mattermost",
      channelId: "channel-1",
      threadId: "root-1",
    });

    await coordinator.handlePost({
      postId: "reply-1",
      channelId: "channel-1",
      rootId: "root-1",
      userId: "user-1",
      message: "Please add tests too",
      props: {},
      createAt: Date.now(),
      isBotPost: false,
    });

    expect(vkClient.followUp).toHaveBeenCalledTimes(1);
    expect(vkClient.queueFollowUp).not.toHaveBeenCalled();
  });

  it("queues thread replies when the session is marked running", async () => {
    const { deps, store, vkClient } = makeDeps();
    const coordinator = createMattermostCoordinator(deps);

    await store.upsertSessionThreadBinding({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      provider: "mattermost",
      channelId: "channel-1",
      threadId: "root-1",
    });

    coordinator.observeWorkspaceSummaries([
      {
        workspaceId: "workspace-1",
        latestSessionId: "session-1",
        hasPendingApproval: false,
        hasRunningDevServer: false,
        hasUnseenTurns: true,
        latestProcessStatus: "running",
        filesChanged: null,
        linesAdded: null,
        linesRemoved: null,
        prStatus: null,
      },
    ]);

    await coordinator.handlePost({
      postId: "reply-1",
      channelId: "channel-1",
      rootId: "root-1",
      userId: "user-1",
      message: "Queue this",
      props: {},
      createAt: Date.now(),
      isBotPost: false,
    });

    expect(vkClient.queueFollowUp).toHaveBeenCalledTimes(1);
    expect(vkClient.followUp).not.toHaveBeenCalled();
  });

  it("responds to root posts in mapped channels without auto-starting work", async () => {
    const { deps, store, mattermostClient, vkClient } = makeDeps();
    const coordinator = createMattermostCoordinator(deps);

    await store.upsertWorkspaceBinding({
      workspaceId: "workspace-1",
      provider: "mattermost",
      spaceId: "team-1",
      spaceLabel: "team",
      channelId: "channel-1",
      channelName: "vk-test",
    });

    await coordinator.handlePost({
      postId: "post-1",
      channelId: "channel-1",
      rootId: null,
      userId: "user-1",
      message: "Can you take this on?",
      props: {},
      createAt: Date.now(),
      isBotPost: false,
    });

    expect(mattermostClient.createEphemeralPost).toHaveBeenCalledTimes(1);
    expect(vkClient.followUp).not.toHaveBeenCalled();
    expect(vkClient.queueFollowUp).not.toHaveBeenCalled();
  });

  it("posts VK webhook events into mapped session threads and deduplicates deliveries", async () => {
    const { deps, store, mattermostClient } = makeDeps();
    const coordinator = createMattermostCoordinator(deps);

    await store.upsertSessionThreadBinding({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      provider: "mattermost",
      channelId: "channel-1",
      threadId: "root-1",
    });

    const result = await coordinator.handleVkWebhook({
      eventType: "execution.completed",
      deliveryId: "delivery-1",
      occurredAt: "2026-01-01T00:00:00.000Z",
      title: "Task Execution Completed",
      message: "Successfully completed: Fix bridge",
      taskId: "task-1",
      taskTitle: "Fix bridge",
      projectId: "project-1",
      projectName: "Project",
      workspaceId: "workspace-1",
      sessionId: "session-1",
      executionId: "execution-1",
      exitCode: 0,
    });

    expect(result).toEqual({ duplicate: false, posted: true });
    expect(mattermostClient.createPost).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: "channel-1",
        rootId: "root-1",
        props: expect.objectContaining({
          vk_bridge_origin: "vk-webhook",
          vk_webhook_delivery_id: "delivery-1",
        }),
      }),
    );
    await expect(
      store.getExecutionPostBinding("execution-1"),
    ).resolves.toMatchObject({
      messageId: "post-1",
      idempotencyKey: "vk-webhook-delivery:delivery-1",
    });

    const duplicate = await coordinator.handleVkWebhook({
      eventType: "execution.completed",
      deliveryId: "delivery-1",
      occurredAt: "2026-01-01T00:00:00.000Z",
      title: "Task Execution Completed",
      message: "Successfully completed again",
      taskId: null,
      taskTitle: null,
      projectId: null,
      projectName: null,
      workspaceId: "workspace-1",
      sessionId: "session-1",
      executionId: "execution-1",
      exitCode: 0,
    });

    expect(duplicate).toEqual({ duplicate: true, posted: false });
    expect(mattermostClient.createPost).toHaveBeenCalledTimes(1);
  });

  it("atomically reserves webhook deliveries before posting to Mattermost", async () => {
    const { deps, store, mattermostClient } = makeDeps();
    const coordinator = createMattermostCoordinator(deps);

    await store.upsertSessionThreadBinding({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      provider: "mattermost",
      channelId: "channel-1",
      threadId: "root-1",
    });

    let releasePost!: () => void;
    const postStarted = new Promise<void>((resolve) => {
      vi.mocked(mattermostClient.createPost).mockImplementationOnce(
        async ({ channelId, rootId }) => {
          resolve();
          await new Promise<void>((release) => {
            releasePost = release;
          });
          return {
            channelId,
            postId: "post-atomic",
            rootId: rootId ?? null,
          };
        },
      );
    });

    const event = {
      eventType: "execution.completed" as const,
      deliveryId: "delivery-atomic",
      occurredAt: "2026-01-01T00:00:00.000Z",
      title: "Task Execution Completed",
      message: "Done",
      taskId: null,
      taskTitle: null,
      projectId: null,
      projectName: null,
      workspaceId: "workspace-1",
      sessionId: "session-1",
      executionId: "execution-atomic",
      exitCode: 0,
    };

    const first = coordinator.handleVkWebhook(event);
    await postStarted;
    const second = coordinator.handleVkWebhook(event);
    await expect(second).resolves.toEqual({
      duplicate: true,
      posted: false,
    });
    releasePost();
    await expect(first).resolves.toEqual({
      duplicate: false,
      posted: true,
    });
    expect(mattermostClient.createPost).toHaveBeenCalledTimes(1);
  });

  it("uses VK webhooks as the primary running-session state", async () => {
    const { deps, store, vkClient } = makeDeps();
    const coordinator = createMattermostCoordinator(deps);

    await store.upsertSessionThreadBinding({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      provider: "mattermost",
      channelId: "channel-1",
      threadId: "root-1",
    });

    await coordinator.handleVkWebhook({
      eventType: "execution.started",
      deliveryId: "delivery-start",
      occurredAt: "2026-01-01T00:00:00.000Z",
      title: "Task Execution Started",
      message: "Started working on: Fix bridge",
      taskId: null,
      taskTitle: null,
      projectId: null,
      projectName: null,
      workspaceId: "workspace-1",
      sessionId: "session-1",
      executionId: "execution-1",
      exitCode: null,
    });

    await coordinator.handlePost({
      postId: "reply-1",
      channelId: "channel-1",
      rootId: "root-1",
      userId: "user-1",
      message: "Queue while running",
      props: {},
      createAt: Date.now(),
      isBotPost: false,
    });

    expect(vkClient.queueFollowUp).toHaveBeenCalledTimes(1);

    await coordinator.handleVkWebhook({
      eventType: "execution.completed",
      deliveryId: "delivery-complete",
      occurredAt: "2026-01-01T00:01:00.000Z",
      title: "Task Execution Completed",
      message: "Done",
      taskId: null,
      taskTitle: null,
      projectId: null,
      projectName: null,
      workspaceId: "workspace-1",
      sessionId: "session-1",
      executionId: "execution-1",
      exitCode: 0,
    });

    await coordinator.handlePost({
      postId: "reply-2",
      channelId: "channel-1",
      rootId: "root-1",
      userId: "user-1",
      message: "Follow up when idle",
      props: {},
      createAt: Date.now(),
      isBotPost: false,
    });

    expect(vkClient.followUp).toHaveBeenCalledTimes(1);
  });

  it("creates a repo team and workspace channel for first VK webhooks without slash setup", async () => {
    const { deps, store, mattermostClient } = makeDeps();
    const coordinator = createMattermostCoordinator(deps);

    const event = {
      eventType: "execution.started" as const,
      deliveryId: "delivery-race",
      occurredAt: "2026-01-01T00:00:00.000Z",
      title: "Task Execution Started",
      message: "Started working on: Race",
      taskId: null,
      taskTitle: null,
      projectId: null,
      projectName: null,
      workspaceId: "workspace-race",
      sessionId: "session-race",
      executionId: "execution-race",
      exitCode: null,
    };

    await expect(coordinator.handleVkWebhook(event)).resolves.toEqual({
      duplicate: false,
      posted: true,
    });

    expect(mattermostClient.createTeam).toHaveBeenCalledWith({
      name: "repo-one",
      displayName: "Repo One",
    });
    expect(mattermostClient.createChannel).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: "team-repo-one",
      }),
    );
    await expect(
      store.getWorkspaceBinding("workspace-race"),
    ).resolves.toMatchObject({
      provider: "mattermost",
      spaceId: "team-repo-one",
      channelId: "channel-1",
    });
    await expect(
      store.getSessionThreadBinding("session-race"),
    ).resolves.toMatchObject({
      channelId: "channel-1",
      threadId: "post-1",
    });

    await expect(coordinator.handleVkWebhook(event)).resolves.toEqual({
      duplicate: true,
      posted: false,
    });
  });

  it("uses the first alphabetically mapped repo for multi-repo workspace webhooks", async () => {
    const { deps, store, vkClient, mattermostClient } = makeDeps();
    const coordinator = createMattermostCoordinator(deps);

    vi.mocked(vkClient.listWorkspaceRepos).mockResolvedValue([
      {
        id: "repo-z",
        name: "zulu",
        displayName: "Zulu",
        targetBranch: "main",
      },
      {
        id: "repo-a",
        name: "alpha",
        displayName: "Alpha",
        targetBranch: "main",
      },
    ]);
    await store.upsertRepoChatRoute({
      repoId: "repo-z",
      provider: "mattermost",
      spaceId: "team-z",
      spaceLabel: "Team Z",
      priority: 0,
      enabled: true,
    });

    await expect(
      coordinator.handleVkWebhook({
        eventType: "execution.completed",
        deliveryId: "delivery-multi",
        occurredAt: "2026-01-01T00:00:00.000Z",
        title: "Task Execution Completed",
        message: "Done",
        taskId: null,
        taskTitle: null,
        projectId: null,
        projectName: null,
        workspaceId: "workspace-1",
        sessionId: "session-1",
        executionId: "execution-1",
        exitCode: 0,
      }),
    ).resolves.toEqual({
      duplicate: false,
      posted: true,
    });

    expect(mattermostClient.createTeam).not.toHaveBeenCalled();
    expect(mattermostClient.createChannel).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: "team-z",
      }),
    );
  });
});

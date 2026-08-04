// @platform "node"
import { serverRegistry } from "springboard/server/register";

import {
  createChatIntegrationStore,
  type SqliteChatIntegrationStoreOptions,
} from "./lib/chat-integration/db";
import type {
  ChatIntegrationStore,
  ChatRoutingOverview,
  ChatSpaceOption,
  ChatProviderStatus,
  RepoChatRouteUpsertInput,
} from "./lib/chat-integration/types";
import {
  loadMattermostBridgeDbPath,
  loadMattermostIntegrationConfig,
} from "./lib/mm-integration/config";
import { createMattermostCoordinator } from "./lib/mm-integration/coordinator";
import { createMattermostBridgeClient } from "./lib/mm-integration/mm-client";
import {
  createMattermostPostPoller,
  parseMattermostSlashCommandRequest,
  type MattermostPostPoller,
} from "./lib/mm-integration/mm-watchers";
import type {
  MattermostBridgeClient,
  MattermostCoordinator,
  MattermostIntegrationConfig,
} from "./lib/mm-integration/types";
import { createVkBridgeClient } from "./lib/mm-integration/vk-client";
import {
  parseVkWebhookEvent,
  verifyVkWebhookSignature,
} from "./lib/mm-integration/vk-webhook";
import {
  createWorkspaceSummaryPoller,
  type VkWorkspaceSummaryPoller,
} from "./lib/mm-integration/vk-watchers";

const DEFAULT_SLASH_ROUTES = [
  "/api/mattermost/slash",
  "/api/mattermost/slash-command",
];

type RuntimeState = {
  startPromise: Promise<void> | null;
  started: boolean;
  startupError: Error | null;
  dbPath: string | null;
  store: ChatIntegrationStore | null;
  config: MattermostIntegrationConfig | null;
  mattermostClient: MattermostBridgeClient | null;
  coordinator: MattermostCoordinator | null;
  summaryPoller: VkWorkspaceSummaryPoller | null;
  postPoller: MattermostPostPoller | null;
};

const runtimeState: RuntimeState = {
  startPromise: null,
  started: false,
  startupError: null,
  dbPath: null,
  store: null,
  config: null,
  mattermostClient: null,
  coordinator: null,
  summaryPoller: null,
  postPoller: null,
};

function logPrefix() {
  return "[chat-integration]";
}

function getStoreOptions(
  dbPath: string,
  config: MattermostIntegrationConfig | null,
): SqliteChatIntegrationStoreOptions {
  return {
    dbPath,
    legacyMattermostSpaceId: config?.mattermost.teamId ?? undefined,
  };
}

function success<T>(data: T) {
  return {
    success: true as const,
    data,
  };
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function ensureRuntime(): Promise<RuntimeState> {
  if (runtimeState.started) {
    return runtimeState;
  }

  if (!runtimeState.startPromise) {
    runtimeState.startPromise = (async () => {
      const dbPath = loadMattermostBridgeDbPath();
      runtimeState.dbPath = dbPath;

      let config: MattermostIntegrationConfig | null = null;
      try {
        config = loadMattermostIntegrationConfig();
        runtimeState.config = config;
      } catch (error) {
        runtimeState.startupError =
          error instanceof Error ? error : new Error(String(error));
      }

      const store = createChatIntegrationStore(getStoreOptions(dbPath, config));
      runtimeState.store = store;
      await store.ensureSchema();

      if (!config?.enabled) {
        return;
      }

      const mattermostClient = createMattermostBridgeClient({
        baseUrl: config.mattermost.baseUrl,
        botToken: config.mattermost.botToken,
        botUserId: config.mattermost.botUserId,
        logger: console,
      });
      const vkClient = createVkBridgeClient({
        baseUrl: config.vk.baseUrl,
        apiKey: config.vk.apiKey,
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
          console.warn(
            `${logPrefix()} summary poll failed: ${safeErrorMessage(error)}`,
          );
        },
      });
      summaryPoller.start();
      await summaryPoller.refresh().catch((error) => {
        console.warn(
          `${logPrefix()} initial summary poll failed: ${safeErrorMessage(error)}`,
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
          console.warn(
            `${logPrefix()} post poll failed: ${safeErrorMessage(error)}`,
          );
        },
      });
      postPoller.start();
      await postPoller.refresh().catch((error) => {
        console.warn(
          `${logPrefix()} initial post poll failed: ${safeErrorMessage(error)}`,
        );
      });

      runtimeState.mattermostClient = mattermostClient;
      runtimeState.coordinator = coordinator;
      runtimeState.summaryPoller = summaryPoller;
      runtimeState.postPoller = postPoller;
    })()
      .catch((error) => {
        runtimeState.startupError =
          error instanceof Error ? error : new Error(String(error));
      })
      .finally(() => {
        runtimeState.started = true;
      });
  }

  await runtimeState.startPromise;
  return runtimeState;
}

async function buildRoutingOverview(): Promise<ChatRoutingOverview> {
  const state = await ensureRuntime();
  if (!state.store) {
    throw new Error("Chat integration store was not initialized");
  }

  let availableSpaces: ChatSpaceOption[] = [];
  if (state.mattermostClient) {
    try {
      const teams = await state.mattermostClient.listTeams();
      availableSpaces = teams
        .map((team) => ({
          provider: "mattermost" as const,
          spaceId: team.id,
          spaceLabel: team.displayName || team.name,
        }))
        .sort((left, right) =>
          (left.spaceLabel ?? left.spaceId).localeCompare(
            right.spaceLabel ?? right.spaceId,
          ),
        );
    } catch (error) {
      console.warn(
        `${logPrefix()} failed to list Mattermost teams: ${safeErrorMessage(error)}`,
      );
    }
  }

  const providerStatuses: ChatProviderStatus[] = [
    {
      provider: "mattermost",
      enabled: Boolean(state.config?.enabled),
      configured: Boolean(
        state.config?.mattermost.baseUrl && state.config?.mattermost.botToken,
      ),
      defaultSpaceId: state.config?.mattermost.teamId ?? null,
      defaultSpaceLabel:
        availableSpaces.find(
          (space) => space.spaceId === state.config?.mattermost.teamId,
        )?.spaceLabel ?? null,
    },
  ];

  return {
    providerStatuses,
    availableSpaces,
    repoRoutes: await state.store.listRepoChatRoutes(),
    workspaceBindings: await state.store.listWorkspaceBindings(),
  };
}

function configuredSlashRoutes(): string[] {
  try {
    const config = loadMattermostIntegrationConfig();
    return Array.from(
      new Set([...DEFAULT_SLASH_ROUTES, config.slashCommandPath]),
    );
  } catch {
    return DEFAULT_SLASH_ROUTES;
  }
}

serverRegistry.registerServerModule(({ hono }) => {
  void ensureRuntime();

  hono.get("/api/chat/health", async (c) => {
    const state = await ensureRuntime();
    return c.json({
      ok: true,
      ready: Boolean(state.coordinator),
      enabled: Boolean(state.config?.enabled),
      configured: Boolean(
        state.config?.mattermost.baseUrl && state.config?.mattermost.botToken,
      ),
      dbPath: state.dbPath,
      startupError: state.startupError?.message ?? null,
      slashCommandPath: state.config?.slashCommandPath ?? null,
      vkWebhookPath: state.config?.vk.webhookPath ?? null,
      workspaceSummaryPollMs: state.config?.workspaceSummaryPollMs ?? null,
      postPollMs: state.config?.mattermost.postReconciliationPollMs ?? null,
      postReconciliationPollMs:
        state.config?.mattermost.postReconciliationPollMs ?? null,
      postReconnectBackfillDelayMs:
        state.config?.mattermost.postReconnectBackfillDelayMs ?? null,
      websocketEnabled: state.config?.mattermost.websocketEnabled ?? null,
      postTransport: state.postPoller?.getHealth() ?? null,
    });
  });

  hono.get("/api/mattermost/health", async (c) => {
    const state = await ensureRuntime();
    const coordinatorHealth = state.coordinator
      ? await state.coordinator.getHealth()
      : {
          ok: true,
          ready: false,
          runningSessionCount: 0,
        };

    return c.json({
      ...coordinatorHealth,
      enabled: Boolean(state.config?.enabled),
      configured: Boolean(
        state.config?.mattermost.baseUrl && state.config?.mattermost.botToken,
      ),
      dbPath: state.dbPath,
      startupError: state.startupError?.message ?? null,
      slashCommandPath: state.config?.slashCommandPath ?? null,
      vkWebhookPath: state.config?.vk.webhookPath ?? null,
      postPollMs: state.config?.mattermost.postReconciliationPollMs ?? null,
      postReconciliationPollMs:
        state.config?.mattermost.postReconciliationPollMs ?? null,
      postReconnectBackfillDelayMs:
        state.config?.mattermost.postReconnectBackfillDelayMs ?? null,
      websocketEnabled: state.config?.mattermost.websocketEnabled ?? null,
      postTransport: state.postPoller?.getHealth() ?? null,
    });
  });

  hono.get("/api/chat/routing", async (c) => {
    return c.json(success(await buildRoutingOverview()));
  });

  hono.post("/api/chat/routing/routes", async (c) => {
    const state = await ensureRuntime();
    if (!state.store) {
      return c.json(
        { success: false, error: "Chat integration store unavailable" },
        503,
      );
    }

    const body = (await c.req.json()) as RepoChatRouteUpsertInput;
    const saved = await state.store.upsertRepoChatRoute({
      repoId: body.repoId,
      provider: body.provider,
      spaceId: body.spaceId,
      spaceLabel: body.spaceLabel ?? null,
      priority: body.priority,
      enabled: body.enabled,
    });

    return c.json(success(saved), 201);
  });

  hono.put("/api/chat/routing/routes/:routeId", async (c) => {
    const state = await ensureRuntime();
    if (!state.store) {
      return c.json(
        { success: false, error: "Chat integration store unavailable" },
        503,
      );
    }

    const routeId = Number.parseInt(c.req.param("routeId"), 10);
    if (!Number.isFinite(routeId)) {
      return c.json({ success: false, error: "Invalid route id" }, 400);
    }

    const body = (await c.req.json()) as RepoChatRouteUpsertInput;
    const saved = await state.store.upsertRepoChatRoute({
      id: routeId,
      repoId: body.repoId,
      provider: body.provider,
      spaceId: body.spaceId,
      spaceLabel: body.spaceLabel ?? null,
      priority: body.priority,
      enabled: body.enabled,
    });

    return c.json(success(saved));
  });

  hono.delete("/api/chat/routing/routes/:routeId", async (c) => {
    const state = await ensureRuntime();
    if (!state.store) {
      return c.json(
        { success: false, error: "Chat integration store unavailable" },
        503,
      );
    }

    const routeId = Number.parseInt(c.req.param("routeId"), 10);
    if (!Number.isFinite(routeId)) {
      return c.json({ success: false, error: "Invalid route id" }, 400);
    }

    const deleted = await state.store.deleteRepoChatRoute(routeId);
    if (!deleted) {
      return c.json({ success: false, error: "Route not found" }, 404);
    }

    return c.json(success({ deleted: true }));
  });

  const handleSlash = async (request: Request) => {
    const state = await ensureRuntime();
    if (!state.config?.enabled || !state.coordinator) {
      throw new Error("Mattermost integration is not enabled");
    }

    const payload = await parseMattermostSlashCommandRequest(request);
    const expectedToken = state.config.mattermost.slashCommandToken?.trim();
    if (expectedToken && payload.token !== expectedToken) {
      const error = new Error("Invalid Mattermost slash command token");
      (error as Error & { status?: number }).status = 401;
      throw error;
    }

    return state.coordinator.handleSlashCommand(payload);
  };

  const handleVkWebhook = async (request: Request) => {
    const state = await ensureRuntime();
    if (!state.config?.enabled || !state.coordinator) {
      throw new Error("Mattermost integration is not enabled");
    }

    const body = await request.text();
    const signature = request.headers.get("x-vk-webhook-signature");
    const timestamp = request.headers.get("x-vk-webhook-timestamp");
    if (
      !verifyVkWebhookSignature({
        secret: state.config.vk.webhookSecret,
        timestamp,
        signature,
        body,
      })
    ) {
      const error = new Error("Invalid VK webhook signature");
      (error as Error & { status?: number }).status = 401;
      throw error;
    }

    const event = parseVkWebhookEvent(body);
    return state.coordinator.handleVkWebhook(event);
  };

  for (const routePath of configuredSlashRoutes()) {
    hono.post(routePath, async (c) => {
      try {
        return c.json(await handleSlash(c.req.raw));
      } catch (error) {
        const status: 401 | 500 =
          error instanceof Error && "status" in error && error.status === 401
            ? 401
            : 500;
        return c.json(
          {
            responseType: "ephemeral",
            text: safeErrorMessage(error),
          },
          status,
        );
      }
    });
  }

  hono.post("/api/mattermost/vk-webhook", async (c) => {
    try {
      return c.json(success(await handleVkWebhook(c.req.raw)));
    } catch (error) {
      const status: 400 | 401 | 500 =
        error instanceof Error && "status" in error && error.status === 401
          ? 401
          : error instanceof SyntaxError
            ? 400
            : 500;
      return c.json({ success: false, error: safeErrorMessage(error) }, status);
    }
  });

  try {
    const configuredWebhookPath = loadMattermostIntegrationConfig().vk.webhookPath;
    if (configuredWebhookPath !== "/api/mattermost/vk-webhook") {
      hono.post(configuredWebhookPath, async (c) => {
        try {
          return c.json(success(await handleVkWebhook(c.req.raw)));
        } catch (error) {
          const status: 400 | 401 | 500 =
            error instanceof Error && "status" in error && error.status === 401
              ? 401
              : error instanceof SyntaxError
                ? 400
                : 500;
          return c.json(
            { success: false, error: safeErrorMessage(error) },
            status,
          );
        }
      });
    }
  } catch {
    // If config is invalid, ensureRuntime exposes that via health; keep default route.
  }
});
// @platform end

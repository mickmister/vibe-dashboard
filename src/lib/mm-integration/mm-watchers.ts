import { buildMattermostWebSocketUrl } from "./mm-client";
import type {
  MattermostBridgeClient,
  MattermostBridgeStore,
  JsonObject,
  MattermostPostEvent,
  MattermostPostTransportHealth,
  MattermostSlashCommandRequest,
} from "./types";

function asString(
  value: FormDataEntryValue | string | null | undefined,
): string {
  if (typeof value === "string") {
    return value;
  }

  return value?.toString() ?? "";
}

function toJsonObject(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as JsonObject;
}

function normalizeRootId(rootId: string | null | undefined): string | null {
  const trimmed = rootId?.trim();
  return trimmed ? trimmed : null;
}

function isMattermostBotPost(input: {
  type?: string;
  props: JsonObject;
  userId: string;
  botUserId?: string;
}): boolean {
  const type = input.type ?? "";
  if (type.startsWith("system_")) {
    return true;
  }

  if (input.botUserId && input.userId === input.botUserId) {
    return true;
  }

  return (
    input.props["vk_bridge_origin"] === "mattermost-bot" ||
    input.props["from_webhook"] === "true" ||
    input.props["from_webhook"] === true ||
    input.props["from_bot"] === "true" ||
    input.props["from_bot"] === true
  );
}

export async function parseMattermostSlashCommandRequest(
  request: Request,
): Promise<MattermostSlashCommandRequest> {
  const form = await request.formData();

  return {
    channelId: asString(form.get("channel_id")),
    channelName: asString(form.get("channel_name")),
    teamId: asString(form.get("team_id")),
    teamDomain: asString(form.get("team_domain")),
    token: asString(form.get("token")) || undefined,
    userId: asString(form.get("user_id")),
    userName: asString(form.get("user_name")),
    triggerId: asString(form.get("trigger_id")) || undefined,
    text: asString(form.get("text")),
    command: asString(form.get("command")),
    responseUrl: asString(form.get("response_url")) || undefined,
  };
}

type MattermostWebsocketEnvelope = {
  event?: string;
  status?: string;
  seq_reply?: number;
  error?: unknown;
  message?: unknown;
  data?: {
    post?: string;
  };
};

type MattermostPostPayload = {
  id?: string;
  channel_id?: string;
  root_id?: string;
  user_id?: string;
  message?: string;
  props?: unknown;
  create_at?: number;
  type?: string;
};

type MattermostChannelPostsResponse = {
  order?: string[];
  posts?: Record<string, MattermostPostPayload>;
};

type MattermostPostPollerChannelState = {
  sinceMs: number;
  recentPostIds: string[];
};

type MattermostPostPollerState = {
  channels?: Record<string, Partial<MattermostPostPollerChannelState>>;
};

const POST_POLLER_STATE_KEY = "mattermost-post-poller-v1";
const MAX_RECENT_POST_IDS = 64;
const DEFAULT_WS_RECONNECT_MIN_MS = 1_000;
const DEFAULT_WS_RECONNECT_MAX_MS = 30_000;
const DEFAULT_WS_BACKFILL_DELAY_MS = 2_000;

export type MattermostWebSocketFactory = (url: string) => WebSocket;

export interface MattermostPostPoller {
  start(): void;
  stop(): void;
  refresh(): Promise<void>;
  getHealth(): MattermostPostTransportHealth;
}

interface MattermostPostPollerOptions {
  store: MattermostBridgeStore;
  mattermostClient: Pick<MattermostBridgeClient, "listChannelPostsSince">;
  reconciliationPollMs?: number;
  pollMs?: number;
  websocket?: {
    enabled?: boolean;
    baseUrl: string;
    token: string;
    botUserId?: string;
    reconnectMinMs?: number;
    reconnectMaxMs?: number;
    backfillDelayMs?: number;
    createWebSocket?: MattermostWebSocketFactory;
  };
  onPost: (event: MattermostPostEvent) => Promise<void> | void;
  onError?: (error: unknown) => void;
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createDefaultWebSocket(url: string): WebSocket {
  return new WebSocket(url);
}

function asNonNegativeInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return 0;
  }

  return Math.trunc(value);
}

function normalizeChannelState(
  value: Partial<MattermostPostPollerChannelState> | null | undefined,
): MattermostPostPollerChannelState {
  const recentPostIds = Array.isArray(value?.recentPostIds)
    ? value.recentPostIds.filter(
        (postId): postId is string =>
          typeof postId === "string" && postId.trim().length > 0,
      )
    : [];

  return {
    sinceMs: asNonNegativeInteger(value?.sinceMs),
    recentPostIds: recentPostIds.slice(-MAX_RECENT_POST_IDS),
  };
}

function normalizePollerState(value: unknown): MattermostPostPollerState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      channels: {},
    };
  }

  const rawChannels = (value as MattermostPostPollerState).channels;
  const channels: Record<string, MattermostPostPollerChannelState> = {};

  for (const [channelId, channelState] of Object.entries(rawChannels ?? {})) {
    const trimmedChannelId = channelId.trim();
    if (!trimmedChannelId) {
      continue;
    }

    channels[trimmedChannelId] = normalizeChannelState(channelState);
  }

  return {
    channels,
  };
}

function withRecentPostId(
  state: MattermostPostPollerChannelState,
  postId: string,
): string[] {
  const next = [
    ...state.recentPostIds.filter((candidate) => candidate !== postId),
    postId,
  ];
  return next.slice(-MAX_RECENT_POST_IDS);
}

function shouldSkipPost(
  state: MattermostPostPollerChannelState,
  event: MattermostPostEvent,
): boolean {
  if (state.recentPostIds.includes(event.postId)) {
    return true;
  }

  return event.createAt < state.sinceMs;
}

function advanceChannelState(
  state: MattermostPostPollerChannelState,
  event: MattermostPostEvent,
): MattermostPostPollerChannelState {
  return {
    sinceMs: Math.max(state.sinceMs, asNonNegativeInteger(event.createAt)),
    recentPostIds: withRecentPostId(state, event.postId),
  };
}

function maybeUnrefTimer(
  timer: ReturnType<typeof setInterval> | ReturnType<typeof setTimeout>,
) {
  (timer as typeof timer & { unref?: () => void }).unref?.();
}

function isMattermostAuthAck(payload: unknown, seq: number): boolean {
  const envelope = payload as MattermostWebsocketEnvelope | null;
  return envelope?.status === "OK" && envelope.seq_reply === seq;
}

function getMattermostAuthError(payload: unknown, seq: number): Error | null {
  const envelope = payload as MattermostWebsocketEnvelope | null;
  if (!envelope || envelope.seq_reply !== seq || envelope.status === "OK") {
    return null;
  }

  const message =
    typeof envelope.error === "string"
      ? envelope.error
      : envelope.error && typeof envelope.error === "object"
        ? ((envelope.error as Record<string, unknown>).message ??
          (envelope.error as Record<string, unknown>).detailed_error)
        : envelope.message;

  const normalizedMessage =
    typeof message === "string" && message.trim().length > 0
      ? message
      : "Mattermost websocket authentication failed";

  return new Error(normalizedMessage);
}

export function normalizeMattermostApiPost(
  post: unknown,
  options: {
    botUserId?: string;
  } = {},
): MattermostPostEvent | null {
  const payload = post as MattermostPostPayload | null;
  if (!payload?.id || !payload.channel_id || !payload.user_id) {
    return null;
  }

  const props = toJsonObject(payload.props);

  return {
    postId: payload.id,
    channelId: payload.channel_id,
    rootId: normalizeRootId(payload.root_id),
    userId: payload.user_id,
    message: payload.message ?? "",
    props,
    createAt: payload.create_at ?? Date.now(),
    isBotPost: isMattermostBotPost({
      type: payload.type,
      props,
      userId: payload.user_id,
      botUserId: options.botUserId,
    }),
  };
}

export function normalizeMattermostApiPosts(
  payload: unknown,
  options: {
    botUserId?: string;
  } = {},
): MattermostPostEvent[] {
  const response = payload as MattermostChannelPostsResponse | null;
  const posts = response?.posts ?? {};
  const order = response?.order ?? Object.keys(posts);

  return order
    .map((postId) => normalizeMattermostApiPost(posts[postId], options))
    .filter((post): post is MattermostPostEvent => post !== null)
    .sort((left, right) => left.createAt - right.createAt);
}

export function normalizeMattermostPostEvent(
  payload: unknown,
  options: {
    botUserId?: string;
  } = {},
): MattermostPostEvent | null {
  const envelope = payload as MattermostWebsocketEnvelope | null;
  if (!envelope || envelope.event !== "posted") {
    return null;
  }

  const rawPost = envelope.data?.post;
  if (!rawPost) {
    return null;
  }

  let post: MattermostPostPayload;
  try {
    post = JSON.parse(rawPost) as MattermostPostPayload;
  } catch {
    return null;
  }

  if (!post.id || !post.channel_id || !post.user_id) {
    return null;
  }

  return normalizeMattermostApiPost(post, options);
}

export function createMattermostPostPoller(
  options: MattermostPostPollerOptions,
): MattermostPostPoller {
  const reconciliationPollMs = options.reconciliationPollMs ?? options.pollMs;
  if (
    typeof reconciliationPollMs !== "number" ||
    !Number.isFinite(reconciliationPollMs) ||
    reconciliationPollMs <= 0
  ) {
    throw new Error(
      "Mattermost post reconciliation poll interval must be a positive integer",
    );
  }

  const websocketEnabled =
    options.websocket?.enabled !== false &&
    Boolean(options.websocket?.baseUrl) &&
    Boolean(options.websocket?.token);
  const websocketUrl = websocketEnabled
    ? buildMattermostWebSocketUrl(options.websocket!.baseUrl)
    : null;
  const createWebSocket =
    options.websocket?.createWebSocket ?? createDefaultWebSocket;
  const reconnectMinMs = Math.max(
    1,
    options.websocket?.reconnectMinMs ?? DEFAULT_WS_RECONNECT_MIN_MS,
  );
  const reconnectMaxMs = Math.max(
    reconnectMinMs,
    options.websocket?.reconnectMaxMs ?? DEFAULT_WS_RECONNECT_MAX_MS,
  );
  const reconnectBackfillDelayMs = Math.max(
    0,
    options.websocket?.backfillDelayMs ?? DEFAULT_WS_BACKFILL_DELAY_MS,
  );

  let timer: ReturnType<typeof setInterval> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectBackfillTimer: ReturnType<typeof setTimeout> | null = null;
  let activeSocket: WebSocket | null = null;
  let started = false;
  let refreshQueued = false;
  let refreshPromise: Promise<void> | null = null;
  let websocketAuthSeq = 0;
  let websocketReconnectAttempt = 0;
  let statePromise: Promise<MattermostPostPollerState> | null = null;
  let processingTail = Promise.resolve();

  const health: MattermostPostTransportHealth = {
    websocketEnabled,
    websocketUrl,
    websocketConnected: false,
    websocketAuthenticated: false,
    websocketReconnectAttempt: 0,
    websocketReconnectScheduled: false,
    websocketReconnectMinMs: reconnectMinMs,
    websocketReconnectMaxMs: reconnectMaxMs,
    reconnectBackfillDelayMs,
    reconciliationPollMs,
    lastWebsocketConnectAt: null,
    lastWebsocketDisconnectAt: null,
    lastWebsocketEventAt: null,
    lastReconciliationAt: null,
    lastReconciliationReason: null,
    lastReconciliationError: null,
  };

  function enqueueProcessing<T>(task: () => Promise<T>): Promise<T> {
    const run = processingTail.then(task, task);
    processingTail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async function loadState(): Promise<MattermostPostPollerState> {
    if (!statePromise) {
      statePromise = options.store
        .getConnectorState<MattermostPostPollerState>(POST_POLLER_STATE_KEY)
        .then((state) => normalizePollerState(state));
    }

    return statePromise;
  }

  async function persistState(state: MattermostPostPollerState): Promise<void> {
    statePromise = Promise.resolve(state);
    await options.store.setConnectorState(POST_POLLER_STATE_KEY, state);
  }

  async function processPostEvent(
    event: MattermostPostEvent,
  ): Promise<boolean> {
    return enqueueProcessing(async () => {
      const workspaceBinding =
        await options.store.getWorkspaceBindingByChannelId(
          "mattermost",
          event.channelId,
        );
      if (!workspaceBinding) {
        return false;
      }

      const state = await loadState();
      const currentChannelState = normalizeChannelState(
        state.channels?.[event.channelId],
      );
      if (shouldSkipPost(currentChannelState, event)) {
        return false;
      }

      await options.onPost(event);
      state.channels ??= {};
      state.channels[event.channelId] = advanceChannelState(
        currentChannelState,
        event,
      );
      await persistState(state);
      return true;
    });
  }

  async function cleanupUnmappedChannels(
    mappedChannelIds: Set<string>,
  ): Promise<void> {
    await enqueueProcessing(async () => {
      const state = await loadState();
      const channels = state.channels ?? {};
      let changed = false;

      for (const channelId of Object.keys(channels)) {
        if (mappedChannelIds.has(channelId)) {
          continue;
        }

        delete channels[channelId];
        changed = true;
      }

      if (changed) {
        await persistState(state);
      }
    });
  }

  async function runRefresh(reason: string): Promise<void> {
    let sawError = false;

    try {
      const state = await loadState();
      const mappings = await options.store.listWorkspaceBindings("mattermost");
      const mappedChannelIds = new Set(
        mappings.map((mapping) => mapping.channelId),
      );

      for (const mapping of mappings) {
        const sinceMs = normalizeChannelState(
          state.channels?.[mapping.channelId],
        ).sinceMs;
        const posts = await options.mattermostClient.listChannelPostsSince(
          mapping.channelId,
          sinceMs,
        );

        for (const post of posts) {
          try {
            await processPostEvent(post);
          } catch (error) {
            sawError = true;
            options.onError?.(error);
          }
        }
      }

      await cleanupUnmappedChannels(mappedChannelIds);
      health.lastReconciliationAt = new Date().toISOString();
      health.lastReconciliationReason = reason;
      health.lastReconciliationError = sawError
        ? "One or more Mattermost posts failed during reconciliation."
        : null;
    } catch (error) {
      health.lastReconciliationError = safeErrorMessage(error);
      options.onError?.(error);
    }
  }

  async function scheduleRefresh(reason: string): Promise<void> {
    if (refreshPromise) {
      refreshQueued = true;
      return refreshPromise;
    }

    refreshPromise = (async () => {
      let nextReason: string | null = reason;

      while (nextReason) {
        refreshQueued = false;
        await runRefresh(nextReason);
        nextReason = refreshQueued ? "queued" : null;
      }
    })().finally(() => {
      refreshPromise = null;
    });

    return refreshPromise;
  }

  function clearReconnectTimer() {
    if (!reconnectTimer) {
      return;
    }

    clearTimeout(reconnectTimer);
    reconnectTimer = null;
    health.websocketReconnectScheduled = false;
  }

  function clearReconnectBackfillTimer() {
    if (!reconnectBackfillTimer) {
      return;
    }

    clearTimeout(reconnectBackfillTimer);
    reconnectBackfillTimer = null;
  }

  function scheduleReconnectBackfill() {
    if (!started) {
      return;
    }

    clearReconnectBackfillTimer();

    const run = () => {
      reconnectBackfillTimer = null;
      void scheduleRefresh("websocket-backfill");
    };

    if (reconnectBackfillDelayMs === 0) {
      run();
      return;
    }

    reconnectBackfillTimer = setTimeout(run, reconnectBackfillDelayMs);
    maybeUnrefTimer(reconnectBackfillTimer);
  }

  function scheduleReconnect() {
    if (!started || !websocketEnabled || reconnectTimer) {
      return;
    }

    websocketReconnectAttempt += 1;
    health.websocketReconnectAttempt = websocketReconnectAttempt;
    health.websocketReconnectScheduled = true;

    const delay = Math.min(
      reconnectMaxMs,
      reconnectMinMs * 2 ** Math.max(0, websocketReconnectAttempt - 1),
    );

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      health.websocketReconnectScheduled = false;
      connectWebSocket();
    }, delay);
    maybeUnrefTimer(reconnectTimer);
  }

  function connectWebSocket() {
    if (!started || !websocketEnabled || activeSocket || !websocketUrl) {
      return;
    }

    clearReconnectTimer();

    const socket = createWebSocket(websocketUrl);
    activeSocket = socket;
    const authSeq = ++websocketAuthSeq;

    socket.addEventListener("open", () => {
      if (activeSocket !== socket) {
        return;
      }

      health.websocketConnected = true;
      health.websocketAuthenticated = false;
      health.lastWebsocketConnectAt = new Date().toISOString();

      try {
        socket.send(
          JSON.stringify({
            seq: authSeq,
            action: "authentication_challenge",
            data: {
              token: options.websocket?.token,
            },
          }),
        );
      } catch (error) {
        options.onError?.(error);
        socket.close();
      }
    });

    socket.addEventListener("message", (event) => {
      if (activeSocket !== socket) {
        return;
      }

      let payload: unknown;
      try {
        payload = JSON.parse(String(event.data));
      } catch (error) {
        options.onError?.(error);
        return;
      }

      if (isMattermostAuthAck(payload, authSeq)) {
        websocketReconnectAttempt = 0;
        health.websocketAuthenticated = true;
        health.websocketReconnectAttempt = 0;
        scheduleReconnectBackfill();
        return;
      }

      const authError = getMattermostAuthError(payload, authSeq);
      if (authError) {
        options.onError?.(authError);
        socket.close();
        return;
      }

      const normalized = normalizeMattermostPostEvent(payload, {
        botUserId: options.websocket?.botUserId,
      });
      if (!normalized) {
        return;
      }

      health.lastWebsocketEventAt = new Date().toISOString();
      void processPostEvent(normalized).catch((error) => {
        options.onError?.(error);
      });
    });

    socket.addEventListener("error", (event) => {
      options.onError?.(event);
    });

    socket.addEventListener("close", () => {
      if (activeSocket === socket) {
        activeSocket = null;
      }

      health.websocketConnected = false;
      health.websocketAuthenticated = false;
      health.lastWebsocketDisconnectAt = new Date().toISOString();
      clearReconnectBackfillTimer();
      scheduleReconnect();
    });
  }

  return {
    start() {
      if (started) {
        return;
      }

      started = true;
      if (timer) {
        clearInterval(timer);
      }

      timer = setInterval(() => {
        void scheduleRefresh("periodic");
      }, reconciliationPollMs);
      maybeUnrefTimer(timer);

      connectWebSocket();
    },

    stop() {
      started = false;

      clearReconnectTimer();
      clearReconnectBackfillTimer();

      if (timer) {
        clearInterval(timer);
        timer = null;
      }

      const socket = activeSocket;
      activeSocket = null;
      health.websocketConnected = false;
      health.websocketAuthenticated = false;
      socket?.close();
    },

    async refresh() {
      await scheduleRefresh("manual");
    },

    getHealth() {
      return {
        ...health,
      };
    },
  };
}

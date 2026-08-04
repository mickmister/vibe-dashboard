import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createMattermostPostPoller,
  normalizeMattermostApiPost,
  normalizeMattermostPostEvent,
  parseMattermostSlashCommandRequest,
} from "./mm-watchers";

class FakeWebSocket {
  readonly sent: string[] = [];

  private readonly listeners = new Map<string, Array<(event: any) => void>>();

  addEventListener(type: string, listener: (event: any) => void) {
    const existing = this.listeners.get(type) ?? [];
    existing.push(listener);
    this.listeners.set(type, existing);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.emit("close", {});
  }

  emitOpen() {
    this.emit("open", {});
  }

  emitMessage(data: unknown) {
    this.emit("message", {
      data: JSON.stringify(data),
    });
  }

  emitClose() {
    this.emit("close", {});
  }

  private emit(type: string, event: unknown) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

function makeStore(initialState: unknown = null) {
  let connectorState = initialState;
  const bindings = [
    {
      workspaceId: "workspace-1",
      provider: "mattermost" as const,
      spaceId: "team-1",
      spaceLabel: "team",
      channelId: "channel-1",
      channelName: "vk-test",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ];

  return {
    bindings,
    getConnectorState: () => connectorState,
    store: {
      listWorkspaceBindings: vi.fn(async () => bindings),
      getWorkspaceBindingByChannelId: vi.fn(
        async (_provider: string, channelId: string) => {
          return (
            bindings.find((binding) => binding.channelId === channelId) ?? null
          );
        },
      ),
      getConnectorState: vi.fn(async () => connectorState),
      tryReserveConnectorState: vi.fn(async (_key: string, value: unknown) => {
        if (connectorState) {
          return false;
        }
        connectorState = value;
        return true;
      }),
      deleteConnectorState: vi.fn(async () => {
        const existed = connectorState !== null;
        connectorState = null;
        return existed;
      }),
      setConnectorState: vi.fn(async (_key: string, value: unknown) => {
        connectorState = value;
      }),
    },
  };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("mm-watchers", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("parses Mattermost slash command form requests", async () => {
    const body = new URLSearchParams({
      channel_id: "channel-1",
      channel_name: "vk-test",
      team_id: "team-1",
      team_domain: "team",
      token: "secret-1",
      user_id: "user-1",
      user_name: "alice",
      trigger_id: "trigger-1",
      text: "fix the bug",
      command: "/vibe",
      response_url: "https://mattermost.local/response",
    });
    const request = new Request(
      "http://localhost/api/mattermost/commands/vibe",
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      },
    );

    const parsed = await parseMattermostSlashCommandRequest(request);

    expect(parsed).toEqual({
      channelId: "channel-1",
      channelName: "vk-test",
      teamId: "team-1",
      teamDomain: "team",
      token: "secret-1",
      userId: "user-1",
      userName: "alice",
      triggerId: "trigger-1",
      text: "fix the bug",
      command: "/vibe",
      responseUrl: "https://mattermost.local/response",
    });
  });

  it("normalizes posted websocket events into post events", () => {
    const normalized = normalizeMattermostPostEvent({
      event: "posted",
      data: {
        post: JSON.stringify({
          id: "post-1",
          channel_id: "channel-1",
          root_id: "root-1",
          user_id: "user-1",
          message: "hello",
          props: {
            custom: true,
          },
          create_at: 123,
        }),
      },
    });

    expect(normalized).toEqual({
      postId: "post-1",
      channelId: "channel-1",
      rootId: "root-1",
      userId: "user-1",
      message: "hello",
      props: {
        custom: true,
      },
      createAt: 123,
      isBotPost: false,
    });
  });

  it("filters out non-posted websocket payloads", () => {
    expect(normalizeMattermostPostEvent({ event: "hello" })).toBeNull();
  });

  it("normalizes Mattermost API posts and identifies bot posts", () => {
    const normalized = normalizeMattermostApiPost(
      {
        id: "post-1",
        channel_id: "channel-1",
        root_id: "",
        user_id: "bot-1",
        message: "hello",
        props: {
          from_bot: true,
        },
        create_at: 123,
      },
      {
        botUserId: "bot-1",
      },
    );

    expect(normalized).toEqual({
      postId: "post-1",
      channelId: "channel-1",
      rootId: null,
      userId: "bot-1",
      message: "hello",
      props: {
        from_bot: true,
      },
      createAt: 123,
      isBotPost: true,
    });
  });

  it("polls mapped channels, forwards new posts, and persists cursors", async () => {
    const handled: string[] = [];
    const { store, getConnectorState } = makeStore();
    const mattermostClient = {
      listChannelPostsSince: vi.fn(async () => [
        {
          postId: "post-1",
          channelId: "channel-1",
          rootId: "root-1",
          userId: "user-1",
          message: "reply",
          props: {},
          createAt: 100,
          isBotPost: false,
        },
      ]),
    };

    const poller = createMattermostPostPoller({
      store: store as any,
      mattermostClient: mattermostClient as any,
      reconciliationPollMs: 1000,
      onPost: async (event) => {
        handled.push(event.postId);
      },
    });

    await poller.refresh();

    expect(handled).toEqual(["post-1"]);
    expect(mattermostClient.listChannelPostsSince).toHaveBeenCalledWith(
      "channel-1",
      0,
    );
    expect(getConnectorState()).toEqual({
      channels: {
        "channel-1": {
          sinceMs: 100,
          recentPostIds: ["post-1"],
        },
      },
    });
  });

  it("deduplicates websocket-delivered posts during REST reconciliation", async () => {
    const handled: string[] = [];
    const { store } = makeStore();
    const sockets: FakeWebSocket[] = [];
    const mattermostClient = {
      listChannelPostsSince: vi.fn(async () => [
        {
          postId: "post-1",
          channelId: "channel-1",
          rootId: "root-1",
          userId: "user-1",
          message: "reply",
          props: {},
          createAt: 100,
          isBotPost: false,
        },
      ]),
    };

    const poller = createMattermostPostPoller({
      store: store as any,
      mattermostClient: mattermostClient as any,
      reconciliationPollMs: 60000,
      websocket: {
        baseUrl: "http://mattermost.local",
        token: "token-1",
        botUserId: "bot-1",
        backfillDelayMs: 999999,
        createWebSocket: (url) => {
          expect(url).toBe("ws://mattermost.local/api/v4/websocket");
          const socket = new FakeWebSocket();
          sockets.push(socket);
          return socket as unknown as WebSocket;
        },
      },
      onPost: async (event) => {
        handled.push(event.postId);
      },
    });

    poller.start();

    expect(sockets).toHaveLength(1);
    sockets[0]!.emitOpen();
    expect(JSON.parse(sockets[0]!.sent[0]!)).toEqual({
      seq: 1,
      action: "authentication_challenge",
      data: {
        token: "token-1",
      },
    });
    sockets[0]!.emitMessage({
      status: "OK",
      seq_reply: 1,
    });
    sockets[0]!.emitMessage({
      event: "posted",
      data: {
        post: JSON.stringify({
          id: "post-1",
          channel_id: "channel-1",
          root_id: "root-1",
          user_id: "user-1",
          message: "reply",
          props: {},
          create_at: 100,
        }),
      },
    });

    await flushPromises();
    await poller.refresh();

    expect(handled).toEqual(["post-1"]);
    expect(poller.getHealth().lastWebsocketEventAt).not.toBeNull();

    poller.stop();
  });

  it("reconnects websocket and schedules reconciliation backfill after reconnect", async () => {
    vi.useFakeTimers();

    const { store } = makeStore();
    const sockets: FakeWebSocket[] = [];
    const mattermostClient = {
      listChannelPostsSince: vi.fn(async () => []),
    };

    const poller = createMattermostPostPoller({
      store: store as any,
      mattermostClient: mattermostClient as any,
      reconciliationPollMs: 60000,
      websocket: {
        baseUrl: "http://mattermost.local",
        token: "token-1",
        reconnectMinMs: 100,
        reconnectMaxMs: 100,
        backfillDelayMs: 5,
        createWebSocket: () => {
          const socket = new FakeWebSocket();
          sockets.push(socket);
          return socket as unknown as WebSocket;
        },
      },
      onPost: async () => {},
    });

    poller.start();

    expect(sockets).toHaveLength(1);
    sockets[0]!.emitOpen();
    sockets[0]!.emitMessage({
      status: "OK",
      seq_reply: 1,
    });

    await vi.advanceTimersByTimeAsync(5);
    expect(mattermostClient.listChannelPostsSince).toHaveBeenCalledTimes(1);
    expect(poller.getHealth().websocketConnected).toBe(true);
    expect(poller.getHealth().websocketAuthenticated).toBe(true);

    sockets[0]!.emitClose();
    expect(poller.getHealth().websocketConnected).toBe(false);
    expect(poller.getHealth().websocketReconnectScheduled).toBe(true);

    await vi.advanceTimersByTimeAsync(100);
    expect(sockets).toHaveLength(2);

    sockets[1]!.emitOpen();
    sockets[1]!.emitMessage({
      status: "OK",
      seq_reply: 2,
    });

    await vi.advanceTimersByTimeAsync(5);
    expect(mattermostClient.listChannelPostsSince).toHaveBeenCalledTimes(2);
    expect(poller.getHealth().lastWebsocketDisconnectAt).not.toBeNull();

    poller.stop();
  });
});

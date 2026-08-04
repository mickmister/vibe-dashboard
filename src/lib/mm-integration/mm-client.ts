import type {
  JsonObject,
  MattermostBridgeClient,
  MattermostPostEvent,
  MattermostPostRef,
  MattermostTeamSummary,
} from "./types";
import { normalizeMattermostApiPosts } from "./mm-watchers";

export interface MattermostClientOptions {
  baseUrl: string;
  botToken: string;
  botUserId?: string;
  fetchImpl?: typeof fetch;
  typingIntervalMs?: number;
  logger?: Pick<Console, "warn">;
}

interface MattermostErrorResponse {
  id?: string;
  message?: string;
  detailed_error?: string;
  request_id?: string;
  status_code?: number;
}

interface MattermostChannelResponse {
  id: string;
  name: string;
}

interface MattermostTeamResponse {
  id: string;
  name: string;
  display_name: string;
}

interface MattermostPostResponse {
  id: string;
  channel_id: string;
  root_id?: string | null;
}

interface MattermostChannelPostsResponse {
  order?: string[];
  posts?: Record<
    string,
    {
      id?: string;
      channel_id?: string;
      root_id?: string | null;
      user_id?: string;
      message?: string;
      props?: unknown;
      create_at?: number;
      type?: string;
    }
  >;
}

function normalizeMattermostBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

export function buildMattermostApiUrl(baseUrl: string, path: string): string {
  return new URL(path, `${normalizeMattermostBaseUrl(baseUrl)}/`).toString();
}

export function buildMattermostWebSocketUrl(baseUrl: string): string {
  const url = new URL(buildMattermostApiUrl(baseUrl, "/api/v4/websocket"));
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

export class MattermostClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details: MattermostErrorResponse | null,
    readonly bodyText: string,
  ) {
    super(message);
    this.name = "MattermostClientError";
  }
}

export class MattermostClient implements MattermostBridgeClient {
  private readonly apiBaseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly typingIntervalMs: number;
  private readonly logger?: Pick<Console, "warn">;

  constructor(private readonly options: MattermostClientOptions) {
    this.apiBaseUrl = buildMattermostApiUrl(options.baseUrl, "/api/v4").replace(
      /\/$/,
      "",
    );
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.typingIntervalMs = options.typingIntervalMs ?? 4000;
    this.logger = options.logger;
  }

  async createTeam(input: {
    name: string;
    displayName: string;
  }): Promise<MattermostTeamSummary> {
    const team = await this.request<MattermostTeamResponse>("/teams", {
      method: "POST",
      body: {
        name: input.name,
        display_name: input.displayName,
        type: "O",
      },
    });

    return {
      id: team.id,
      name: team.name,
      displayName: team.display_name,
    };
  }

  async createChannel(input: {
    teamId: string;
    name: string;
    displayName: string;
    purpose?: string;
  }): Promise<{ id: string; name: string }> {
    const channel = await this.request<MattermostChannelResponse>("/channels", {
      method: "POST",
      body: {
        team_id: input.teamId,
        name: input.name,
        display_name: input.displayName,
        purpose: input.purpose,
        type: "O",
      },
    });

    return {
      id: channel.id,
      name: channel.name,
    };
  }

  async listTeams(): Promise<MattermostTeamSummary[]> {
    const teams = await this.request<MattermostTeamResponse[]>(
      "/teams?page=0&per_page=200",
      {
        method: "GET",
      },
    );

    return teams.map((team) => ({
      id: team.id,
      name: team.name,
      displayName: team.display_name,
    }));
  }

  async createPost(input: {
    channelId: string;
    message: string;
    rootId?: string | null;
    props?: JsonObject;
  }): Promise<MattermostPostRef> {
    const post = await this.request<MattermostPostResponse>("/posts", {
      method: "POST",
      body: {
        channel_id: input.channelId,
        message: input.message,
        root_id: input.rootId ?? undefined,
        props: input.props,
      },
    });

    return this.toPostRef(post);
  }

  async listChannelPostsSince(
    channelId: string,
    sinceMs: number,
  ): Promise<MattermostPostEvent[]> {
    const query = new URLSearchParams({
      per_page: "200",
      since: String(Math.max(0, sinceMs)),
    });
    const payload = await this.request<MattermostChannelPostsResponse>(
      `/channels/${encodeURIComponent(channelId)}/posts?${query.toString()}`,
      {
        method: "GET",
      },
    );

    return normalizeMattermostApiPosts(payload, {
      botUserId: this.options.botUserId,
    });
  }

  async createEphemeralPost(input: {
    userId: string;
    channelId: string;
    message: string;
    rootId?: string | null;
    props?: JsonObject;
  }): Promise<void> {
    await this.request("/posts/ephemeral", {
      method: "POST",
      body: {
        user_id: input.userId,
        post: {
          channel_id: input.channelId,
          message: input.message,
          root_id: input.rootId ?? undefined,
          props: input.props,
        },
      },
    });
  }

  async createTypingSession(input: {
    channelId: string;
    parentId?: string | null;
  }): Promise<{ stop(): void }> {
    const botUserId = this.options.botUserId;
    if (!botUserId) {
      throw new Error(
        "Mattermost typing sessions require botUserId in MattermostClientOptions",
      );
    }

    let stopped = false;
    const publishTyping = async (failSilently: boolean): Promise<void> => {
      try {
        await this.request(`/users/${botUserId}/typing`, {
          method: "POST",
          body: {
            channel_id: input.channelId,
            parent_id: input.parentId ?? undefined,
          },
        });
      } catch (error) {
        if (!failSilently) {
          throw error;
        }

        this.logger?.warn?.(
          error instanceof Error
            ? `Mattermost typing publish failed: ${error.message}`
            : "Mattermost typing publish failed",
        );
      }
    };

    await publishTyping(false);

    const timer = setInterval(() => {
      if (stopped) {
        return;
      }
      void publishTyping(true);
    }, this.typingIntervalMs) as ReturnType<typeof setInterval> & {
      unref?: () => void;
    };
    timer.unref?.();

    return {
      stop() {
        if (stopped) {
          return;
        }

        stopped = true;
        clearInterval(timer);
      },
    };
  }

  private toPostRef(post: MattermostPostResponse): MattermostPostRef {
    return {
      channelId: post.channel_id,
      postId: post.id,
      rootId: post.root_id ?? null,
    };
  }

  private async request<T = void>(
    path: string,
    init: {
      method: string;
      body?: unknown;
    },
  ): Promise<T> {
    const response = await this.fetchImpl(`${this.apiBaseUrl}${path}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${this.options.botToken}`,
        "Content-Type": "application/json",
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });

    const responseText = await response.text();

    if (!response.ok) {
      let parsedError: MattermostErrorResponse | null = null;
      try {
        parsedError = responseText
          ? (JSON.parse(responseText) as MattermostErrorResponse)
          : null;
      } catch {
        parsedError = null;
      }

      const detail = parsedError?.detailed_error
        ? ` (${parsedError.detailed_error})`
        : "";
      throw new MattermostClientError(
        parsedError?.message ??
          `${init.method} ${path} failed with status ${response.status}${detail}`,
        response.status,
        parsedError,
        responseText,
      );
    }

    if (!responseText) {
      return undefined as T;
    }

    return JSON.parse(responseText) as T;
  }
}

export function createMattermostBridgeClient(
  options: MattermostClientOptions,
): MattermostBridgeClient {
  return new MattermostClient(options);
}

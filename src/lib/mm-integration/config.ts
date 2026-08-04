// @platform "node"
import { loadChatIntegrationDbPath } from "../chat-integration/config";
import type { MattermostIntegrationConfig } from "./types";

type EnvSource = Record<string, string | undefined>;

const DEFAULT_SLASH_COMMAND_PATH = "/api/mattermost/slash-command";
const DEFAULT_VK_WEBHOOK_PATH = "/api/mattermost/vk-webhook";
const DEFAULT_WORKSPACE_SUMMARY_POLL_MS = 15_000;
const DEFAULT_CHANNEL_PREFIX = "vk";
const DEFAULT_POST_RECONCILIATION_POLL_MS = 60_000;
const DEFAULT_POST_RECONNECT_BACKFILL_DELAY_MS = 2_000;
const DEFAULT_MM_WS_RECONNECT_MIN_MS = 1_000;
const DEFAULT_MM_WS_RECONNECT_MAX_MS = 30_000;
export interface MattermostBridgeRuntimeConfig {
  config: MattermostIntegrationConfig;
  dbPath: string;
}

export function loadMattermostBridgeRuntimeConfig(
  env: EnvSource = getProcessEnv(),
): MattermostBridgeRuntimeConfig {
  return {
    config: loadMattermostIntegrationConfig(env),
    dbPath: loadMattermostBridgeDbPath(env),
  };
}

export function loadMattermostBridgeDbPath(
  env: EnvSource = getProcessEnv(),
): string {
  return loadChatIntegrationDbPath(env);
}

export function loadMattermostIntegrationConfig(
  env: EnvSource = getProcessEnv(),
): MattermostIntegrationConfig {
  const enabled = readBoolean(env, "MATTERMOST_BRIDGE_ENABLED", false);
  const publicBaseUrl = readUrl(
    env,
    "MATTERMOST_BRIDGE_PUBLIC_BASE_URL",
    enabled,
  );
  const slashCommandPath = readPath(
    env,
    "MATTERMOST_BRIDGE_SLASH_COMMAND_PATH",
    DEFAULT_SLASH_COMMAND_PATH,
  );
  const workspaceSummaryPollMs = readInteger(
    env,
    "MATTERMOST_BRIDGE_WORKSPACE_SUMMARY_POLL_MS",
    DEFAULT_WORKSPACE_SUMMARY_POLL_MS,
  );
  const vkWebhookPath = readPath(
    env,
    "MATTERMOST_BRIDGE_VK_WEBHOOK_PATH",
    DEFAULT_VK_WEBHOOK_PATH,
  );
  const postReconciliationPollMs = readIntegerWithAliases(
    env,
    [
      "MATTERMOST_BRIDGE_POST_RECONCILIATION_POLL_MS",
      "MATTERMOST_BRIDGE_POST_POLL_MS",
    ],
    DEFAULT_POST_RECONCILIATION_POLL_MS,
  );
  const postReconnectBackfillDelayMs = readInteger(
    env,
    "MATTERMOST_BRIDGE_POST_RECONNECT_BACKFILL_DELAY_MS",
    DEFAULT_POST_RECONNECT_BACKFILL_DELAY_MS,
    { min: 0 },
  );
  const websocketEnabled = readBoolean(
    env,
    "MATTERMOST_BRIDGE_MM_WEBSOCKET_ENABLED",
    true,
  );
  const websocketReconnectMinMs = readInteger(
    env,
    "MATTERMOST_BRIDGE_MM_WS_RECONNECT_MIN_MS",
    DEFAULT_MM_WS_RECONNECT_MIN_MS,
  );
  const websocketReconnectMaxMs = readInteger(
    env,
    "MATTERMOST_BRIDGE_MM_WS_RECONNECT_MAX_MS",
    DEFAULT_MM_WS_RECONNECT_MAX_MS,
  );

  const vkBaseUrl =
    readUrl(env, "MATTERMOST_BRIDGE_VK_BASE_URL", false) ?? publicBaseUrl;

  const config: MattermostIntegrationConfig = {
    enabled,
    publicBaseUrl: publicBaseUrl ?? "",
    slashCommandPath,
    workspaceSummaryPollMs,
    vk: {
      baseUrl: vkBaseUrl ?? "",
      apiKey: readOptionalString(env, "MATTERMOST_BRIDGE_VK_API_KEY"),
      defaultProjectId:
        readOptionalString(env, "MATTERMOST_BRIDGE_VK_DEFAULT_PROJECT_ID") ??
        "",
      defaultIssueStatusId:
        readOptionalString(
          env,
          "MATTERMOST_BRIDGE_VK_DEFAULT_ISSUE_STATUS_ID",
        ) ?? "",
      defaultRepoId:
        readOptionalString(env, "MATTERMOST_BRIDGE_VK_DEFAULT_REPO_ID") ?? "",
      defaultRepoBranch:
        readOptionalString(env, "MATTERMOST_BRIDGE_VK_DEFAULT_REPO_BRANCH") ??
        "",
      defaultExecutor:
        readOptionalString(env, "MATTERMOST_BRIDGE_VK_DEFAULT_EXECUTOR") ?? "",
      defaultExecutorVariant: readOptionalString(
        env,
        "MATTERMOST_BRIDGE_VK_DEFAULT_EXECUTOR_VARIANT",
      ),
      webhookSecret: readOptionalString(
        env,
        "MATTERMOST_BRIDGE_VK_WEBHOOK_SECRET",
      ),
      webhookPath: vkWebhookPath,
    },
    mattermost: {
      baseUrl: readUrl(env, "MATTERMOST_BRIDGE_MM_BASE_URL", false) ?? "",
      userBaseUrl:
        readUrl(env, "MATTERMOST_BRIDGE_MM_USER_BASE_URL", false) ??
        readUrl(env, "MATTERMOST_BRIDGE_MM_BASE_URL", false) ??
        "",
      botToken: readOptionalString(env, "MATTERMOST_BRIDGE_MM_BOT_TOKEN") ?? "",
      teamId: readOptionalString(env, "MATTERMOST_BRIDGE_MM_TEAM_ID") ?? null,
      channelPrefix:
        readOptionalString(env, "MATTERMOST_BRIDGE_MM_CHANNEL_PREFIX") ??
        DEFAULT_CHANNEL_PREFIX,
      botUserId: readOptionalString(env, "MATTERMOST_BRIDGE_MM_BOT_USER_ID"),
      slashCommandToken: readOptionalString(
        env,
        "MATTERMOST_BRIDGE_MM_SLASH_COMMAND_TOKEN",
      ),
      websocketEnabled,
      postReconciliationPollMs,
      postReconnectBackfillDelayMs,
      websocketReconnectMinMs,
      websocketReconnectMaxMs: Math.max(
        websocketReconnectMinMs,
        websocketReconnectMaxMs,
      ),
    },
  };

  if (!enabled) {
    return config;
  }

  requirePresent(config.publicBaseUrl, "MATTERMOST_BRIDGE_PUBLIC_BASE_URL");
  requirePresent(
    config.vk.baseUrl,
    "MATTERMOST_BRIDGE_VK_BASE_URL or MATTERMOST_BRIDGE_PUBLIC_BASE_URL",
  );
  requirePresent(
    config.vk.defaultProjectId,
    "MATTERMOST_BRIDGE_VK_DEFAULT_PROJECT_ID",
  );
  requirePresent(
    config.vk.defaultIssueStatusId,
    "MATTERMOST_BRIDGE_VK_DEFAULT_ISSUE_STATUS_ID",
  );
  requirePresent(
    config.vk.defaultRepoId,
    "MATTERMOST_BRIDGE_VK_DEFAULT_REPO_ID",
  );
  requirePresent(
    config.vk.defaultRepoBranch,
    "MATTERMOST_BRIDGE_VK_DEFAULT_REPO_BRANCH",
  );
  requirePresent(
    config.vk.defaultExecutor,
    "MATTERMOST_BRIDGE_VK_DEFAULT_EXECUTOR",
  );
  requirePresent(
    config.vk.webhookSecret,
    "MATTERMOST_BRIDGE_VK_WEBHOOK_SECRET",
  );
  requirePresent(config.mattermost.baseUrl, "MATTERMOST_BRIDGE_MM_BASE_URL");
  requirePresent(config.mattermost.botToken, "MATTERMOST_BRIDGE_MM_BOT_TOKEN");

  return config;
}

function readOptionalString(env: EnvSource, key: string): string | undefined {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

function readBoolean(env: EnvSource, key: string, fallback: boolean): boolean {
  const value = readOptionalString(env, key);
  if (!value) {
    return fallback;
  }

  switch (value.toLowerCase()) {
    case "1":
    case "true":
    case "yes":
    case "on":
      return true;
    case "0":
    case "false":
    case "no":
    case "off":
      return false;
    default:
      throw new Error(
        `${key} must be a boolean string like true/false/1/0. Received: ${value}`,
      );
  }
}

function readInteger(
  env: EnvSource,
  key: string,
  fallback: number,
  options: {
    min?: number;
  } = {},
): number {
  const min = options.min ?? 1;
  const value = readOptionalString(env, key);
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < min) {
    const expectation =
      min <= 0
        ? `an integer greater than or equal to ${min}`
        : "a positive integer";
    throw new Error(`${key} must be ${expectation}. Received: ${value}`);
  }

  return parsed;
}

function readIntegerWithAliases(
  env: EnvSource,
  keys: string[],
  fallback: number,
): number {
  for (const key of keys) {
    const value = readOptionalString(env, key);
    if (!value) {
      continue;
    }

    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error(`${key} must be a positive integer. Received: ${value}`);
    }

    return parsed;
  }

  return fallback;
}

function readPath(env: EnvSource, key: string, fallback: string): string {
  const value = readOptionalString(env, key);
  if (!value) {
    return fallback;
  }

  return value.startsWith("/") ? value : `/${value}`;
}

function readUrl(
  env: EnvSource,
  key: string,
  required: boolean,
): string | undefined {
  const value = readOptionalString(env, key);
  if (!value) {
    if (required) {
      throw new Error(`${key} is required when Mattermost bridge is enabled.`);
    }
    return undefined;
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${key} must be a valid absolute URL. Received: ${value}`);
  }

  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  return parsed.toString().replace(/\/$/, "");
}

function requirePresent(value: string | null | undefined, key: string): void {
  if (!value) {
    throw new Error(`${key} is required when Mattermost bridge is enabled.`);
  }
}

function getProcessEnv(): EnvSource {
  return getProcess()?.env ?? {};
}

function getProcess():
  | {
      env?: EnvSource;
    }
  | undefined {
  return (
    globalThis as typeof globalThis & {
      process?: {
        env?: EnvSource;
      };
    }
  ).process;
}
// @platform end

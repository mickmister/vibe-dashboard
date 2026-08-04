// @platform "node"
import * as path from 'node:path';

type EnvSource = Record<string, string | undefined>;

const DEFAULT_DB_PATH = path.resolve(
  getProcessCwd(),
  '.data',
  'mattermost-bridge.sqlite'
);

export function loadChatIntegrationDbPath(
  env: EnvSource = getProcessEnv()
): string {
  const configured =
    readOptionalString(env, 'CHAT_INTEGRATION_DB_PATH') ??
    readOptionalString(env, 'MATTERMOST_BRIDGE_DB_PATH');
  if (!configured) {
    return DEFAULT_DB_PATH;
  }

  return path.resolve(getProcessCwd(), configured);
}

function readOptionalString(
  env: EnvSource,
  key: string
): string | undefined {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

function getProcessEnv(): EnvSource {
  return getProcess()?.env ?? {};
}

function getProcessCwd(): string {
  return getProcess()?.cwd?.() ?? '.';
}

function getProcess():
  | {
      cwd?: () => string;
      env?: EnvSource;
    }
  | undefined {
  return (
    globalThis as typeof globalThis & {
      process?: {
        cwd?: () => string;
        env?: EnvSource;
      };
    }
  ).process;
}
// @platform end

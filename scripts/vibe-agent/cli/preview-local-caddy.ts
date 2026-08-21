import { spawn } from 'child_process';
import { createWriteStream, existsSync } from 'fs';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, resolve } from 'path';
import type { PreviewSlotUrlResponse } from './vk-service.js';

export const LOCAL_PREVIEW_BASE_DOMAIN = 'localhost';
const STATE_FILE = resolve(tmpdir(), 'vk-preview-local-caddy.json');

export interface LocalCaddyStartInput {
  backendPort?: string;
  caddyPort?: string;
  dashboardPort?: string;
  caddyBin?: string;
  caddyfile?: string;
}

export interface LocalCaddyStartOptions {
  backendPort: number;
  caddyPort: number;
  dashboardPort: number;
  baseDomain: 'localhost';
  caddyBin: string;
  caddyfile: string;
}

export interface LocalCaddyState extends LocalCaddyStartOptions {
  pid: number;
  startedAt: string;
  runDir: string;
  pluginsCaddyPath: string;
  accessLogPath: string;
  stdoutPath: string;
  stderrPath: string;
  url: string;
}

export function normalizeLocalCaddyStartOptions(
  input: LocalCaddyStartInput,
): LocalCaddyStartOptions {
  return {
    backendPort: parsePort(input.backendPort, 'backend-port', 3007),
    caddyPort: parsePort(input.caddyPort, 'caddy-port', 3001),
    dashboardPort: parsePort(input.dashboardPort, 'dashboard-port', 3005),
    baseDomain: LOCAL_PREVIEW_BASE_DOMAIN,
    caddyBin: input.caddyBin || process.env.CADDY_BIN || 'caddy',
    caddyfile: resolve(input.caddyfile || process.env.CADDYFILE || 'Caddyfile'),
  };
}

export function buildLocalCaddyEnv(input: {
  backendPort: number;
  caddyPort: number;
  dashboardPort: number;
  pluginsCaddyPath: string;
  accessLogPath: string;
}): Record<string, string> {
  return {
    CADDY_ADMIN: 'off',
    CADDY_PORT: String(input.caddyPort),
    BACKEND_PORT: String(input.backendPort),
    DASHBOARD_PORT: String(input.dashboardPort),
    PREVIEW_BASE_DOMAIN: LOCAL_PREVIEW_BASE_DOMAIN,
    PREVIEW_RESOLVER_URL: `http://127.0.0.1:${input.dashboardPort}/internal/preview/resolve`,
    CADDY_PLUGINS_CADDY: input.pluginsCaddyPath,
    CADDY_ACCESS_LOG: input.accessLogPath,
  };
}

export function buildLocalPreviewUrl(
  response: Pick<PreviewSlotUrlResponse, 'host'>,
  caddyPort: number,
): string {
  return `http://${response.host}:${caddyPort}/`;
}

export function buildLocalCaddyDashboardUrl(caddyPort: number): string {
  return `http://localhost:${caddyPort}/?previewLocalCaddy=1`;
}

export async function startLocalPreviewCaddy(
  options: LocalCaddyStartOptions,
): Promise<LocalCaddyState> {
  if (!existsSync(options.caddyfile)) {
    throw new Error(`Caddyfile not found: ${options.caddyfile}`);
  }

  const existing = await readLocalCaddyState().catch(() => null);
  if (existing && isProcessRunning(existing.pid)) {
    return existing;
  }

  const runDir = resolve(tmpdir(), `vk-preview-local-caddy-${options.caddyPort}`);
  const pluginsCaddyPath = resolve(runDir, 'plugins.caddy');
  const accessLogPath = resolve(runDir, 'access.log');
  const stdoutPath = resolve(runDir, 'stdout.log');
  const stderrPath = resolve(runDir, 'stderr.log');
  await mkdir(runDir, { recursive: true });
  await writeFile(pluginsCaddyPath, '# local PreviewServer Caddy plugin routes\n');

  const stdout = createWriteStream(stdoutPath, { flags: 'a' });
  const stderr = createWriteStream(stderrPath, { flags: 'a' });
  const child = spawn(
    options.caddyBin,
    ['run', '--config', options.caddyfile, '--adapter', 'caddyfile'],
    {
      detached: true,
      env: {
        ...process.env,
        ...buildLocalCaddyEnv({
          backendPort: options.backendPort,
          caddyPort: options.caddyPort,
          dashboardPort: options.dashboardPort,
          pluginsCaddyPath,
          accessLogPath,
        }),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  child.stdout?.pipe(stdout);
  child.stderr?.pipe(stderr);
  child.unref();

  if (!child.pid) {
    throw new Error('Failed to start local PreviewServer Caddy process');
  }

  const state: LocalCaddyState = {
    ...options,
    pid: child.pid,
    startedAt: new Date().toISOString(),
    runDir,
    pluginsCaddyPath,
    accessLogPath,
    stdoutPath,
    stderrPath,
    url: buildLocalCaddyDashboardUrl(options.caddyPort),
  };
  await writeLocalCaddyState(state);
  return state;
}

export async function stopLocalPreviewCaddy(): Promise<LocalCaddyState | null> {
  const state = await readLocalCaddyState().catch(() => null);
  if (!state) return null;

  if (isProcessRunning(state.pid)) {
    try {
      process.kill(-state.pid, 'SIGTERM');
    } catch {
      try {
        process.kill(state.pid, 'SIGTERM');
      } catch {
        // Process may have already exited.
      }
    }
  }
  await rm(STATE_FILE, { force: true });
  return state;
}

export async function readLocalCaddyState(): Promise<LocalCaddyState | null> {
  try {
    const parsed = JSON.parse(await readFile(STATE_FILE, 'utf8')) as LocalCaddyState;
    return parsed;
  } catch {
    return null;
  }
}

async function writeLocalCaddyState(state: LocalCaddyState): Promise<void> {
  await mkdir(dirname(STATE_FILE), { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2));
}

function parsePort(
  value: string | undefined,
  label: string,
  fallback: number,
): number {
  const parsed = value == null ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return parsed;
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

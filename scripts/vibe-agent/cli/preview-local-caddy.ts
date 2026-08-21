import { spawn } from 'child_process';
import { closeSync, openSync } from 'fs';
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
  readinessTimeoutMs?: string;
}

export interface LocalCaddyStartOptions {
  backendPort: number;
  caddyPort: number;
  dashboardPort: number;
  baseDomain: 'localhost';
  caddyBin: string;
  readinessTimeoutMs: number;
}

export interface LocalCaddyState extends LocalCaddyStartOptions {
  pid: number;
  startedAt: string;
  runDir: string;
  caddyfilePath: string;
  pluginsCaddyPath: string;
  accessLogPath: string;
  stdoutPath: string;
  stderrPath: string;
  url: string;
}

export interface LocalCaddyStatus {
  state: LocalCaddyState | null;
  running: boolean;
  stale: boolean;
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
    readinessTimeoutMs: parsePositiveInteger(
      input.readinessTimeoutMs,
      'readiness-timeout-ms',
      5000,
    ),
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

export function renderLocalPreviewCaddyfile(): string {
  return `{
\tadmin off
\tauto_https off
}

http://:{\$CADDY_PORT:3001} {
\tbind 127.0.0.1

\tlog {
\t\toutput file {\$CADDY_ACCESS_LOG:/tmp/vk-preview-local-caddy-access.log}
\t}

\tvk_preview_resolver {
\t\tresolver_url {\$PREVIEW_RESOLVER_URL}
\t\tbase_domain {\$PREVIEW_BASE_DOMAIN:localhost}
\t\ttimeout 2s
\t}

\thandle /kv/* {
\t\treverse_proxy 127.0.0.1:{\$DASHBOARD_PORT:3005}
\t}

\thandle /rpc/* {
\t\treverse_proxy 127.0.0.1:{\$DASHBOARD_PORT:3005}
\t}

\t@websocket {
\t\theader Connection *Upgrade*
\t\theader Upgrade websocket
\t}
\thandle @websocket {
\t\treverse_proxy 127.0.0.1:{\$DASHBOARD_PORT:3005}
\t}

\t# PreviewServer VD routes are served by the dashboard Springboard server.
\thandle /internal/preview/* {
\t\treverse_proxy 127.0.0.1:{\$DASHBOARD_PORT:3005}
\t}

\t@vk_workspace_assets {
\t\tpath /assets/*
\t\theader_regexp workspace_referer Referer /workspaces/
\t}
\thandle @vk_workspace_assets {
\t\treverse_proxy 127.0.0.1:{\$BACKEND_PORT:3007}
\t}

\t@vibe_dashboard_assets {
\t\tpath /.springboard/*
\t\tpath /node_modules/*
\t\tpath /packages/*
\t\tpath /src/*
\t\tpath /@vite/*
\t\tpath /@id/*
\t\tpath /@react-refresh
\t\tpath /@fs/*
\t\tpath /assets/*
\t\tpath /dashboard/*
\t\tpath /favicon.ico
\t}
\thandle @vibe_dashboard_assets {
\t\t@asset_path path /assets/*
\t\thandle @asset_path {
\t\t\treverse_proxy 127.0.0.1:{\$DASHBOARD_PORT:3005} {
\t\t\t\t@wrapper_asset_error status 404 502
\t\t\t\thandle_response @wrapper_asset_error {
\t\t\t\t\treverse_proxy 127.0.0.1:{\$BACKEND_PORT:3007}
\t\t\t\t}
\t\t\t}
\t\t}

\t\thandle {
\t\t\treverse_proxy 127.0.0.1:{\$DASHBOARD_PORT:3005}
\t\t}
\t}

\thandle_path /vk-api/* {
\t\trewrite * /api{uri}
\t\treverse_proxy 127.0.0.1:{\$BACKEND_PORT:3007}
\t}

\t@vk_backend path /api/* /workspaces*
\thandle @vk_backend {
\t\treverse_proxy 127.0.0.1:{\$BACKEND_PORT:3007}
\t}

\thandle {
\t\treverse_proxy 127.0.0.1:{\$DASHBOARD_PORT:3005}
\t}
}
`;
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
  const existing = await readLocalCaddyState().catch(() => null);
  if (existing && isProcessRunning(existing.pid)) {
    const mismatches = getLocalCaddyOptionMismatches(existing, options);
    if (mismatches.length) {
      throw new Error(
        `Local PreviewServer Caddy is already running with different options: ${mismatches.join(', ')}. Stop it first with "vk preview-url local-caddy stop".`,
      );
    }
    return existing;
  }
  if (existing && !isProcessRunning(existing.pid)) {
    await rm(STATE_FILE, { force: true });
  }

  const runDir = resolve(tmpdir(), `vk-preview-local-caddy-${options.caddyPort}`);
  const caddyfilePath = resolve(runDir, 'Caddyfile.local');
  const pluginsCaddyPath = resolve(runDir, 'plugins.caddy');
  const accessLogPath = resolve(runDir, 'access.log');
  const stdoutPath = resolve(runDir, 'stdout.log');
  const stderrPath = resolve(runDir, 'stderr.log');
  await mkdir(runDir, { recursive: true });
  await writeFile(caddyfilePath, renderLocalPreviewCaddyfile());
  await writeFile(pluginsCaddyPath, '# local PreviewServer Caddy plugin routes\n');

  const stdout = openSync(stdoutPath, 'a');
  const stderr = openSync(stderrPath, 'a');
  const child = spawn(
    options.caddyBin,
    ['run', '--config', caddyfilePath, '--adapter', 'caddyfile'],
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
      stdio: ['ignore', stdout, stderr],
    },
  );
  child.unref();
  closeSync(stdout);
  closeSync(stderr);

  if (!child.pid) {
    throw new Error('Failed to start local PreviewServer Caddy process');
  }

  const state: LocalCaddyState = {
    ...options,
    pid: child.pid,
    startedAt: new Date().toISOString(),
    runDir,
    caddyfilePath,
    pluginsCaddyPath,
    accessLogPath,
    stdoutPath,
    stderrPath,
    url: buildLocalCaddyDashboardUrl(options.caddyPort),
  };
  try {
    await waitForLocalCaddyReadiness(child, state.url, options.readinessTimeoutMs);
  } catch (error) {
    stopSpawnedLocalCaddy(child.pid);
    throw error;
  }
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

export async function readLocalCaddyStatus(): Promise<LocalCaddyStatus> {
  const state = await readLocalCaddyState();
  if (!state) return { state: null, running: false, stale: false };
  const running = isProcessRunning(state.pid);
  if (!running) {
    await rm(STATE_FILE, { force: true });
  }
  return { state, running, stale: !running };
}

export function getLocalCaddyOptionMismatches(
  state: Pick<
    LocalCaddyState,
    'backendPort' | 'caddyPort' | 'dashboardPort' | 'baseDomain' | 'caddyBin'
  >,
  options: Pick<
    LocalCaddyStartOptions,
    'backendPort' | 'caddyPort' | 'dashboardPort' | 'baseDomain' | 'caddyBin'
  >,
): string[] {
  const keys = [
    'backendPort',
    'caddyPort',
    'dashboardPort',
    'baseDomain',
    'caddyBin',
  ] as const;
  return keys.flatMap((key) =>
    state[key] === options[key]
      ? []
      : [`${key}=${String(state[key])} (requested ${String(options[key])})`],
  );
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

function parsePositiveInteger(
  value: string | undefined,
  label: string,
  fallback: number,
): number {
  const parsed = value == null ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return parsed;
}

async function waitForLocalCaddyReadiness(
  child: ReturnType<typeof spawn>,
  readinessUrl: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let exitMessage: string | null = null;
  let spawnErrorMessage: string | null = null;
  child.once('exit', (code, signal) => {
    exitMessage = `code ${code ?? 'null'}, signal ${signal ?? 'null'}`;
  });
  child.once('error', (error) => {
    spawnErrorMessage = error.message;
  });

  while (Date.now() < deadline) {
    if (spawnErrorMessage) {
      throw new Error(`Failed to start local PreviewServer Caddy: ${spawnErrorMessage}`);
    }
    if (exitMessage) {
      throw new Error(
        `Local PreviewServer Caddy exited before readiness (${exitMessage})`,
      );
    }
    if (await isHttpEndpointReady(readinessUrl)) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }

  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for local PreviewServer Caddy readiness at ${readinessUrl}`,
  );
}

async function isHttpEndpointReady(url: string): Promise<boolean> {
  try {
    await fetch(url);
    return true;
  } catch {
    return false;
  }
}

function stopSpawnedLocalCaddy(pid: number | undefined): void {
  if (!pid) return;
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // Process may have already exited.
    }
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Hono } from 'hono';
import { applySetInstancePluginEnabled } from '../../plugins/orchestrator/plugin-instance-config';
import { composeCatalogs } from '../../plugins/orchestrator/plugin-service-orchestrator-cli';
import {
  assertPluginServiceCatalog,
  isPluginEnabled,
  pluginInstallPath,
  supervisorProgramName,
  type PluginServiceCatalog,
  type PluginServiceDefinition,
  type PluginServiceOrchestratorPaths,
} from '../../plugins/orchestrator/plugin-service-orchestrator';

const execFileAsync = promisify(execFile);
const DEFAULT_INSTANCE_CONFIG_DIR = '/var/lib/vd/instance-config';
const DEFAULT_OPTIONAL_INSTANCE_CATALOG = join(DEFAULT_INSTANCE_CONFIG_DIR, 'plugins.json');
const DEFAULT_RUNTIME_APPLY_SCRIPT = '/usr/local/bin/vd-plugin-runtime-apply.sh';

export type ObservedPluginRuntimeState = 'not_running' | 'running' | 'failed_to_start' | 'failed' | 'disabled';

export interface PluginAdminStatus {
  pluginId: string;
  name: string;
  version: string;
  pluginPath?: string;
  installPath?: string;
  desiredEnabled: boolean;
  observedState: ObservedPluginRuntimeState;
  error?: string;
}

export interface SupervisorProgramStatus {
  state: string;
  detail?: string;
}

export interface RegisterPluginAdminRoutesOptions {
  catalogPaths?: string[];
  optionalCatalogPaths?: string[];
  instanceConfigDir?: string;
  runtimeApplyScript?: string;
  paths?: PluginServiceOrchestratorPaths;
  loadCatalog?: () => Promise<PluginServiceCatalog>;
  readSupervisorStatuses?: () => Promise<Map<string, SupervisorProgramStatus>>;
  setPluginEnabled?: (pluginId: string, enable: boolean) => Promise<void>;
  applyRuntimeSync?: () => Promise<void>;
}

export function registerPluginAdminRoutes(app: Hono, options: RegisterPluginAdminRoutesOptions = {}): void {
  app.get('/dashboard/api/admin/plugins/status', async (c) => {
    const plugins = await loadPluginAdminStatuses(options);
    return c.json({ plugins });
  });

  app.post('/dashboard/api/admin/plugins/:pluginId/enable', async (c) => {
    const pluginId = c.req.param('pluginId');
    const body = await c.req.json().catch(() => undefined) as { enable?: unknown } | undefined;
    if (typeof body?.enable !== 'boolean') {
      return c.json({ error: 'enable_boolean_required' }, 400);
    }

    const catalog = await (options.loadCatalog ?? defaultLoadCatalog(options))();
    if (!catalog.plugins.some((entry) => entry.id === pluginId)) {
      return c.json({ error: 'plugin_not_found' }, 404);
    }

    await (options.setPluginEnabled ?? defaultSetPluginEnabled(options))(pluginId, body.enable);
    await (options.applyRuntimeSync ?? defaultApplyRuntimeSync(options))();

    const plugins = await loadPluginAdminStatuses(options);
    const plugin = plugins.find((entry) => entry.pluginId === pluginId);
    if (!plugin) return c.json({ error: 'plugin_not_found' }, 404);
    return c.json({ plugin, plugins });
  });
}

export async function loadPluginAdminStatuses(options: RegisterPluginAdminRoutesOptions = {}): Promise<PluginAdminStatus[]> {
  const [catalog, supervisorStatuses] = await Promise.all([
    (options.loadCatalog ?? defaultLoadCatalog(options))(),
    (options.readSupervisorStatuses ?? defaultReadSupervisorStatuses)(),
  ]);
  return buildPluginAdminStatuses({ catalog, paths: resolvePluginAdminPaths(options), supervisorStatuses });
}

export function buildPluginAdminStatuses(input: {
  catalog: PluginServiceCatalog;
  paths: PluginServiceOrchestratorPaths;
  supervisorStatuses: Map<string, SupervisorProgramStatus>;
}): PluginAdminStatus[] {
  assertPluginServiceCatalog(input.catalog);
  return input.catalog.plugins.map((plugin) => {
    const desiredEnabled = isPluginEnabled(input.catalog, plugin.id);
    const installPath = pluginInstallPath(input.paths, plugin);
    const observed = observePluginRuntimeState(plugin, desiredEnabled, input.supervisorStatuses);
    return {
      pluginId: plugin.id,
      name: plugin.name,
      version: plugin.version,
      pluginPath: installPath,
      installPath,
      desiredEnabled,
      observedState: observed.state,
      ...(observed.error ? { error: observed.error } : {}),
    };
  });
}

function observePluginRuntimeState(
  plugin: PluginServiceDefinition,
  desiredEnabled: boolean,
  supervisorStatuses: Map<string, SupervisorProgramStatus>,
): { state: ObservedPluginRuntimeState; error?: string } {
  if (!desiredEnabled) return { state: 'disabled' };
  if (plugin.services.length === 0) return { state: 'not_running' };

  const serviceStatuses = plugin.services.map((service) => ({
    serviceId: service.id,
    status: supervisorStatuses.get(supervisorProgramName(plugin, service)),
  }));
  const missing = serviceStatuses.find((entry) => !entry.status);
  if (missing) return { state: 'not_running', error: `${missing.serviceId}: supervisor program is not present` };

  const failedToStart = serviceStatuses.find((entry) => isFailedToStartSupervisorState(entry.status!.state));
  if (failedToStart) return { state: 'failed_to_start', error: renderSupervisorStatusError(failedToStart.serviceId, failedToStart.status!) };

  const failed = serviceStatuses.find((entry) => isFailedSupervisorState(entry.status!.state));
  if (failed) return { state: 'failed', error: renderSupervisorStatusError(failed.serviceId, failed.status!) };

  const notRunning = serviceStatuses.find((entry) => entry.status!.state !== 'RUNNING');
  if (notRunning) return { state: 'not_running', error: renderSupervisorStatusError(notRunning.serviceId, notRunning.status!) };

  return { state: 'running' };
}

function isFailedToStartSupervisorState(state: string): boolean {
  return state === 'FATAL' || state === 'BACKOFF';
}

function isFailedSupervisorState(state: string): boolean {
  return state === 'EXITED' || state === 'UNKNOWN';
}

function renderSupervisorStatusError(serviceId: string, status: SupervisorProgramStatus): string {
  return `${serviceId}: ${status.state}${status.detail ? ` ${status.detail}` : ''}`;
}

function defaultLoadCatalog(options: RegisterPluginAdminRoutesOptions): () => Promise<PluginServiceCatalog> {
  return async () => {
    const catalogPaths = options.catalogPaths ?? [process.env.VD_PLUGIN_BUILTIN_CATALOG ?? join(process.cwd(), 'plugins/builtin.plugins.json')];
    const optionalCatalogPaths = options.optionalCatalogPaths ?? [process.env.VD_PLUGIN_INSTANCE_CATALOG ?? DEFAULT_OPTIONAL_INSTANCE_CATALOG];
    const catalogs: PluginServiceCatalog[] = [];
    for (const catalogPath of catalogPaths) {
      catalogs.push(assertPluginServiceCatalog(JSON.parse(await readFile(catalogPath, 'utf8'))));
    }
    for (const catalogPath of optionalCatalogPaths) {
      try {
        catalogs.push(assertPluginServiceCatalog(JSON.parse(await readFile(catalogPath, 'utf8'))));
      } catch (error) {
        if (!isNodeErrorWithCode(error, 'ENOENT')) throw error;
      }
    }
    return composeCatalogs(catalogs);
  };
}

function defaultSetPluginEnabled(options: RegisterPluginAdminRoutesOptions): (pluginId: string, enable: boolean) => Promise<void> {
  return async (pluginId, enable) => {
    await applySetInstancePluginEnabled({
      configRepoDir: options.instanceConfigDir ?? process.env.VD_PLUGIN_INSTANCE_CONFIG_DIR ?? DEFAULT_INSTANCE_CONFIG_DIR,
      pluginId,
      enable,
    });
  };
}

function defaultApplyRuntimeSync(options: RegisterPluginAdminRoutesOptions): () => Promise<void> {
  return async () => {
    await execFileAsync(options.runtimeApplyScript ?? process.env.VD_PLUGIN_RUNTIME_APPLY_SCRIPT ?? DEFAULT_RUNTIME_APPLY_SCRIPT, []);
  };
}

async function defaultReadSupervisorStatuses(): Promise<Map<string, SupervisorProgramStatus>> {
  const { stdout } = await execFileAsync('supervisorctl', ['status']);
  return parseSupervisorStatusOutput(stdout);
}

export function parseSupervisorStatusOutput(output: string): Map<string, SupervisorProgramStatus> {
  const statuses = new Map<string, SupervisorProgramStatus>();
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^(\S+)\s+(\S+)\s*(.*)$/);
    if (!match) continue;
    statuses.set(match[1]!, { state: match[2]!, ...(match[3] ? { detail: match[3] } : {}) });
  }
  return statuses;
}

function resolvePluginAdminPaths(options: RegisterPluginAdminRoutesOptions): PluginServiceOrchestratorPaths {
  return options.paths ?? {
    artifactCacheRoot: process.env.VD_PLUGIN_ARTIFACT_CACHE_ROOT ?? '/var/lib/vd/plugin-cache',
    installRoot: process.env.VD_PLUGIN_INSTALL_ROOT ?? '/var/lib/vd/plugins',
    supervisorConfigDir: process.env.VD_PLUGIN_SUPERVISOR_CONFIG_DIR ?? '/etc/supervisor/conf.d/vd-generated',
    caddyPluginConfigPath: process.env.VD_PLUGIN_CADDY_CONFIG_PATH ?? '/etc/caddy/plugins.caddy',
    pluginBinDir: process.env.VD_PLUGIN_BIN_DIR ?? '/var/lib/vd/plugin-bin',
    toolchainRoot: process.env.VD_PLUGIN_TOOLCHAIN_ROOT ?? '/var/lib/vd/toolchains',
  };
}

function isNodeErrorWithCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === code;
}

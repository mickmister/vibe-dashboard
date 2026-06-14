import { join } from 'node:path';
import type { DiscoveredInstalledPlugin } from './installer';
import type { ContainerComponent, EffectivePluginGrants, FilesystemRequest, HealthCheck, NetworkRequest } from './manifest';
import { isGhcrDigestPinnedImage } from './manifest';

export type ContainerHealthStatus = 'pass' | 'fail';

export interface ContainerRuntimeCommand {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface ContainerRuntimeMount {
  source: string;
  target: string;
  readonly: boolean;
}

export interface ContainerRuntimeStatus {
  logs: string[];
  health: Record<string, ContainerHealthStatus>;
}

export interface ContainerPluginRuntimePlan {
  pluginId: string;
  pluginVersion: string;
  unitId: string;
  dockerHost: string;
  image: string;
  composeFile?: string;
  composeProjectName: string;
  mounts: ContainerRuntimeMount[];
  approvedNetwork: NetworkRequest;
  approvedSecrets: string[];
  healthChecks: HealthCheck[];
  lifecycle: {
    pull: ContainerRuntimeCommand;
    up: ContainerRuntimeCommand;
    down: ContainerRuntimeCommand;
    logs: ContainerRuntimeCommand;
  };
  status: ContainerRuntimeStatus;
}

export interface ContainerRuntimeAdminPreview {
  pluginId: string;
  pluginVersion: string;
  unitId: string;
  image: string;
  composeFile?: string;
  dockerHostKind: 'microvm';
  mounts: ContainerRuntimeMount[];
  network: NetworkRequest;
  secrets: string[];
  healthChecks: HealthCheck[];
  lifecycleCommands: Array<keyof ContainerPluginRuntimePlan['lifecycle']>;
}

export interface CreateContainerPluginRuntimePlanInput {
  dockerBinary: string;
  microvmDockerHost: string;
  workspaceRoot: string;
  pluginDataRoot: string;
  plugins: DiscoveredInstalledPlugin[];
  grantsByPluginVersion: Map<string, EffectivePluginGrants>;
}

export interface CreateContainerPluginRuntimePlanResult {
  plans: ContainerPluginRuntimePlan[];
  errors: string[];
}

export type ContainerRuntimeEvent =
  | { type: 'log'; message: string }
  | { type: 'health'; id: string; passed: boolean; message?: string };

export function createContainerPluginRuntimePlan(
  input: CreateContainerPluginRuntimePlanInput,
): CreateContainerPluginRuntimePlanResult {
  if (isHostDockerSocket(input.microvmDockerHost)) {
    return {
      plans: [],
      errors: ['container runtime: microVM docker host must not point at the host Docker socket'],
    };
  }

  const plans: ContainerPluginRuntimePlan[] = [];
  const errors: string[] = [];

  for (const plugin of input.plugins) {
    if (plugin.disabled) continue;
    const grants = input.grantsByPluginVersion.get(`${plugin.id}@${plugin.version}`);
    for (const container of plugin.manifest.components.containers ?? []) {
      const result = createContainerUnitPlan({ ...input, plugin, container, grants });
      if (result.plan) plans.push(result.plan);
      errors.push(...result.errors.map((error) => `${plugin.id}@${plugin.version} ${container.id}: ${error}`));
    }
  }

  return { plans, errors };
}

export function getContainerRuntimeAdminPreview(plan: ContainerPluginRuntimePlan): ContainerRuntimeAdminPreview {
  return {
    pluginId: plan.pluginId,
    pluginVersion: plan.pluginVersion,
    unitId: plan.unitId,
    image: plan.image,
    composeFile: plan.composeFile,
    dockerHostKind: 'microvm',
    mounts: plan.mounts,
    network: plan.approvedNetwork,
    secrets: plan.approvedSecrets,
    healthChecks: plan.healthChecks,
    lifecycleCommands: ['pull', 'up', 'down', 'logs'],
  };
}

export function recordContainerRuntimeEvent(
  status: ContainerRuntimeStatus,
  event: ContainerRuntimeEvent,
): ContainerRuntimeStatus {
  if (event.type === 'log') {
    status.logs.push(event.message);
    return status;
  }

  const healthStatus = event.passed ? 'pass' : 'fail';
  status.health[event.id] = healthStatus;
  status.logs.push(`health ${event.id} ${healthStatus}${event.message ? `: ${event.message}` : ''}`);
  return status;
}

function createContainerUnitPlan(input: {
  dockerBinary: string;
  microvmDockerHost: string;
  workspaceRoot: string;
  pluginDataRoot: string;
  plugin: DiscoveredInstalledPlugin;
  container: ContainerComponent;
  grants?: EffectivePluginGrants;
}): { plan?: ContainerPluginRuntimePlan; errors: string[] } {
  const errors: string[] = [];
  const { plugin, container, grants } = input;

  if (!grants) {
    errors.push('missing approved grants');
  } else {
    if (grants.pluginId !== plugin.id || grants.pluginVersion !== plugin.version) {
      errors.push('Effective grants plugin identity does not match installed plugin');
    }
    if (grants.approval.state !== 'approved') errors.push('container plugin has no approved grants');
    if (grants.approved.hostDocker === 'host-socket') {
      errors.push('host Docker socket grants are forbidden for plugins');
    }
    if (grants.approved.hostDocker !== 'microvm-dockerd') {
      errors.push('container runtime requires approved microvm-dockerd access');
    }
  }

  if (container.dockerd !== 'microvm') errors.push('container dockerd target must be microvm');
  if (!isGhcrDigestPinnedImage(container.image)) errors.push('container image must be ghcr.io and digest-pinned');
  if (container.composeFile !== undefined && !isSafeRelativePath(container.composeFile)) {
    errors.push('composeFile must be a safe relative path');
  }

  const mounts = grants ? createApprovedMounts({
    grants,
    plugin,
    workspaceRoot: input.workspaceRoot,
    pluginDataRoot: input.pluginDataRoot,
  }) : { mounts: [], errors: [] };
  errors.push(...mounts.errors);

  if (errors.length > 0) return { errors };

  const composeProjectName = createComposeProjectName(plugin, container);
  const composeFile = container.composeFile ? join(plugin.extractedPath, container.composeFile) : undefined;
  const baseEnv = {
    DOCKER_HOST: input.microvmDockerHost,
    VD_PLUGIN_ID: plugin.id,
    VD_PLUGIN_VERSION: plugin.version,
    VD_CONTAINER_ID: container.id,
    COMPOSE_PROJECT_NAME: composeProjectName,
  };
  const lifecycle = composeFile
    ? createComposeLifecycle({
      dockerBinary: input.dockerBinary,
      dockerHost: input.microvmDockerHost,
      composeFile,
      composeProjectName,
      image: container.image,
      env: baseEnv,
    })
    : createSingleContainerLifecycle({
      dockerBinary: input.dockerBinary,
      dockerHost: input.microvmDockerHost,
      composeProjectName,
      image: container.image,
      env: baseEnv,
      mounts: mounts.mounts,
    });

  return {
    errors: [],
    plan: {
      pluginId: plugin.id,
      pluginVersion: plugin.version,
      unitId: container.id,
      dockerHost: input.microvmDockerHost,
      image: container.image,
      composeFile,
      composeProjectName,
      mounts: mounts.mounts,
      approvedNetwork: grants!.approved.network,
      approvedSecrets: [...grants!.approved.secrets],
      healthChecks: [...(plugin.manifest.components.healthChecks ?? [])],
      lifecycle,
      status: { logs: [], health: {} },
    },
  };
}

function createComposeLifecycle(input: {
  dockerBinary: string;
  dockerHost: string;
  composeFile: string;
  composeProjectName: string;
  image: string;
  env: Record<string, string>;
}): ContainerPluginRuntimePlan['lifecycle'] {
  return {
    pull: { command: input.dockerBinary, args: ['pull', input.image], env: { DOCKER_HOST: input.dockerHost } },
    up: {
      command: input.dockerBinary,
      args: ['compose', '--file', input.composeFile, '--project-name', input.composeProjectName, 'up', '--detach'],
      env: { ...input.env },
    },
    down: {
      command: input.dockerBinary,
      args: ['compose', '--file', input.composeFile, '--project-name', input.composeProjectName, 'down'],
      env: { ...input.env },
    },
    logs: {
      command: input.dockerBinary,
      args: ['compose', '--file', input.composeFile, '--project-name', input.composeProjectName, 'logs', '--no-color'],
      env: { ...input.env },
    },
  };
}

function createSingleContainerLifecycle(input: {
  dockerBinary: string;
  dockerHost: string;
  composeProjectName: string;
  image: string;
  env: Record<string, string>;
  mounts: ContainerRuntimeMount[];
}): ContainerPluginRuntimePlan['lifecycle'] {
  const mountArgs = input.mounts.flatMap((mount) => [
    '--mount',
    `type=bind,source=${mount.source},target=${mount.target},readonly=${String(mount.readonly)}`,
  ]);
  return {
    pull: { command: input.dockerBinary, args: ['pull', input.image], env: { DOCKER_HOST: input.dockerHost } },
    up: {
      command: input.dockerBinary,
      args: [
        'run',
        '--detach',
        '--name',
        input.composeProjectName,
        '--label',
        `vd.plugin=${input.env.VD_PLUGIN_ID}`,
        ...mountArgs,
        input.image,
      ],
      env: { ...input.env },
    },
    down: {
      command: input.dockerBinary,
      args: ['rm', '--force', input.composeProjectName],
      env: { ...input.env },
    },
    logs: {
      command: input.dockerBinary,
      args: ['logs', input.composeProjectName],
      env: { ...input.env },
    },
  };
}

function createApprovedMounts(input: {
  grants: EffectivePluginGrants;
  plugin: DiscoveredInstalledPlugin;
  workspaceRoot: string;
  pluginDataRoot: string;
}): { mounts: ContainerRuntimeMount[]; errors: string[] } {
  const errors: string[] = [];
  const mounts: ContainerRuntimeMount[] = [];
  for (const request of input.grants.approved.filesystem) {
    if (request.scope !== 'plugin-data' && request.scope !== 'workspace') {
      errors.push('container filesystem mounts may only use plugin-data or workspace scopes');
      continue;
    }
    if (!isSafeRelativePath(request.path)) {
      errors.push('container filesystem mount paths must be safe relative paths');
      continue;
    }
    mounts.push(toMount(input, request));
  }
  return { mounts, errors: [...new Set(errors)] };
}

function toMount(input: {
  plugin: DiscoveredInstalledPlugin;
  workspaceRoot: string;
  pluginDataRoot: string;
}, request: FilesystemRequest): ContainerRuntimeMount {
  const readonly = request.access === 'read';
  if (request.scope === 'plugin-data') {
    return {
      source: join(input.pluginDataRoot, input.plugin.id, request.path),
      target: join('/plugin-data', request.path),
      readonly,
    };
  }
  return {
    source: join(input.workspaceRoot, request.path),
    target: join('/workspace', request.path),
    readonly,
  };
}

function createComposeProjectName(plugin: DiscoveredInstalledPlugin, container: ContainerComponent): string {
  return `vd_${plugin.id}_${plugin.version}_${container.id}`.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 63);
}

function isHostDockerSocket(dockerHost: string): boolean {
  return dockerHost === '' || dockerHost.startsWith('unix://') || dockerHost.includes('/var/run/docker.sock');
}

function isSafeRelativePath(path: unknown): path is string {
  return typeof path === 'string' && path.length > 0 && !path.startsWith('/') && !path.includes('..') && !path.includes('\0');
}

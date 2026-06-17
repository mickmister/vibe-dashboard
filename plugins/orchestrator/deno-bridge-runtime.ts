import type {
  DenoComponent,
  EffectivePluginGrants,
  FilesystemAccess,
  FilesystemRequest,
  NetworkRequest,
  PluginManifest,
} from './manifest';

export interface BridgeInvocationRequest {
  pluginId: string;
  pluginVersion: string;
  bridgeId: string;
  method: string;
  argsJson: string;
}

export interface PreparedDenoBridgeInvocation {
  pluginId: string;
  pluginVersion: string;
  bridge: DenoComponent;
  method: string;
  argsJson: string;
  denoPermissionArgs: string[];
}

export interface DenoBridgeCommand {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export function prepareDenoBridgeInvocation(input: {
  manifest: PluginManifest;
  grants: EffectivePluginGrants;
  request: BridgeInvocationRequest;
}): PreparedDenoBridgeInvocation {
  assertInvocationIdentity(input.manifest, input.grants, input.request);
  assertNoBroadBridgeGrants(input.grants);

  const bridge = input.manifest.components.denoBridges?.find(
    (candidate) => candidate.id === input.request.bridgeId,
  );
  if (!bridge) {
    throw new Error(`Plugin ${input.manifest.id} does not declare Deno bridge ${input.request.bridgeId}`);
  }

  if (!(bridge.methods ?? []).includes(input.request.method)) {
    throw new Error(`Bridge method ${input.request.method} is not declared for ${bridge.id}`);
  }

  return {
    pluginId: input.manifest.id,
    pluginVersion: input.manifest.version,
    bridge,
    method: input.request.method,
    argsJson: input.request.argsJson,
    denoPermissionArgs: buildDenoPermissionArgs(bridge, input.grants),
  };
}

export function buildDenoBridgeCommand(input: {
  denoBinary: string;
  prepared: PreparedDenoBridgeInvocation;
}): DenoBridgeCommand {
  return {
    command: input.denoBinary,
    args: [
      'run',
      '--no-prompt',
      ...input.prepared.denoPermissionArgs,
      input.prepared.bridge.entry,
      JSON.stringify({ method: input.prepared.method, argsJson: input.prepared.argsJson }),
    ],
    env: {
      VD_PLUGIN_ID: input.prepared.pluginId,
      VD_PLUGIN_VERSION: input.prepared.pluginVersion,
      VD_BRIDGE_ID: input.prepared.bridge.id,
    },
  };
}

export function buildDenoPermissionArgs(
  bridge: DenoComponent,
  grants: EffectivePluginGrants,
): string[] {
  const permissions = bridge.permissions ?? {};
  const args: string[] = [];

  const read = permissions.read ?? [];
  for (const path of read) assertFilesystemAllowed({ bridge, grants, path, access: 'read' });
  if (read.length > 0) args.push(`--allow-read=${read.join(',')}`);

  const write = permissions.write ?? [];
  for (const path of write) assertFilesystemAllowed({ bridge, grants, path, access: 'readWrite' });
  if (write.length > 0) args.push(`--allow-write=${write.join(',')}`);

  const net = permissions.net ?? [];
  for (const host of net) assertNetworkAllowed({ bridge, grants, host });
  if (net.length > 0) args.push(`--allow-net=${net.join(',')}`);

  const env = permissions.env ?? [];
  for (const name of env) {
    if (!grants.approved.env.includes(name)) {
      throw new Error(`Deno bridge ${bridge.id} requests unapproved env ${name}`);
    }
  }
  if (env.length > 0) args.push(`--allow-env=${env.join(',')}`);

  const run = permissions.run ?? [];
  if (run.length > 0) {
    throw new Error(`Deno bridge ${bridge.id} cannot request subprocess permissions in V1`);
  }

  const imports = permissions.imports ?? [];
  if (imports.length > 0) {
    throw new Error(`Deno bridge ${bridge.id} cannot request remote import permissions in V1`);
  }

  return args;
}

function assertInvocationIdentity(
  manifest: PluginManifest,
  grants: EffectivePluginGrants,
  request: BridgeInvocationRequest,
): void {
  if (request.pluginId !== manifest.id || request.pluginVersion !== manifest.version) {
    throw new Error('Bridge invocation plugin identity does not match manifest');
  }
  if (grants.pluginId !== manifest.id || grants.pluginVersion !== manifest.version) {
    throw new Error('Effective grants plugin identity does not match manifest');
  }
  if (grants.approval.state !== 'approved') {
    throw new Error(`Plugin ${manifest.id} has no approved bridge grants`);
  }
}

function assertNoBroadBridgeGrants(grants: EffectivePluginGrants): void {
  if (grants.approved.vkHttpApi !== 'none') {
    throw new Error('Deno bridge grants cannot include VK HTTP API access');
  }
  if (grants.approved.hostShell !== 'none') {
    throw new Error('Deno bridge grants cannot include host shell access');
  }
  if (grants.approved.codeServer !== 'none') {
    throw new Error('Deno bridge grants cannot include code-server access');
  }
  if (grants.approved.hostDocker !== 'none') {
    throw new Error('Deno bridge grants cannot include host Docker access');
  }
  if (grants.approved.plugins.length > 0) {
    throw new Error('Deno bridge grants cannot include direct inter-plugin access');
  }
}

function assertFilesystemAllowed(input: {
  bridge: DenoComponent;
  grants: EffectivePluginGrants;
  path: string;
  access: FilesystemAccess;
}): void {
  const allowed = input.grants.approved.filesystem.some((grant) =>
    filesystemGrantCoversPath(grant, input.path, input.access),
  );
  if (!allowed) {
    throw new Error(`Deno bridge ${input.bridge.id} requests unapproved filesystem path ${input.path}`);
  }
}

function filesystemGrantCoversPath(
  grant: FilesystemRequest,
  path: string,
  access: FilesystemAccess,
): boolean {
  if (grant.scope === 'repo' || grant.scope === 'absolute') return false;
  if (access === 'readWrite' && grant.access !== 'readWrite') return false;
  return path === grant.path || path.startsWith(`${grant.path}/`);
}

function assertNetworkAllowed(input: {
  bridge: DenoComponent;
  grants: EffectivePluginGrants;
  host: string;
}): void {
  if (!networkGrantCoversHost(input.grants.approved.network, input.host)) {
    throw new Error(`Deno bridge ${input.bridge.id} requests unapproved network host ${input.host}`);
  }
}

function networkGrantCoversHost(grant: NetworkRequest, host: string): boolean {
  if (grant.mode !== 'egress' && grant.mode !== 'ingress-and-egress') return false;
  return (grant.hosts ?? []).includes(host);
}
